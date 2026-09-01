export type DeviceState =
  | 'offline'
  | 'discovering'
  | 'booting'
  | 'ready'
  | 'waiting'
  | 'error';

export type StreamState = 'stopped' | 'running';

export interface DeviceCapabilities {
  lifecycle: true;
  health_read: true;
  screen_preview: true;
  user_input: false;
  automation: false;
}

export interface Device {
  id: string;
  alias: string;
  provider: string;
  transport: string;
  group?: string;
  state: DeviceState;
  stream: StreamState;
  focused: boolean;
  capabilities: DeviceCapabilities;
  lastSeenAt: string;
  sequence: number;
}

export type ScheduleState =
  | 'draft'
  | 'scheduled'
  | 'notified'
  | 'human_confirmed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ReminderDefinition {
  offsetSeconds: number;
  channel: 'desktop' | 'sound';
}

export interface Schedule {
  id: string;
  label: string;
  publicReference?: string;
  startsAt: string;
  timezone: string;
  reminders: ReminderDefinition[];
  state: ScheduleState;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  occurredAt: string;
  operatorId: string;
  deviceId?: string;
  scheduleId?: string;
  correlationId: string;
  policyVersion: string;
  result: 'accepted' | 'rejected';
  metadata: Record<string, string | number | boolean>;
}

export interface ClockSnapshot {
  server_time: string;
  monotonic_supported: boolean;
  offset_ms: number;
  confidence: string;
}

export interface CloudEventEnvelope {
  specversion: '1.0';
  type: string;
  source: 'control-plane';
  id: string;
  time: string;
  subject?: string;
  datacontenttype: 'application/json';
  schema: string;
  data: Record<string, unknown> & { sequence: number };
}

export interface EventStreamSyncFrame {
  protocol: 'event-stream.sync.v1';
  stream_id: string;
  current_sequence: number;
  oldest_available_sequence: number | null;
  reset_required: boolean;
}

export type SafeConfirmationIntent =
  | 'device.start'
  | 'device.stop'
  | 'device.reconnect'
  | 'preview.start'
  | 'preview.stop'
  | 'device.focus'
  | 'safety.stop-all';

export interface OperatorConfirmation {
  operator_id: string;
  confirmation_id: string;
  intent: SafeConfirmationIntent;
}

export interface DeviceOperatorConfirmation extends OperatorConfirmation {
  expected_sequence: number;
}

export interface ConfirmationTicket {
  confirmation_id: string;
  intent: SafeConfirmationIntent;
  expires_at: string;
  expected_sequence?: number;
}

export interface IssuedOperatorConfirmation extends OperatorConfirmation {
  expires_at: string;
}

export interface IssuedDeviceOperatorConfirmation
  extends IssuedOperatorConfirmation, DeviceOperatorConfirmation {}

export interface ApiErrorPayload {
  request_id?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface Collection<T> {
  items: T[];
}

export interface Page<T> extends Collection<T> {
  page: number;
  pageSize: number;
  total: number;
}
