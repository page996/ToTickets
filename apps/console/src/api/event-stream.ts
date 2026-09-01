import type { CloudEventEnvelope, EventStreamSyncFrame } from '../contracts';

export type EventStreamState = 'connecting' | 'open' | 'closed' | 'error';

export interface EventStreamCallbacks {
  onEvent: (event: CloudEventEnvelope, hasSequenceGap: boolean) => void;
  onSyncRequired: () => void;
  onState: (state: EventStreamState) => void;
}

export interface EventStreamRetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random: () => number;
}

export interface EventStreamOptions {
  retry?: Partial<EventStreamRetryPolicy>;
}

const DEFAULT_RETRY_POLICY: EventStreamRetryPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
  random: Math.random,
};

export class ControlPlaneEventStream {
  private socket?: WebSocket;
  private lastSequence = 0;
  private streamId?: string;
  private replayTargetSequence?: number;
  private replayHasSequenceGap = false;
  private reconnectAttempt = 0;
  private synchronized = false;
  private readonly retryPolicy: EventStreamRetryPolicy;

  constructor(
    private readonly eventsUrl: string,
    private readonly callbacks: EventStreamCallbacks,
    options: EventStreamOptions = {},
  ) {
    this.retryPolicy = normalizeRetryPolicy(options.retry);
  }

  connect(): void {
    this.close();
    this.synchronized = false;
    const endpoint = new URL(this.eventsUrl);
    endpoint.searchParams.set('since', String(this.lastSequence));
    if (this.streamId) endpoint.searchParams.set('stream_id', this.streamId);
    this.callbacks.onState('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(endpoint);
    } catch {
      this.callbacks.onState('error');
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.resetReconnectBackoff();
      this.callbacks.onState('open');
    });
    socket.addEventListener('message', (message) => {
      if (this.socket === socket) this.handleMessage(message.data);
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.callbacks.onState('error');
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.callbacks.onState('closed');
    });
  }

  nextReconnectDelay(): number {
    const delay = reconnectDelay(this.reconnectAttempt, this.retryPolicy);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 31);
    return delay;
  }

  resetReconnectBackoff(): void {
    this.reconnectAttempt = 0;
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      return;
    }
    if (isSyncFrame(candidate)) {
      const streamChanged = this.streamId !== undefined && this.streamId !== candidate.stream_id;
      const historyGap = candidate.oldest_available_sequence !== null &&
        this.lastSequence < candidate.oldest_available_sequence - 1;
      this.synchronized = true;
      this.streamId = candidate.stream_id;
      if (
        candidate.reset_required ||
        streamChanged ||
        historyGap ||
        this.lastSequence > candidate.current_sequence
      ) {
        this.lastSequence = candidate.current_sequence;
        this.replayTargetSequence = undefined;
        this.replayHasSequenceGap = false;
        this.callbacks.onSyncRequired();
      } else if (candidate.current_sequence > this.lastSequence) {
        this.replayTargetSequence = candidate.current_sequence;
        this.replayHasSequenceGap = false;
      } else {
        this.replayTargetSequence = undefined;
        this.replayHasSequenceGap = false;
      }
      return;
    }
    if (!isCloudEvent(candidate)) return;
    if (!this.synchronized) return;
    const sequence = candidate.data.sequence;
    if (sequence <= this.lastSequence) return;
    const hasSequenceGap = this.lastSequence > 0 && sequence > this.lastSequence + 1;
    this.lastSequence = sequence;
    if (this.replayTargetSequence !== undefined) {
      this.replayHasSequenceGap ||= hasSequenceGap;
      if (sequence < this.replayTargetSequence) return;
      const replayHasSequenceGap = this.replayHasSequenceGap;
      this.replayTargetSequence = undefined;
      this.replayHasSequenceGap = false;
      this.callbacks.onEvent(candidate, replayHasSequenceGap);
      return;
    }
    this.callbacks.onEvent(candidate, hasSequenceGap);
  }
}

export function reconnectDelay(
  attempt: number,
  policy: EventStreamRetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  const boundedAttempt = Math.max(0, Math.min(Math.floor(attempt), 31));
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * 2 ** boundedAttempt,
  );
  const sample = Math.min(1, Math.max(0, policy.random()));
  const jitter = exponential * policy.jitterRatio * (sample * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function normalizeRetryPolicy(
  partial: Partial<EventStreamRetryPolicy> | undefined,
): EventStreamRetryPolicy {
  const candidate = { ...DEFAULT_RETRY_POLICY, ...partial };
  if (
    !Number.isFinite(candidate.initialDelayMs) ||
    candidate.initialDelayMs < 1 ||
    candidate.initialDelayMs > 60_000
  ) {
    throw new Error('event stream initial retry delay must be between 1 and 60000 ms');
  }
  if (
    !Number.isFinite(candidate.maxDelayMs) ||
    candidate.maxDelayMs < candidate.initialDelayMs ||
    candidate.maxDelayMs > 600_000
  ) {
    throw new Error('event stream max retry delay must be between the initial delay and 600000 ms');
  }
  if (!Number.isFinite(candidate.jitterRatio) || candidate.jitterRatio < 0 || candidate.jitterRatio > 1) {
    throw new Error('event stream retry jitter ratio must be between 0 and 1');
  }
  if (typeof candidate.random !== 'function') {
    throw new Error('event stream retry random source must be callable');
  }
  return candidate;
}

function isSyncFrame(value: unknown): value is EventStreamSyncFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const oldest = record.oldest_available_sequence;
  return (
    hasOnlyKeys(record, [
      'protocol',
      'stream_id',
      'current_sequence',
      'oldest_available_sequence',
      'reset_required',
    ]) &&
    record.protocol === 'event-stream.sync.v1' &&
    isUuid(record.stream_id) &&
    typeof record.current_sequence === 'number' &&
    Number.isSafeInteger(record.current_sequence) &&
    record.current_sequence >= 0 &&
    (oldest === null ||
      (typeof oldest === 'number' && Number.isSafeInteger(oldest) && oldest > 0)) &&
    (oldest === null || oldest <= record.current_sequence) &&
    typeof record.reset_required === 'boolean'
  );
}

function isCloudEvent(value: unknown): value is CloudEventEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, [
    'specversion',
    'type',
    'source',
    'id',
    'time',
    'subject',
    'datacontenttype',
    'schema',
    'data',
  ])) return false;
  if (
    record.specversion !== '1.0' ||
    record.source !== 'control-plane' ||
    typeof record.type !== 'string' ||
    record.type.length === 0 ||
    !isUuid(record.id) ||
    !isDateTime(record.time) ||
    record.datacontenttype !== 'application/json' ||
    !isUri(record.schema)
  ) return false;
  if ('subject' in record && (typeof record.subject !== 'string' || record.subject.length === 0)) return false;
  if (typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) return false;
  const sequence = (record.data as Record<string, unknown>).sequence;
  return typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence > 0;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function isUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}
