import { readFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { validateBindHost } from './exposure-profile';

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export interface RuntimeConfig {
  readonly schemaVersion: 'runtime-config.v3';
  readonly api: {
    readonly bindHost: string;
    readonly port: number;
    readonly allowedOrigins: readonly string[];
  };
  readonly limits: {
    readonly maxDevices: number;
    readonly maxSchedules: number;
    readonly heartbeatSeconds: number;
    readonly auditRetentionDays: number;
    readonly clockToleranceMs: number;
    readonly websocketMaxClients: number;
    readonly websocketMaxBufferedBytes: number;
    readonly websocketMaxPayloadBytes: number;
    readonly eventReplayBatchSize: number;
    readonly eventReplayMaxEvents: number;
    readonly auditMaxRecords: number;
    readonly operationQueueMaxQueued: number;
  };
  readonly policy: {
    readonly idempotencyTtlSeconds: number;
    readonly idempotencyMaxEntries: number;
    readonly confirmationTtlSeconds: number;
    readonly confirmationMaxEntries: number;
    readonly eventHistorySize: number;
  };
  readonly policyVersion: string;
}

type JsonRecord = Record<string, unknown>;

const INTEGER_CONFIG_PATHS = new Set([
  'api.port',
  'limits.max_devices',
  'limits.max_schedules',
  'limits.heartbeat_seconds',
  'limits.audit_retention_days',
  'limits.clock_tolerance_ms',
  'limits.websocket_max_clients',
  'limits.websocket_max_buffered_bytes',
  'limits.websocket_max_payload_bytes',
  'limits.event_replay_batch_size',
  'limits.event_replay_max_events',
  'limits.audit_max_records',
  'limits.operation_queue_max_queued',
  'policy.idempotency_ttl_seconds',
  'policy.idempotency_max_entries',
  'policy.confirmation_ttl_seconds',
  'policy.confirmation_max_entries',
  'policy.event_history_size',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseOrigins(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const origins = candidates.map((entry, index) => {
    const origin = requiredString(entry, `api.allowed_origins[${index}]`);
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`api.allowed_origins[${index}] must be an absolute URL origin`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`api.allowed_origins[${index}] must use http or https`);
    }
    if (parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error(`api.allowed_origins[${index}] must not contain credentials or a path`);
    }
    return origin;
  });
  if (origins.length === 0) {
    throw new Error('api.allowed_origins must contain at least one origin');
  }
  return origins;
}

function expandEnvPlaceholders(value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((nested, index) => expandEnvPlaceholders(nested, [...path, String(index)]));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        expandEnvPlaceholders(nested, [...path, key]),
      ]),
    );
  }
  if (typeof value !== 'string') {
    return value;
  }
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
  if (!match) {
    return value;
  }
  const resolved = process.env[match[1]];
  if (resolved === undefined || resolved.length === 0) {
    throw new Error(`environment variable ${match[1]} is required`);
  }
  return INTEGER_CONFIG_PATHS.has(path.join('.'))
    ? parseEnvironmentInteger(resolved, match[1])
    : resolved;
}

function parseEnvironmentInteger(value: string, variableName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`environment variable ${variableName} must be a base-10 integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`environment variable ${variableName} must be a safe integer`);
  }
  return parsed;
}

function optionalEnvironmentInteger(variableName: string): number | undefined {
  const value = process.env[variableName];
  return value === undefined ? undefined : parseEnvironmentInteger(value, variableName);
}

function readConfigFile(configPath: string): JsonRecord {
  const normalizedPath = normalize(
    isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(normalizedPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `failed to read CONTROL_CONFIG_FILE: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error('CONTROL_CONFIG_FILE must contain a JSON object');
  }
  return expandEnvPlaceholders(parsed) as JsonRecord;
}

function sourceConfig(): JsonRecord {
  const configPath = process.env.CONTROL_CONFIG_FILE;
  if (configPath) {
    return readConfigFile(configPath);
  }
  return {
    schema_version: process.env.CONFIG_SCHEMA_VERSION,
    api: {
      bind_host: process.env.CONTROL_BIND_HOST,
      port: optionalEnvironmentInteger('CONTROL_PORT'),
      allowed_origins: process.env.CONSOLE_ORIGINS,
    },
    limits: {
      max_devices: optionalEnvironmentInteger('MAX_DEVICES'),
      max_schedules: optionalEnvironmentInteger('MAX_SCHEDULES'),
      heartbeat_seconds: optionalEnvironmentInteger('HEARTBEAT_SECONDS'),
      audit_retention_days: optionalEnvironmentInteger('AUDIT_RETENTION_DAYS'),
      clock_tolerance_ms: optionalEnvironmentInteger('CLOCK_TOLERANCE_MS'),
      websocket_max_clients: optionalEnvironmentInteger('WEBSOCKET_MAX_CLIENTS'),
      websocket_max_buffered_bytes: optionalEnvironmentInteger('WEBSOCKET_MAX_BUFFERED_BYTES'),
      websocket_max_payload_bytes: optionalEnvironmentInteger('WEBSOCKET_MAX_PAYLOAD_BYTES'),
      event_replay_batch_size: optionalEnvironmentInteger('EVENT_REPLAY_BATCH_SIZE'),
      event_replay_max_events: optionalEnvironmentInteger('EVENT_REPLAY_MAX_EVENTS'),
      audit_max_records: optionalEnvironmentInteger('AUDIT_MAX_RECORDS'),
      operation_queue_max_queued: optionalEnvironmentInteger('OPERATION_QUEUE_MAX_QUEUED'),
    },
    policy: {
      version: process.env.POLICY_VERSION,
      idempotency_ttl_seconds: optionalEnvironmentInteger('IDEMPOTENCY_TTL_SECONDS'),
      idempotency_max_entries: optionalEnvironmentInteger('IDEMPOTENCY_MAX_ENTRIES'),
      confirmation_ttl_seconds: optionalEnvironmentInteger('CONFIRMATION_TTL_SECONDS'),
      confirmation_max_entries: optionalEnvironmentInteger('CONFIRMATION_MAX_ENTRIES'),
      event_history_size: optionalEnvironmentInteger('EVENT_HISTORY_SIZE'),
    },
  };
}

function assertOnlyKeys(record: JsonRecord, allowed: readonly string[], name: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${name} contains unknown keys: ${unknown.join(', ')}`);
  }
}

export function loadRuntimeConfig(): RuntimeConfig {
  const raw = sourceConfig();
  const usesCompleteConfigFile = Boolean(process.env.CONTROL_CONFIG_FILE);
  assertOnlyKeys(raw, ['schema_version', 'api', 'storage', 'tools', 'limits', 'policy'], 'config');
  if (raw.schema_version !== 'runtime-config.v3') {
    throw new Error('schema_version must equal runtime-config.v3');
  }
  if (!isRecord(raw.api)) {
    throw new Error('api must be an object');
  }
  if (!isRecord(raw.limits)) {
    throw new Error('limits must be an object');
  }
  if (!isRecord(raw.policy)) {
    throw new Error('policy must be an object');
  }
  if (usesCompleteConfigFile || raw.storage !== undefined) validateIgnoredStorage(raw.storage);
  if (usesCompleteConfigFile || raw.tools !== undefined) validateIgnoredTools(raw.tools);
  assertOnlyKeys(raw.api, ['bind_host', 'port', 'allowed_origins'], 'api');
  assertOnlyKeys(
    raw.limits,
    [
      'max_devices',
      'max_schedules',
      'heartbeat_seconds',
      'audit_retention_days',
      'clock_tolerance_ms',
      'websocket_max_clients',
      'websocket_max_buffered_bytes',
      'websocket_max_payload_bytes',
      'event_replay_batch_size',
      'event_replay_max_events',
      'audit_max_records',
      'operation_queue_max_queued',
    ],
    'limits',
  );
  assertOnlyKeys(
    raw.policy,
    ['version', 'idempotency_ttl_seconds', 'idempotency_max_entries', 'confirmation_ttl_seconds', 'confirmation_max_entries', 'event_history_size'],
    'policy',
  );
  const bindHost = validateBindHost(raw.api.bind_host);
  return Object.freeze({
    schemaVersion: 'runtime-config.v3' as const,
    api: Object.freeze({
      bindHost,
      port: boundedInteger(raw.api.port, 'api.port', 1024, 65535),
      allowedOrigins: Object.freeze(parseOrigins(raw.api.allowed_origins)),
    }),
    limits: Object.freeze({
      maxDevices: boundedInteger(raw.limits.max_devices, 'limits.max_devices', 1, 64),
      maxSchedules: boundedInteger(
        raw.limits.max_schedules,
        'limits.max_schedules',
        1,
        100000,
      ),
      heartbeatSeconds: boundedInteger(
        raw.limits.heartbeat_seconds,
        'limits.heartbeat_seconds',
        5,
        300,
      ),
      auditRetentionDays: boundedInteger(
        raw.limits.audit_retention_days,
        'limits.audit_retention_days',
        1,
        3650,
      ),
      clockToleranceMs: boundedInteger(
        raw.limits.clock_tolerance_ms,
        'limits.clock_tolerance_ms',
        1,
        60000,
      ),
      websocketMaxClients: boundedInteger(
        raw.limits.websocket_max_clients,
        'limits.websocket_max_clients',
        1,
        1000,
      ),
      websocketMaxBufferedBytes: boundedInteger(
        raw.limits.websocket_max_buffered_bytes,
        'limits.websocket_max_buffered_bytes',
        1024,
        67108864,
      ),
      websocketMaxPayloadBytes: boundedInteger(
        raw.limits.websocket_max_payload_bytes,
        'limits.websocket_max_payload_bytes',
        1024,
        1048576,
      ),
      eventReplayBatchSize: boundedInteger(
        raw.limits.event_replay_batch_size,
        'limits.event_replay_batch_size',
        1,
        1000,
      ),
      eventReplayMaxEvents: boundedInteger(
        raw.limits.event_replay_max_events,
        'limits.event_replay_max_events',
        1,
        10000,
      ),
      auditMaxRecords: boundedInteger(
        raw.limits.audit_max_records,
        'limits.audit_max_records',
        100,
        1000000,
      ),
      operationQueueMaxQueued: boundedInteger(
        raw.limits.operation_queue_max_queued,
        'limits.operation_queue_max_queued',
        1,
        100000,
      ),
    }),
    policy: Object.freeze({
      idempotencyTtlSeconds: boundedInteger(
        raw.policy.idempotency_ttl_seconds,
        'policy.idempotency_ttl_seconds',
        30,
        600,
      ),
      idempotencyMaxEntries: boundedInteger(
        raw.policy.idempotency_max_entries,
        'policy.idempotency_max_entries',
        1,
        100000,
      ),
      confirmationTtlSeconds: boundedInteger(
        raw.policy.confirmation_ttl_seconds,
        'policy.confirmation_ttl_seconds',
        30,
        3600,
      ),
      confirmationMaxEntries: boundedInteger(
        raw.policy.confirmation_max_entries,
        'policy.confirmation_max_entries',
        1,
        100000,
      ),
      eventHistorySize: boundedInteger(
        raw.policy.event_history_size,
        'policy.event_history_size',
        10,
        100000,
      ),
    }),
    policyVersion: requiredString(raw.policy.version, 'policy.version'),
  });
}

function validateIgnoredStorage(value: unknown): void {
  if (!isRecord(value)) throw new Error('storage must be an object');
  assertOnlyKeys(value, ['data_dir', 'log_dir'], 'storage');
  requiredString(value.data_dir, 'storage.data_dir');
  requiredString(value.log_dir, 'storage.log_dir');
}

function validateIgnoredTools(value: unknown): void {
  if (!isRecord(value)) throw new Error('tools must be an object');
  assertOnlyKeys(value, ['adb', 'scrcpy', 'emulator'], 'tools');
  requiredString(value.adb, 'tools.adb');
  requiredString(value.scrcpy, 'tools.scrcpy');
  if (value.emulator !== undefined) requiredString(value.emulator, 'tools.emulator');
}
