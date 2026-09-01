import { randomInt, randomUUID } from 'node:crypto';

export function installIsolatedTestEnvironment(): Record<string, string> {
  const bindHost = '127.0.0.1';
  const port = String(randomInt(1024, 65536));
  const originHost = `console-${randomUUID()}`;
  const values = {
    CONFIG_SCHEMA_VERSION: 'runtime-config.v3',
    CONTROL_BIND_HOST: bindHost,
    CONTROL_PORT: port,
    CONSOLE_ORIGINS: `http://${originHost}`,
    MAX_DEVICES: '8',
    MAX_SCHEDULES: '64',
    HEARTBEAT_SECONDS: '30',
    AUDIT_RETENTION_DAYS: '7',
    IDEMPOTENCY_TTL_SECONDS: '600',
    IDEMPOTENCY_MAX_ENTRIES: '100',
    CONFIRMATION_TTL_SECONDS: '300',
    CONFIRMATION_MAX_ENTRIES: '100',
    EVENT_HISTORY_SIZE: '1000',
    CLOCK_TOLERANCE_MS: '250',
    WEBSOCKET_MAX_CLIENTS: '64',
    WEBSOCKET_MAX_BUFFERED_BYTES: '1048576',
    WEBSOCKET_MAX_PAYLOAD_BYTES: '65536',
    EVENT_REPLAY_BATCH_SIZE: '32',
    EVENT_REPLAY_MAX_EVENTS: '256',
    AUDIT_MAX_RECORDS: '10000',
    OPERATION_QUEUE_MAX_QUEUED: '100',
    POLICY_VERSION: 'test-policy.v1',
  };
  Object.assign(process.env, values);
  delete process.env.CONTROL_CONFIG_FILE;
  for (const variableName of [
    'PROJECT_DATA_DIR',
    'PROJECT_LOG_DIR',
    'ANDROID_ADB_PATH',
    'ANDROID_EMULATOR_PATH',
    'SCRCPY_PATH',
    'ANDROID_SDK_ROOT',
  ]) {
    delete process.env[variableName];
  }
  return values;
}
