import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { ClockService } from '../time/clock.service';

export interface CloudEventEnvelope<T = Record<string, unknown>> {
  specversion: '1.0';
  type: string;
  source: 'control-plane';
  id: string;
  time: string;
  subject?: string;
  datacontenttype: 'application/json';
  schema: string;
  data: T & { sequence: number };
}

export interface EventStreamSyncFrame {
  protocol: 'event-stream.sync.v1';
  stream_id: string;
  current_sequence: number;
  oldest_available_sequence: number | null;
  reset_required: boolean;
}

export interface EventReplayWindow {
  sync: EventStreamSyncFrame;
  events: CloudEventEnvelope[];
}

export interface EventReplaySubscription {
  replay: EventReplayWindow;
  unsubscribe: () => void;
}

export interface SerializedReplaySubscription {
  syncFrame: string;
  replayFrames: string[];
  replayBytes: number;
  resetForByteBudget: boolean;
  unsubscribe: () => void;
}

export interface EventBusStats {
  currentSequence: number;
  retainedEvents: number;
  historyCapacity: number;
  subscribers: number;
  deliveryErrors: number;
}

@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly history: CloudEventEnvelope[] = [];
  private readonly listeners = new Set<(event: CloudEventEnvelope) => void>();
  private readonly streamId = randomUUID();
  private readonly deliveryQueue: CloudEventEnvelope[] = [];
  private deliveryQueueHead = 0;
  private sequence = 0;
  private deliveryErrors = 0;
  private drainingDeliveries = false;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly clock: ClockService,
  ) {}

  publish<T extends Record<string, unknown>>(
    type: string,
    data: T,
    subject?: string,
  ): CloudEventEnvelope<T> {
    if (
      this.drainingDeliveries &&
      this.deliveryQueue.length - this.deliveryQueueHead >= this.config.policy.eventHistorySize
    ) {
      throw new Error('event delivery queue capacity has been reached');
    }
    const envelope: CloudEventEnvelope<T> = {
      specversion: '1.0',
      type,
      source: 'control-plane',
      id: randomUUID(),
      time: this.clock.nowIso(),
      ...(subject ? { subject } : {}),
      datacontenttype: 'application/json',
      schema: `https://example.invalid/schemas/${type.replace(/[^a-zA-Z0-9]+/g, '-')}.v1.json`,
      data: { ...data, sequence: ++this.sequence },
    };
    const stored = immutableClone(envelope as CloudEventEnvelope);
    this.history.push(stored);
    while (this.history.length > this.config.policy.eventHistorySize) this.history.shift();
    this.deliver(stored);
    return structuredClone(stored) as CloudEventEnvelope<T>;
  }

  subscribe(listener: (event: CloudEventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeWithReplay(
    sequence: number,
    requestedStreamId: string | undefined,
    listener: (event: CloudEventEnvelope) => void,
  ): EventReplaySubscription {
    this.listeners.add(listener);
    const replay = this.replayWindow(sequence, requestedStreamId);
    return {
      replay,
      unsubscribe: () => this.listeners.delete(listener),
    };
  }

  subscribeWithSerializedReplay(
    sequence: number,
    requestedStreamId: string | undefined,
    maximumReplayBytes: number,
    listener: (event: CloudEventEnvelope) => void,
  ): SerializedReplaySubscription {
    this.listeners.add(listener);
    const sync = this.replaySync(sequence, requestedStreamId);
    const replayFrames: string[] = [];
    let replayBytes = 0;
    let resetForByteBudget = false;

    if (!sync.reset_required) {
      const syncBytes = Buffer.byteLength(JSON.stringify(sync));
      const replayBudget = Math.max(0, maximumReplayBytes - syncBytes);
      for (const event of this.history) {
        if (event.data.sequence <= sequence) continue;
        const frame = JSON.stringify(event);
        const nextBytes = replayBytes + Buffer.byteLength(frame);
        if (nextBytes > replayBudget) {
          replayFrames.length = 0;
          replayBytes = 0;
          sync.reset_required = true;
          resetForByteBudget = true;
          break;
        }
        replayFrames.push(frame);
        replayBytes = nextBytes;
      }
    }

    return {
      syncFrame: JSON.stringify(sync),
      replayFrames,
      replayBytes,
      resetForByteBudget,
      unsubscribe: () => this.listeners.delete(listener),
    };
  }

  replaySince(sequence: number): CloudEventEnvelope[] {
    return structuredClone(
      this.history.filter((event) => event.data.sequence > sequence),
    );
  }

  replayWindow(sequence: number, requestedStreamId?: string): EventReplayWindow {
    const sync = this.replaySync(sequence, requestedStreamId);
    return {
      sync,
      events: sync.reset_required ? [] : this.replaySince(sequence),
    };
  }

  getCurrentSequence(): number {
    return this.sequence;
  }

  getStats(): EventBusStats {
    return {
      currentSequence: this.sequence,
      retainedEvents: this.history.length,
      historyCapacity: this.config.policy.eventHistorySize,
      subscribers: this.listeners.size,
      deliveryErrors: this.deliveryErrors,
    };
  }

  onModuleDestroy(): void {
    this.listeners.clear();
    this.deliveryQueue.length = 0;
    this.deliveryQueueHead = 0;
  }

  private deliver(event: CloudEventEnvelope): void {
    this.deliveryQueue.push(event);
    if (this.drainingDeliveries) return;
    this.drainingDeliveries = true;
    try {
      while (this.deliveryQueueHead < this.deliveryQueue.length) {
        const next = this.deliveryQueue[this.deliveryQueueHead]!;
        this.deliveryQueueHead += 1;
        for (const listener of [...this.listeners]) {
          try {
            listener(next);
          } catch {
            this.deliveryErrors += 1;
          }
        }
      }
    } finally {
      this.deliveryQueue.length = 0;
      this.deliveryQueueHead = 0;
      this.drainingDeliveries = false;
    }
  }

  private replaySync(sequence: number, requestedStreamId?: string): EventStreamSyncFrame {
    const oldestAvailableSequence = this.history[0]?.data.sequence ?? null;
    const streamChanged =
      requestedStreamId !== undefined && requestedStreamId !== this.streamId;
    const sequenceAhead = sequence > this.sequence;
    const historyGap =
      oldestAvailableSequence !== null && sequence < oldestAvailableSequence - 1;
    const replayLimitExceeded = this.sequence - sequence > this.config.limits.eventReplayMaxEvents;
    return {
      protocol: 'event-stream.sync.v1',
      stream_id: this.streamId,
      current_sequence: this.sequence,
      oldest_available_sequence: oldestAvailableSequence,
      reset_required: streamChanged || sequenceAhead || historyGap || replayLimitExceeded,
    };
  }
}

function immutableClone<T extends CloudEventEnvelope>(event: T): T {
  return deepFreeze(structuredClone(event));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
