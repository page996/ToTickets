import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { EventBusService } from '../src/common/events/event-bus.service';
import { ClockService } from '../src/common/time/clock.service';
import { EventsGateway } from '../src/events/events.gateway';
import { loadRuntimeConfig, RuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  acknowledgeCloseImmediately = true;
  nextSendError?: Error;
  readonly sent: string[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  constructor() {
    super();
    // Keep repeated synthetic error emissions observable without EventEmitter
    // treating the second one as an uncaught process error.
    this.on('error', () => undefined);
  }

  send(frame: string, callback?: (error?: Error) => void): void {
    this.sent.push(frame);
    if (this.nextSendError) {
      const error = this.nextSendError;
      this.nextSendError = undefined;
      setImmediate(() => callback?.(error));
    }
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
    this.readyState = 2;
    if (this.acknowledgeCloseImmediately) this.acknowledgeClose();
  }

  acknowledgeClose(): void {
    this.readyState = 3;
    this.emit('close');
  }
}

describe('EventsGateway backpressure', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('preserves replay-before-live ordering while yielding between batches', async () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = {
      ...base,
      limits: { ...base.limits, eventReplayBatchSize: 1 },
    };
    const bus = new EventBusService(config, new ClockService(config));
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      bus.publish('synthetic.event', { marker: sequence });
    }
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();
    gateway.handleConnection(
      socket as unknown as WebSocket,
      requestFor(config, '/api/v1/events?since=0'),
    );
    bus.publish('synthetic.event', { marker: 4 });
    await waitForImmediateTurns(5);

    const frames = socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    expect(frames[0]).toEqual(expect.objectContaining({ protocol: 'event-stream.sync.v1' }));
    expect(frames.slice(1).map((frame) => (frame.data as { marker: number }).marker))
      .toEqual([1, 2, 3, 4]);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      queuedEvents: 0,
    }));
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('does not lose a publication made during the replay subscription handoff', async () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    bus.publish('synthetic.event', { marker: 1 });
    const original = bus.subscribeWithSerializedReplay.bind(bus);
    jest.spyOn(bus, 'subscribeWithSerializedReplay').mockImplementation((sequence, streamId, budget, listener) => {
      const subscription = original(sequence, streamId, budget, listener);
      bus.publish('synthetic.event', { marker: 2 });
      return subscription;
    });
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();

    gateway.handleConnection(
      socket as unknown as WebSocket,
      requestFor(config, '/api/v1/events?since=0'),
    );
    await waitForImmediateTurns(3);

    const frames = socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    expect(frames.slice(1).map((frame) => (frame.data as { marker: number }).marker))
      .toEqual([1, 2]);
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('rejects clients above the configured connection quota', () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = {
      ...base,
      limits: { ...base.limits, websocketMaxClients: 1 },
    };
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const first = new FakeSocket();
    const second = new FakeSocket();
    gateway.handleConnection(first as unknown as WebSocket, requestFor(config));
    gateway.handleConnection(second as unknown as WebSocket, requestFor(config));

    expect(second.closes).toEqual([
      { code: 1013, reason: 'event stream capacity reached' },
    ]);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      rejectedConnections: 1,
    }));
    gateway.handleDisconnect(first as unknown as WebSocket);
  });

  it('closes only a slow client when its send buffer reaches the byte limit', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const slow = new FakeSocket();
    const healthy = new FakeSocket();
    gateway.handleConnection(slow as unknown as WebSocket, requestFor(config));
    gateway.handleConnection(healthy as unknown as WebSocket, requestFor(config));
    slow.bufferedAmount = config.limits.websocketMaxBufferedBytes;

    bus.publish('synthetic.event', { marker: 1 });

    expect(slow.closes).toEqual([
      { code: 1013, reason: 'event stream client is too slow' },
    ]);
    expect(healthy.closes).toEqual([]);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      slowClientClosures: 1,
    }));
    gateway.handleDisconnect(healthy as unknown as WebSocket);
  });

  it('resets replay when serialized frames exceed the per-client byte budget', async () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = {
      ...base,
      limits: {
        ...base.limits,
        websocketMaxBufferedBytes: 1024,
        eventReplayMaxEvents: 10,
      },
    };
    const bus = new EventBusService(config, new ClockService(config));
    bus.publish('synthetic.event', { marker: 'x'.repeat(700) });
    bus.publish('synthetic.event', { marker: 'y'.repeat(700) });
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();

    gateway.handleConnection(socket as unknown as WebSocket, requestFor(config));
    await waitForImmediateTurns(2);

    const frames = socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({
      protocol: 'event-stream.sync.v1',
      reset_required: true,
    }));
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      queuedEvents: 0,
      queuedBytes: 0,
    }));
    gateway.handleDisconnect(socket as unknown as WebSocket);
  });

  it('keeps a closing admitted socket against quota until close acknowledgement', () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = {
      ...base,
      limits: { ...base.limits, websocketMaxClients: 1 },
    };
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const closing = new FakeSocket();
    closing.acknowledgeCloseImmediately = false;
    gateway.handleConnection(closing as unknown as WebSocket, requestFor(config));
    closing.bufferedAmount = config.limits.websocketMaxBufferedBytes;
    bus.publish('synthetic.event', { marker: 1 });

    const rejected = new FakeSocket();
    gateway.handleConnection(rejected as unknown as WebSocket, requestFor(config));
    expect(rejected.closes).toEqual([
      { code: 1013, reason: 'event stream capacity reached' },
    ]);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      rejectedConnections: 1,
    }));

    closing.acknowledgeClose();
    const replacement = new FakeSocket();
    gateway.handleConnection(replacement as unknown as WebSocket, requestFor(config));
    expect(replacement.closes).toEqual([]);
    expect(gateway.getStats().connectedClients).toBe(1);
    gateway.handleDisconnect(replacement as unknown as WebSocket);
  });

  it('counts an asynchronous send failure once and cleans up the subscription', async () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();
    socket.nextSendError = new Error('synthetic asynchronous send failure');

    gateway.handleConnection(socket as unknown as WebSocket, requestFor(config));
    await waitForImmediateTurns(2);
    socket.emit('error', new Error('synthetic follow-up socket error'));

    expect(socket.closes).toEqual([
      { code: 1011, reason: 'event stream send failed' },
    ]);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 0,
      sendFailures: 1,
    }));
    expect(bus.getStats().subscribers).toBe(0);
  });

  it('counts a socket error once while retaining quota until close acknowledgement', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();
    socket.acknowledgeCloseImmediately = false;
    gateway.handleConnection(socket as unknown as WebSocket, requestFor(config));

    socket.emit('error', new Error('synthetic socket failure'));
    socket.emit('error', new Error('synthetic duplicate socket failure'));

    expect(bus.getStats().subscribers).toBe(0);
    expect(gateway.getStats()).toEqual(expect.objectContaining({
      connectedClients: 1,
      sendFailures: 1,
    }));
    socket.acknowledgeClose();
    expect(gateway.getStats().connectedClients).toBe(0);
  });

  it('cleans subscriptions on shutdown while retaining quota until close acknowledgement', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const gateway = new EventsGateway(bus, config);
    const socket = new FakeSocket();
    socket.acknowledgeCloseImmediately = false;
    gateway.handleConnection(socket as unknown as WebSocket, requestFor(config));
    expect(bus.getStats().subscribers).toBe(1);

    gateway.onModuleDestroy();

    expect(bus.getStats().subscribers).toBe(0);
    expect(gateway.getStats().connectedClients).toBe(1);
    socket.acknowledgeClose();
    expect(gateway.getStats().connectedClients).toBe(0);
  });
});

function requestFor(
  config: RuntimeConfig,
  url = '/api/v1/events',
): IncomingMessage {
  return {
    url,
    headers: { origin: config.api.allowedOrigins[0] },
  } as IncomingMessage;
}

async function waitForImmediateTurns(turns: number): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
