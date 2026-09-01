import type {
  ApiErrorPayload,
  AuditEvent,
  ClockSnapshot,
  Collection,
  ConfirmationTicket,
  Device,
  DeviceOperatorConfirmation,
  IssuedDeviceOperatorConfirmation,
  IssuedOperatorConfirmation,
  OperatorConfirmation,
  Page,
  SafeConfirmationIntent,
  Schedule,
} from '../contracts';
import type { ConsoleRuntimeConfig } from '../config/runtime-config';

type FetchLike = typeof fetch;
type DeviceOperation = 'start' | 'stop' | 'reconnect';
type PreviewOperation = 'start' | 'stop';

export class ControlPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryable = false,
    readonly status?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export interface AuditFilters {
  page: number;
  pageSize: number;
  type?: string;
  deviceId?: string;
}

export interface NewSchedule {
  label: string;
  publicReference?: string;
  startsAt: string;
  timezone: string;
  reminders: Array<{ offsetSeconds: number; channel: 'desktop' | 'sound' }>;
}

export interface StopAllIdempotencyKeys {
  confirmation: string;
  command: string;
}

interface WriteOptions {
  method?: string;
  idempotencyKey?: string;
}

export class ApiClient {
  constructor(
    private readonly config: ConsoleRuntimeConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async listDevices(signal?: AbortSignal): Promise<Collection<Device>> {
    const response = await this.request<CollectionEnvelope<WireDevice>>('devices', { signal });
    assertOnlyKeys(response, ['request_id', 'items'], 'devices response');
    return {
      items: requireArray<WireDevice>(response.items, 'devices.items').map((device) =>
        toDevice(device, false),
      ),
    };
  }

  async getDevice(id: string, signal?: AbortSignal): Promise<Device> {
    const response = await this.request<ResourceEnvelope<WireDevice>>(
      `devices/${encodeURIComponent(id)}`,
      { signal },
    );
    return toDevice(response, true);
  }

  deviceCommand(
    id: string,
    operation: DeviceOperation,
    confirmation: DeviceOperatorConfirmation,
    idempotencyKey?: string,
  ): Promise<Device> {
    return this.write<ResourceEnvelope<WireDevice>>(
      `devices/${encodeURIComponent(id)}/commands/${operation}`,
      confirmationBody(confirmation),
      { idempotencyKey },
    ).then((device) => toDevice(device, true));
  }

  previewCommand(
    id: string,
    operation: PreviewOperation,
    confirmation: DeviceOperatorConfirmation,
    idempotencyKey?: string,
  ): Promise<Device> {
    return this.write<ResourceEnvelope<WireDevice>>(
      `devices/${encodeURIComponent(id)}/preview/${operation}`,
      confirmationBody(confirmation),
      { idempotencyKey },
    ).then((device) => toDevice(device, true));
  }

  focusDevice(
    id: string,
    confirmation: DeviceOperatorConfirmation,
    idempotencyKey?: string,
  ): Promise<Device> {
    return this.write<ResourceEnvelope<WireDevice>>(
      `devices/${encodeURIComponent(id)}/focus`,
      confirmationBody(confirmation),
      { idempotencyKey },
    ).then((device) => toDevice(device, true));
  }

  async listSchedules(signal?: AbortSignal): Promise<Collection<Schedule>> {
    const response = await this.request<CollectionEnvelope<WireSchedule>>('schedules', { signal });
    assertOnlyKeys(response, ['request_id', 'items'], 'schedules response');
    return {
      items: requireArray<WireSchedule>(response.items, 'schedules.items').map((schedule) =>
        toSchedule(schedule, false),
      ),
    };
  }

  async createSchedule(input: NewSchedule, idempotencyKey?: string): Promise<Schedule> {
    const response = await this.write<ResourceEnvelope<WireSchedule>>('schedules', {
      label: input.label,
      ...(input.publicReference ? { public_reference: input.publicReference } : {}),
      starts_at: input.startsAt,
      timezone: input.timezone,
      reminders: input.reminders.map((reminder) => ({
        offset_seconds: reminder.offsetSeconds,
        channel: reminder.channel,
      })),
    }, { idempotencyKey });
    return toSchedule(response, true);
  }

  async cancelSchedule(id: string, idempotencyKey?: string): Promise<Schedule> {
    const response = await this.write<ResourceEnvelope<WireSchedule>>(
      `schedules/${encodeURIComponent(id)}`,
      { state: 'cancelled' },
      { method: 'PATCH', idempotencyKey },
    );
    return toSchedule(response, true);
  }

  async acknowledgeSchedule(id: string, idempotencyKey?: string): Promise<Schedule> {
    const response = await this.write<ResourceEnvelope<WireSchedule>>(
      `schedules/${encodeURIComponent(id)}/acknowledge`,
      {
        operator_id: this.config.operatorId,
      },
      { idempotencyKey },
    );
    return toSchedule(response, true);
  }

  getClock(signal?: AbortSignal): Promise<ClockSnapshot> {
    return this.request('clock', { signal }).then(toClockSnapshot);
  }

  async listAudit(filters: AuditFilters, signal?: AbortSignal): Promise<Page<AuditEvent>> {
    const query = new URLSearchParams({
      page: String(filters.page),
      page_size: String(filters.pageSize),
    });
    if (filters.type) query.set('type', filters.type);
    if (filters.deviceId) query.set('device_id', filters.deviceId);
    const response = await this.request<PageEnvelope<WireAuditEvent>>(
      `audit?${query.toString()}`,
      { signal },
    );
    assertOnlyKeys(response, ['request_id', 'items', 'page', 'page_size', 'total'], 'audit response');
    const pageSize = requireInteger(response.page_size, 'audit.page_size', 1);
    if (pageSize > 200) invalidResponse('audit.page_size');
    return {
      items: requireArray<WireAuditEvent>(response.items, 'audit.items').map(toAuditEvent),
      page: requireInteger(response.page, 'audit.page', 1),
      pageSize,
      total: requireInteger(response.total, 'audit.total', 0),
    };
  }

  async exportAudit(): Promise<{ exported_at: string; items: AuditEvent[] }> {
    const response = await this.request<AuditExportEnvelope>('audit/export');
    assertOnlyKeys(response, ['request_id', 'exported_at', 'items'], 'audit export response');
    return {
      exported_at: requireDateTime(response.exported_at, 'audit.exported_at'),
      items: requireArray<WireAuditEvent>(response.items, 'audit.items').map(toAuditEvent),
    };
  }

  async issueConfirmation(
    intent: Exclude<SafeConfirmationIntent, 'safety.stop-all'>,
    deviceId: string,
    expectedSequence: number,
    idempotencyKey?: string,
  ): Promise<IssuedDeviceOperatorConfirmation>;
  async issueConfirmation(
    intent: 'safety.stop-all',
    deviceId?: undefined,
    expectedSequence?: undefined,
    idempotencyKey?: string,
  ): Promise<IssuedOperatorConfirmation>;
  async issueConfirmation(
    intent: SafeConfirmationIntent,
    deviceId?: string,
    expectedSequence?: number,
    idempotencyKey?: string,
  ): Promise<IssuedOperatorConfirmation | IssuedDeviceOperatorConfirmation> {
    const ticket = await this.write<ResourceEnvelope<ConfirmationTicket>>(
      'safety/confirmations',
      {
        operator_id: this.config.operatorId,
        intent,
        ...(deviceId ? { device_id: deviceId } : {}),
        ...(expectedSequence !== undefined ? { expected_sequence: expectedSequence } : {}),
        confirmed: true,
      },
      { idempotencyKey },
    );
    assertOnlyKeys(
      ticket,
      ['request_id', 'confirmation_id', 'intent', 'expires_at', 'expected_sequence'],
      'confirmation response',
    );
    requireUuidV4(ticket.confirmation_id, 'confirmation.confirmation_id');
    requireEnum(ticket.intent, ['device.start', 'device.stop', 'device.reconnect', 'preview.start', 'preview.stop', 'device.focus', 'safety.stop-all'], 'confirmation.intent');
    if (ticket.intent !== intent) {
      throw new ControlPlaneError(
        'response.invalid',
        '控制平面返回了与请求不一致的确认意图',
      );
    }
    requireDateTime(ticket.expires_at, 'confirmation.expires_at');
    const confirmation: IssuedOperatorConfirmation = {
      operator_id: this.config.operatorId,
      confirmation_id: ticket.confirmation_id,
      intent: ticket.intent,
      expires_at: ticket.expires_at,
    };
    if (intent === 'safety.stop-all') {
      if ('expected_sequence' in ticket) invalidResponse('confirmation.expected_sequence');
      return confirmation;
    }
    requireInteger(ticket.expected_sequence, 'confirmation.expected_sequence', 1);
    if (ticket.expected_sequence !== expectedSequence) {
      throw new ControlPlaneError(
        'response.invalid',
        '控制平面返回了不一致的确认快照序号',
      );
    }
    return {
      ...confirmation,
      expected_sequence: ticket.expected_sequence,
    };
  }

  async stopAll(keys?: StopAllIdempotencyKeys): Promise<{ stopped: number; failed: number }> {
    const confirmation = await this.issueConfirmation(
      'safety.stop-all',
      undefined,
      undefined,
      keys?.confirmation,
    );
    const response = await this.write<ResourceEnvelope<{ stopped: number; failed: number }>>(
      'safety/stop-all',
      operatorConfirmationBody(confirmation),
      { idempotencyKey: keys?.command },
    );
    assertOnlyKeys(response, ['request_id', 'stopped', 'failed'], 'stop-all response');
    const stopped = requireInteger(response.stopped, 'stop-all.stopped', 0);
    const failed = requireInteger(response.failed, 'stop-all.failed', 0);
    if (failed !== 0) invalidResponse('stop-all.failed');
    return {
      stopped,
      failed,
    };
  }

  private write<T>(path: string, body: unknown, options: WriteOptions = {}): Promise<T> {
    return this.request<T>(path, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID(),
        'X-Operator-Id': this.config.operatorId,
      },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const endpoint = new URL(path, `${this.config.apiBaseUrl}/`);
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, endpoint, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ControlPlaneError('transport.unavailable', '无法连接本地控制平面', undefined, true);
    }
    const payload = await parseJson(response);
    if (!response.ok) {
      const apiError = isRecord(payload) ? payload as ApiErrorPayload : {};
      throw new ControlPlaneError(
        typeof apiError.code === 'string' ? apiError.code : 'request.failed',
        typeof apiError.message === 'string' ? apiError.message : '控制平面拒绝了请求',
        typeof apiError.request_id === 'string' ? apiError.request_id : undefined,
        apiError.retryable === true,
        response.status,
        isRecord(apiError.details) ? apiError.details : undefined,
      );
    }
    if (!isRecord(payload)) {
      throw new ControlPlaneError(
        'response.invalid',
        '控制平面返回了缺少请求标识的响应',
        undefined,
        false,
        response.status,
      );
    }
    try {
      requireRequestId(payload.request_id, 'response.request_id');
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        throw new ControlPlaneError(
          error.code,
          error.message,
          undefined,
          false,
          response.status,
        );
      }
      throw error;
    }
    return payload as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: unknown,
  allowed: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    invalidResponse(field);
  }
}

interface ApiEnvelope {
  request_id: string;
}

type ResourceEnvelope<T> = T & ApiEnvelope;

interface CollectionEnvelope<T> extends ApiEnvelope {
  items: T[];
}

interface PageEnvelope<T> extends CollectionEnvelope<T> {
  page: number;
  page_size: number;
  total: number;
}

interface WireDevice {
  id: string;
  alias: string;
  provider: string;
  transport: string;
  group?: string;
  state: Device['state'];
  stream: Device['stream'];
  focused: boolean;
  capabilities: Device['capabilities'];
  last_seen_at: string;
  sequence: number;
}

interface WireSchedule {
  id: string;
  label: string;
  public_reference?: string;
  starts_at: string;
  timezone: string;
  reminders: Array<{
    offset_seconds: number;
    channel: 'desktop' | 'sound';
  }>;
  state: Schedule['state'];
  acknowledged_at?: string;
  created_at: string;
  updated_at: string;
}

interface WireAuditEvent {
  id: string;
  type: string;
  occurred_at: string;
  operator_id: string;
  device_id?: string;
  schedule_id?: string;
  correlation_id: string;
  policy_version: string;
  result: AuditEvent['result'];
  metadata: Record<string, string | number | boolean>;
}

interface AuditExportEnvelope extends ApiEnvelope {
  exported_at: string;
  items: WireAuditEvent[];
}

function confirmationBody(
  confirmation: DeviceOperatorConfirmation,
): DeviceOperatorConfirmation {
  return {
    operator_id: confirmation.operator_id,
    confirmation_id: confirmation.confirmation_id,
    intent: confirmation.intent,
    expected_sequence: confirmation.expected_sequence,
  };
}

function operatorConfirmationBody(confirmation: OperatorConfirmation): OperatorConfirmation {
  return {
    operator_id: confirmation.operator_id,
    confirmation_id: confirmation.confirmation_id,
    intent: confirmation.intent,
  };
}

function toDevice(device: WireDevice, includeRequestId = false): Device {
  if (!isRecord(device)) invalidResponse('device');
  assertOnlyKeys(
    device,
    [
      ...(includeRequestId ? ['request_id'] : []),
      'id',
      'alias',
      'provider',
      'transport',
      'group',
      'state',
      'stream',
      'focused',
      'capabilities',
      'last_seen_at',
      'sequence',
    ],
    'device',
  );
  if (includeRequestId) requireRequestId(device.request_id, 'device.request_id');
  else if ('request_id' in device) invalidResponse('device.request_id');
  requireUuidV4(device.id, 'device.id');
  requireBoundedString(device.alias, 'device.alias', 128);
  requireEnum(device.provider, ['mock-adapter'], 'device.provider');
  requireEnum(device.transport, ['memory'], 'device.transport');
  requireEnum(device.state, ['offline', 'discovering', 'booting', 'ready', 'waiting', 'error'], 'device.state');
  requireEnum(device.stream, ['stopped', 'running'], 'device.stream');
  if (typeof device.focused !== 'boolean') invalidResponse('device.focused');
  if (
    !isRecord(device.capabilities) ||
    !hasOnlyKeys(device.capabilities, ['lifecycle', 'health_read', 'screen_preview', 'user_input', 'automation']) ||
    device.capabilities.lifecycle !== true ||
    device.capabilities.health_read !== true ||
    device.capabilities.screen_preview !== true ||
    device.capabilities.user_input !== false ||
    device.capabilities.automation !== false
  ) {
    invalidResponse('device.capabilities');
  }
  if ('group' in device) {
    const group = requireBoundedString(device.group, 'device.group', 64);
    if (!/^(?=.*\S)[^\\/\u0000\r\n]+$/.test(group)) invalidResponse('device.group');
  }
  requireDateTime(device.last_seen_at, 'device.last_seen_at');
  requireInteger(device.sequence, 'device.sequence', 1);
  return {
    id: device.id,
    alias: device.alias,
    provider: device.provider,
    transport: device.transport,
    ...(device.group ? { group: device.group } : {}),
    state: device.state,
    stream: device.stream,
    focused: device.focused,
    capabilities: device.capabilities,
    lastSeenAt: device.last_seen_at,
    sequence: device.sequence,
  };
}

function toSchedule(schedule: WireSchedule, includeRequestId = false): Schedule {
  if (!isRecord(schedule)) invalidResponse('schedule');
  assertOnlyKeys(
    schedule,
    [
      ...(includeRequestId ? ['request_id'] : []),
      'id',
      'label',
      'public_reference',
      'starts_at',
      'timezone',
      'reminders',
      'state',
      'acknowledged_at',
      'created_at',
      'updated_at',
    ],
    'schedule',
  );
  if (includeRequestId) requireRequestId(schedule.request_id, 'schedule.request_id');
  else if ('request_id' in schedule) invalidResponse('schedule.request_id');
  requireUuidV4(schedule.id, 'schedule.id');
  requireBoundedString(schedule.label, 'schedule.label', 128);
  if ('public_reference' in schedule) {
    const publicReference = requireString(schedule.public_reference, 'schedule.public_reference');
    if (!/^https?:\/\/(?![^/?#]*@)[^?#]+$/.test(publicReference)) {
      invalidResponse('schedule.public_reference');
    }
    let parsed: URL;
    try {
      parsed = new URL(publicReference);
    } catch {
      invalidResponse('schedule.public_reference');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      invalidResponse('schedule.public_reference');
    }
  }
  requireDateTime(schedule.starts_at, 'schedule.starts_at');
  requireBoundedString(schedule.timezone, 'schedule.timezone', 64);
  const reminders = requireArray<WireSchedule['reminders'][number]>(schedule.reminders, 'schedule.reminders');
  if (reminders.length < 1 || reminders.length > 16) invalidResponse('schedule.reminders');
  requireEnum(schedule.state, ['draft', 'scheduled', 'notified', 'human_confirmed', 'completed', 'failed', 'cancelled', 'expired'], 'schedule.state');
  requireDateTime(schedule.created_at, 'schedule.created_at');
  requireDateTime(schedule.updated_at, 'schedule.updated_at');
  if ('acknowledged_at' in schedule) requireDateTime(schedule.acknowledged_at, 'schedule.acknowledged_at');
  reminders.forEach((reminder, index) => {
    if (!isRecord(reminder) || !hasOnlyKeys(reminder, ['offset_seconds', 'channel'])) invalidResponse(`schedule.reminders[${index}]`);
    requireInteger(reminder.offset_seconds, `schedule.reminders[${index}].offset_seconds`, -604800);
    const offsetSeconds = requireInteger(reminder.offset_seconds, `schedule.reminders[${index}].offset_seconds`, -604800);
    if (offsetSeconds > 0) invalidResponse(`schedule.reminders[${index}].offset_seconds`);
    requireEnum(reminder.channel, ['desktop', 'sound'], `schedule.reminders[${index}].channel`);
  });
  return {
    id: schedule.id,
    label: schedule.label,
    ...(schedule.public_reference ? { publicReference: schedule.public_reference } : {}),
    startsAt: schedule.starts_at,
    timezone: schedule.timezone,
    reminders: reminders.map((reminder) => ({
      offsetSeconds: reminder.offset_seconds,
      channel: reminder.channel,
    })),
    state: schedule.state,
    ...(schedule.acknowledged_at ? { acknowledgedAt: schedule.acknowledged_at } : {}),
    createdAt: schedule.created_at,
    updatedAt: schedule.updated_at,
  };
}

function toAuditEvent(event: WireAuditEvent): AuditEvent {
  if (!isRecord(event)) invalidResponse('audit');
  assertOnlyKeys(
    event,
    ['id', 'type', 'occurred_at', 'operator_id', 'device_id', 'schedule_id', 'correlation_id', 'policy_version', 'result', 'metadata'],
    'audit',
  );
  requireUuidV4(event.id, 'audit.id');
  requireString(event.type, 'audit.type');
  requireDateTime(event.occurred_at, 'audit.occurred_at');
  requireOperatorId(event.operator_id, 'audit.operator_id');
  if ('device_id' in event) requireUuidV4(event.device_id, 'audit.device_id');
  if ('schedule_id' in event) requireUuidV4(event.schedule_id, 'audit.schedule_id');
  requireUuidV4(event.correlation_id, 'audit.correlation_id');
  requireString(event.policy_version, 'audit.policy_version');
  requireEnum(event.result, ['accepted', 'rejected'], 'audit.result');
  if (!isRecord(event.metadata)) invalidResponse('audit.metadata');
  for (const [key, value] of Object.entries(event.metadata)) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      invalidResponse(`audit.metadata.${key}`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      invalidResponse(`audit.metadata.${key}`);
    }
  }
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurred_at,
    operatorId: event.operator_id,
    ...(event.device_id ? { deviceId: event.device_id } : {}),
    ...(event.schedule_id ? { scheduleId: event.schedule_id } : {}),
    correlationId: event.correlation_id,
    policyVersion: event.policy_version,
    result: event.result,
    metadata: event.metadata,
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ControlPlaneError('response.invalid', '控制平面返回了非 JSON 响应', undefined, false, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ControlPlaneError('response.invalid', '控制平面返回了无效 JSON', undefined, false, response.status);
  }
}

function toClockSnapshot(value: unknown): ClockSnapshot {
  if (!isRecord(value)) invalidResponse('clock');
  assertOnlyKeys(
    value,
    ['request_id', 'server_time', 'monotonic_supported', 'offset_ms', 'confidence'],
    'clock response',
  );
  requireRequestId(value.request_id, 'clock.request_id');
  const serverTime = requireDateTime(value.server_time, 'clock.server_time');
  if (value.monotonic_supported !== true) invalidResponse('clock.monotonic_supported');
  const offsetMs = requireInteger(value.offset_ms, 'clock.offset_ms');
  const confidence = requireEnum(value.confidence, ['local', 'uncertain'], 'clock.confidence');
  return {
    server_time: serverTime,
    monotonic_supported: true,
    offset_ms: offsetMs,
    confidence,
  };
}

function requireArray<T = unknown>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) invalidResponse(field);
  return value as T[];
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) invalidResponse(field);
  return value;
}

function requireBoundedString(value: unknown, field: string, maximum: number): string {
  const stringValue = requireString(value, field);
  if (stringValue.length > maximum) invalidResponse(field);
  return stringValue;
}

function requireRequestId(value: unknown, field: string): string {
  const requestId = requireBoundedString(value, field, 128);
  if (requestId.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) invalidResponse(field);
  return requestId;
}

function requireOperatorId(value: unknown, field: string): string {
  const operatorId = requireBoundedString(value, field, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(operatorId)) invalidResponse(field);
  return operatorId;
}

function requireDateTime(value: unknown, field: string): string {
  const stringValue = requireString(value, field);
  if (
    !Number.isFinite(Date.parse(stringValue)) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(stringValue)
  ) {
    invalidResponse(field);
  }
  return stringValue;
}

function requireInteger(value: unknown, field: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalidResponse(field);
  return value;
}

function requireUuidV4(value: unknown, field: string): string {
  const stringValue = requireString(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stringValue)) {
    invalidResponse(field);
  }
  return stringValue;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalidResponse(field);
  return value as T;
}

function invalidResponse(field: string): never {
  throw new ControlPlaneError('response.invalid', `控制平面返回了无效的 ${field}`);
}
