import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudEventEnvelope, EventStreamSyncFrame } from '../contracts';
import { ControlPlaneEventStream, reconnectDelay } from './event-stream';

type FakeListener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static readonly CLOSING = 2;
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

describe('ControlPlaneEventStream', () => {
  afterEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it('persists its stream cursor, detects gaps, and resets across service instances', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onEvent = vi.fn();
    const onSyncRequired = vi.fn();
    const onState = vi.fn();
    const stream = new ControlPlaneEventStream(requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL'), {
      onEvent,
      onSyncRequired,
      onState,
    });

    stream.connect();
    const first = FakeWebSocket.instances[0];
    expect(new URL(first.url).searchParams.get('since')).toBe('0');
    expect(new URL(first.url).searchParams.has('stream_id')).toBe(false);
    first.emit('message', JSON.stringify(syncFrame(STREAM_ONE, 0, false)));
    first.emit('message', JSON.stringify(cloudEvent(1)));
    first.emit('message', JSON.stringify(cloudEvent(3)));

    expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: eventId(1) }), false);
    expect(onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: eventId(3) }), true);

    first.emit('close');
    stream.connect();
    const second = FakeWebSocket.instances[1];
    const reconnectUrl = new URL(second.url);
    expect(reconnectUrl.searchParams.get('since')).toBe('3');
    expect(reconnectUrl.searchParams.get('stream_id')).toBe(STREAM_ONE);

    second.emit('message', JSON.stringify(syncFrame(STREAM_TWO, 0, true)));
    expect(onSyncRequired).toHaveBeenCalledTimes(1);
    second.emit('message', JSON.stringify(cloudEvent(1)));
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ id: eventId(1) }), false);
  });

  it('coalesces an initial replay into one snapshot refresh callback', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onEvent = vi.fn();
    const stream = new ControlPlaneEventStream(requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL'), {
      onEvent,
      onSyncRequired: vi.fn(),
      onState: vi.fn(),
    });

    stream.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emit('message', JSON.stringify(syncFrame(STREAM_ONE, 3, false)));
    socket.emit('message', JSON.stringify(cloudEvent(1)));
    socket.emit('message', JSON.stringify(cloudEvent(2)));
    expect(onEvent).not.toHaveBeenCalled();

    socket.emit('message', JSON.stringify(cloudEvent(3)));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: eventId(3) }), false);
  });

  it('ignores CloudEvents that violate the envelope contract', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onEvent = vi.fn();
    const stream = new ControlPlaneEventStream(requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL'), {
      onEvent,
      onSyncRequired: vi.fn(),
      onState: vi.fn(),
    });

    stream.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emit('message', JSON.stringify(syncFrame(STREAM_ONE, 0, false)));
    const malformed = [
      { ...cloudEvent(1), datacontenttype: 'text/plain' },
      { ...cloudEvent(1), id: 'event-1' },
      { ...cloudEvent(1), schema: '/relative-schema' },
      { ...cloudEvent(1), time: '2026-08-25 08:00:00Z' },
      { ...cloudEvent(1), unexpected: true },
    ];

    for (const event of malformed) socket.emit('message', JSON.stringify(event));

    expect(onEvent).not.toHaveBeenCalled();
    socket.emit('message', JSON.stringify(cloudEvent(1)));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores sync frames with invalid UUIDs, unknown fields, or impossible windows', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const onSyncRequired = vi.fn();
    const stream = new ControlPlaneEventStream(requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL'), {
      onEvent: vi.fn(),
      onSyncRequired,
      onState: vi.fn(),
    });

    stream.connect();
    const socket = FakeWebSocket.instances[0];
    const malformed = [
      { ...syncFrame(STREAM_ONE, 1, false), stream_id: 'stream-one' },
      { ...syncFrame(STREAM_ONE, 1, false), extra: true },
      { ...syncFrame(STREAM_ONE, 1, false), oldest_available_sequence: 2 },
    ];
    for (const frame of malformed) socket.emit('message', JSON.stringify(frame));

    expect(onSyncRequired).not.toHaveBeenCalled();
    socket.emit('message', JSON.stringify(syncFrame(STREAM_ONE, 1, true)));
    expect(onSyncRequired).toHaveBeenCalledTimes(1);
  });

  it('uses bounded exponential reconnect delay with deterministic jitter', () => {
    const policy = {
      initialDelayMs: 100,
      maxDelayMs: 1_000,
      jitterRatio: 0.2,
      random: () => 0,
    };
    expect(reconnectDelay(0, policy)).toBe(80);
    expect(reconnectDelay(3, policy)).toBe(640);
    expect(reconnectDelay(30, policy)).toBe(800);
  });

  it('resets reconnect backoff only after the socket opens', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const stream = new ControlPlaneEventStream(
      requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL'),
      { onEvent: vi.fn(), onSyncRequired: vi.fn(), onState: vi.fn() },
      {
        retry: {
          initialDelayMs: 100,
          maxDelayMs: 1_000,
          jitterRatio: 0,
          random: () => 0.5,
        },
      },
    );

    expect(stream.nextReconnectDelay()).toBe(100);
    expect(stream.nextReconnectDelay()).toBe(200);
    stream.connect();
    FakeWebSocket.instances[0].emit('open');
    expect(stream.nextReconnectDelay()).toBe(100);
  });
});

function syncFrame(
  streamId: string,
  currentSequence: number,
  resetRequired: boolean,
): EventStreamSyncFrame {
  return {
    protocol: 'event-stream.sync.v1',
    stream_id: streamId,
    current_sequence: currentSequence,
    oldest_available_sequence: currentSequence > 0 ? 1 : null,
    reset_required: resetRequired,
  };
}

function cloudEvent(sequence: number): CloudEventEnvelope {
  return {
    specversion: '1.0',
    type: 'device.health.changed',
    source: 'control-plane',
    id: eventId(sequence),
    time: '2026-08-25T08:00:00.000Z',
    datacontenttype: 'application/json',
    schema: 'urn:synthetic:device-health-changed:v1',
    data: { sequence, device_id: '00000000-0000-4000-8000-000000000003', state: 'ready' },
  };
}

const STREAM_ONE = '00000000-0000-4000-8000-000000000001';
const STREAM_TWO = '00000000-0000-4000-8000-000000000002';

function eventId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function requiredTestEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be injected for console tests`);
  return value;
}
