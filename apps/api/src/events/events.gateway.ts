import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { EventBusService } from '../common/events/event-bus.service';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';

interface ClientState {
  replayFrames: string[];
  replayBytes: number[];
  replayBytesRemaining: number;
  replayIndex: number;
  liveFrames: string[];
  liveBytes: number;
  draining: boolean;
  closed: boolean;
  failureCounted: boolean;
  cleanup: () => void;
  releaseCleanup: () => void;
}

export interface EventGatewayStats {
  connectedClients: number;
  clientCapacity: number;
  queuedEvents: number;
  queuedBytes: number;
  rejectedConnections: number;
  slowClientClosures: number;
  sendFailures: number;
}

@Injectable()
@WebSocketGateway({ path: '/api/v1/events' })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly clients = new Map<WebSocket, ClientState>();
  private rejectedConnections = 0;
  private slowClientClosures = 0;
  private sendFailures = 0;

  constructor(
    private readonly events: EventBusService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.config.api.allowedOrigins.includes(origin)) {
      this.rejectedConnections += 1;
      client.close(1008, 'origin is not allowed');
      return;
    }
    if (this.clients.size >= this.config.limits.websocketMaxClients) {
      this.rejectedConnections += 1;
      client.close(1013, 'event stream capacity reached');
      return;
    }

    const cursor = parseCursor(request.url);
    const state: ClientState = {
      replayFrames: [],
      replayBytes: [],
      replayBytesRemaining: 0,
      replayIndex: 0,
      liveFrames: [],
      liveBytes: 0,
      draining: false,
      closed: false,
      failureCounted: false,
      cleanup: () => undefined,
      releaseCleanup: () => undefined,
    };
    const handleSocketError = () => {
      this.recordSendFailure(state);
      this.closeClient(client, 1011, 'event stream socket failed');
    };
    const handleSocketClose = () => this.releaseClient(client);
    const capturedLive: string[] = [];
    let replayBoundary = Number.MAX_SAFE_INTEGER;
    let acceptsLive = false;
    const subscription = this.events.subscribeWithSerializedReplay(
      cursor.since,
      cursor.streamId,
      this.config.limits.websocketMaxBufferedBytes,
      (event) => {
        if (!acceptsLive) {
          capturedLive.push(JSON.stringify(event));
          return;
        }
        if (event.data.sequence > replayBoundary) {
          this.enqueueLive(client, state, JSON.stringify(event));
        }
      },
    );
    const sync = JSON.parse(subscription.syncFrame) as { current_sequence: number };
    replayBoundary = sync.current_sequence;
    state.replayFrames = subscription.replayFrames;
    state.replayBytes = state.replayFrames.map((frame) => Buffer.byteLength(frame));
    state.replayBytesRemaining = subscription.replayBytes;
    state.cleanup = () => {
      subscription.unsubscribe();
      client.off('error', handleSocketError);
    };
    state.releaseCleanup = () => client.off('close', handleSocketClose);
    this.clients.set(client, state);
    client.once('error', handleSocketError);
    client.once('close', handleSocketClose);
    for (const frame of capturedLive) this.enqueueLiveFrame(client, state, frame);
    acceptsLive = true;
    if (state.closed) return;

    if (!this.sendFrame(client, state, subscription.syncFrame)) return;
    this.scheduleDrain(client, state);
  }

  handleDisconnect(client: WebSocket): void {
    this.releaseClient(client);
  }

  getStats(): EventGatewayStats {
    let queuedEvents = 0;
    let queuedBytes = 0;
    for (const [client, state] of this.clients) {
      queuedEvents += state.replayFrames.length - state.replayIndex + state.liveFrames.length;
      queuedBytes += state.replayBytesRemaining + state.liveBytes + client.bufferedAmount;
    }
    return {
      connectedClients: this.clients.size,
      clientCapacity: this.config.limits.websocketMaxClients,
      queuedEvents,
      queuedBytes,
      rejectedConnections: this.rejectedConnections,
      slowClientClosures: this.slowClientClosures,
      sendFailures: this.sendFailures,
    };
  }

  onModuleDestroy(): void {
    for (const client of [...this.clients.keys()]) {
      this.closeClient(client, 1001, 'control plane shutting down');
    }
  }

  private enqueueLive(client: WebSocket, state: ClientState, frame: string): void {
    this.enqueueLiveFrame(client, state, frame);
    this.scheduleDrain(client, state);
  }

  private enqueueLiveFrame(client: WebSocket, state: ClientState, frame: string): void {
    if (state.closed) return;
    const frameBytes = Buffer.byteLength(frame);
    if (
      state.liveBytes + client.bufferedAmount + frameBytes >
      this.config.limits.websocketMaxBufferedBytes - state.replayBytesRemaining
    ) {
      this.slowClientClosures += 1;
      this.closeClient(client, 1013, 'event stream client is too slow');
      return;
    }
    state.liveFrames.push(frame);
    state.liveBytes += frameBytes;
  }

  private scheduleDrain(client: WebSocket, state: ClientState): void {
    if (state.closed || state.draining) return;
    state.draining = true;
    void this.drain(client, state).finally(() => {
      state.draining = false;
      if (
        !state.closed &&
        (state.replayIndex < state.replayFrames.length || state.liveFrames.length > 0)
      ) {
        this.scheduleDrain(client, state);
      }
    });
  }

  private async drain(client: WebSocket, state: ClientState): Promise<void> {
    while (!state.closed) {
      let sent = 0;
      while (sent < this.config.limits.eventReplayBatchSize && !state.closed) {
        let frame: string | undefined;
        if (state.replayIndex < state.replayFrames.length) {
          frame = state.replayFrames[state.replayIndex];
          state.replayBytesRemaining -= state.replayBytes[state.replayIndex] ?? 0;
          state.replayIndex += 1;
        } else {
          frame = state.liveFrames.shift();
          if (frame !== undefined) state.liveBytes -= Buffer.byteLength(frame);
        }
        if (frame === undefined) return;
        if (!this.sendFrame(client, state, frame)) return;
        sent += 1;
      }
      await yieldToEventLoop();
    }
  }

  private sendFrame(client: WebSocket, state: ClientState, frame: string): boolean {
    if (state.closed || client.readyState !== WebSocket.OPEN) {
      this.deactivateClient(state);
      if (client.readyState === WebSocket.CLOSED) this.releaseClient(client);
      return false;
    }
    if (
      client.bufferedAmount + Buffer.byteLength(frame) >
      this.config.limits.websocketMaxBufferedBytes
    ) {
      this.slowClientClosures += 1;
      this.closeClient(client, 1013, 'event stream client is too slow');
      return false;
    }
    try {
      client.send(frame, (error?: Error) => {
        if (!error) return;
        this.recordSendFailure(state);
        this.closeClient(client, 1011, 'event stream send failed');
      });
      return true;
    } catch {
      this.recordSendFailure(state);
      this.closeClient(client, 1011, 'event stream send failed');
      return false;
    }
  }

  private closeClient(client: WebSocket, code: number, reason: string): void {
    const state = this.clients.get(client);
    if (!state) return;
    this.deactivateClient(state);
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      try {
        client.close(code, reason);
      } catch {
        this.recordSendFailure(state);
        this.releaseClient(client);
      }
    } else if (client.readyState === WebSocket.CLOSED) {
      this.releaseClient(client);
    }
  }

  private deactivateClient(state: ClientState): void {
    if (state.closed) return;
    state.closed = true;
    state.cleanup();
    state.replayFrames.length = 0;
    state.replayBytes.length = 0;
    state.replayBytesRemaining = 0;
    state.liveFrames.length = 0;
    state.liveBytes = 0;
  }

  private releaseClient(client: WebSocket): void {
    const state = this.clients.get(client);
    if (!state) return;
    this.deactivateClient(state);
    state.releaseCleanup();
    this.clients.delete(client);
  }

  private recordSendFailure(state: ClientState): void {
    if (state.failureCounted) return;
    state.failureCounted = true;
    this.sendFailures += 1;
  }
}

function parseCursor(url: string | undefined): { since: number; streamId?: string } {
  if (!url) return { since: 0 };
  const query = url.split('?', 2)[1];
  if (!query) return { since: 0 };
  const parameters = new URLSearchParams(query);
  const value = parameters.get('since');
  const parsed = Number(value);
  const since = value && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  const streamId = parameters.get('stream_id')?.trim();
  return { since, ...(streamId ? { streamId } : {}) };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
