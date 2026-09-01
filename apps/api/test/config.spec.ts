import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';

describe('loadRuntimeConfig', () => {
  const originalEnv = process.env;
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads and converts an explicitly supplied environment', () => {
    const config = loadRuntimeConfig();
    expect(config.api.port).toBe(Number(process.env.CONTROL_PORT));
    expect(config.api.allowedOrigins).toEqual([process.env.CONSOLE_ORIGINS]);
    expect(config.limits.maxDevices).toBe(8);
    expect(config.limits.maxSchedules).toBe(64);
    expect(config.limits.websocketMaxClients).toBe(64);
    expect(config.limits.websocketMaxBufferedBytes).toBe(1_048_576);
    expect(config.limits.websocketMaxPayloadBytes).toBe(65_536);
    expect(config.limits.eventReplayBatchSize).toBe(32);
    expect(config.limits.eventReplayMaxEvents).toBe(256);
    expect(config.limits.auditMaxRecords).toBe(10_000);
    expect(config.limits.operationQueueMaxQueued).toBe(100);
    expect(config.policy.idempotencyMaxEntries).toBe(100);
    expect(config.policy.confirmationMaxEntries).toBe(100);
  });

  it('keeps optional host paths absent when environment-only startup omits them', () => {
    const config = loadRuntimeConfig();

    expect(config.storage).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });

  it('loads allowlisted host paths from environment and normalizes them', () => {
    process.env.PROJECT_DATA_DIR = '  ./.runtime/data/../probe  ';
    process.env.ANDROID_ADB_PATH = '  ./tools/../tools/adb  ';
    process.env.ANDROID_EMULATOR_PATH = './tools/emulator';

    const config = loadRuntimeConfig();

    expect(config.storage).toEqual({ dataDir: normalize('./.runtime/data/../probe') });
    expect(config.tools).toEqual({
      adb: normalize('./tools/../tools/adb'),
      emulator: normalize('./tools/emulator'),
    });
  });

  it('fails closed when a required setting is missing', () => {
    delete process.env.CONTROL_PORT;
    expect(() => loadRuntimeConfig()).toThrow('api.port');
  });

  it.each(['127.0.0.1', '127.255.255.254', '::1'])(
    'accepts the explicit loopback bind address %s',
    (bindHost) => {
      process.env.CONTROL_BIND_HOST = bindHost;
      expect(loadRuntimeConfig().api.bindHost).toBe(bindHost);
    },
  );

  it.each(['0.0.0.0', 'localhost', 'control.example.invalid', '192.0.2.1', '127.999.0.1', '::', '2001:db8::1'])(
    'rejects the non-loopback environment bind address %s',
    (bindHost) => {
      process.env.CONTROL_BIND_HOST = bindHost;
      expect(() => loadRuntimeConfig()).toThrow(
        'api.bind_host must be an IPv4 127/8 address or ::1',
      );
    },
  );

  it('rejects origins with paths or credentials', () => {
    const origin = new URL(process.env.CONSOLE_ORIGINS!);
    origin.username = 'operator';
    origin.password = 'synthetic-secret';
    origin.pathname = '/path';
    process.env.CONSOLE_ORIGINS = origin.toString();
    expect(() => loadRuntimeConfig()).toThrow('must not contain credentials or a path');
  });

  it('rejects non-HTTP origins', () => {
    process.env.CONSOLE_ORIGINS = 'ftp://console.example.invalid';
    expect(() => loadRuntimeConfig()).toThrow('must use http or https');
  });

  it('rejects an idempotency TTL above the ten-minute contract limit', () => {
    process.env.IDEMPOTENCY_TTL_SECONDS = '601';
    expect(() => loadRuntimeConfig()).toThrow(
      'policy.idempotency_ttl_seconds must be an integer between 30 and 600',
    );
  });

  it.each([true, '8', [8]])(
    'rejects non-number integer value %p from a JSON configuration file',
    (invalidValue) => {
      const source = completeFileConfig();
      (source.limits as Record<string, unknown>).max_devices = invalidValue;
      useConfigFile(source);

      expect(() => loadRuntimeConfig()).toThrow(
        'limits.max_devices must be an integer between 1 and 64',
      );
    },
  );

  it('loads integer placeholders as numbers at the file boundary', () => {
    const source = completeFileConfig();
    (source.limits as Record<string, unknown>).max_devices = '${MAX_DEVICES}';
    useConfigFile(source);

    expect(loadRuntimeConfig().limits.maxDevices).toBe(8);
  });

  it('returns normalized host paths from a complete configuration file', () => {
    const source = completeFileConfig();
    const storage = source.storage as Record<string, unknown>;
    const tools = source.tools as Record<string, unknown>;
    storage.data_dir = './.runtime/data/../data';
    storage.log_dir = './.runtime/logs/../logs';
    tools.adb = './tools/../tools/adb';
    tools.scrcpy = './tools/scrcpy';
    useConfigFile(source);

    expect(loadRuntimeConfig()).toEqual(expect.objectContaining({
      storage: {
        dataDir: normalize('./.runtime/data/../data'),
        logDir: normalize('./.runtime/logs/../logs'),
      },
      tools: {
        adb: normalize('./tools/../tools/adb'),
        scrcpy: normalize('./tools/scrcpy'),
      },
    }));
  });

  it.each(['storage', 'tools'])('requires %s in a complete configuration file', (key) => {
    const source = completeFileConfig();
    delete source[key];
    useConfigFile(source);

    expect(() => loadRuntimeConfig()).toThrow(`${key} must be an object`);
  });

  it('requires at least one allowed origin in a complete configuration file', () => {
    const source = completeFileConfig();
    (source.api as Record<string, unknown>).allowed_origins = [];
    useConfigFile(source);

    expect(() => loadRuntimeConfig()).toThrow(
      'api.allowed_origins must contain at least one origin',
    );
  });

  it.each(['0.0.0.0', 'localhost', 'control.example.invalid', '192.0.2.1', '127.999.0.1', '::', '2001:db8::1'])(
    'rejects the non-loopback complete-file bind address %s',
    (bindHost) => {
      const source = completeFileConfig();
      (source.api as Record<string, unknown>).bind_host = bindHost;
      useConfigFile(source);

      expect(() => loadRuntimeConfig()).toThrow(
        'api.bind_host must be an IPv4 127/8 address or ::1',
      );
    },
  );

  it('keeps the versioned JSON schema aligned with runtime invariants', () => {
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, '../../../config/config.schema.json'), 'utf8'),
    ) as {
      required: string[];
      properties: {
        api: {
          properties: {
            bind_host: {
              oneOf: Array<{
                $ref?: string;
                const?: string;
                type?: string;
                format?: string;
                pattern?: string;
              }>;
            };
            allowed_origins: { minItems: number };
          };
        };
        policy: {
          properties: {
            idempotency_ttl_seconds: { oneOf: Array<{ maximum?: number }> };
          };
        };
      };
    };

    expect(schema.required).toEqual(expect.arrayContaining(['storage', 'tools']));
    const bindHostRules = schema.properties.api.properties.bind_host.oneOf;
    expect(bindHostRules).toEqual(
      expect.arrayContaining([
        { $ref: '#/$defs/env_placeholder' },
        expect.objectContaining({ const: '::1' }),
      ]),
    );
    const ipv4LoopbackRule = bindHostRules.find((rule) => rule.format === 'ipv4');
    expect(ipv4LoopbackRule).toEqual(
      expect.objectContaining({ type: 'string', format: 'ipv4' }),
    );
    const ipv4LoopbackPattern = new RegExp(ipv4LoopbackRule!.pattern!);
    expect(ipv4LoopbackPattern.test('127.255.0.1')).toBe(true);
    expect(ipv4LoopbackPattern.test('127.999.0.1')).toBe(false);
    expect(ipv4LoopbackPattern.test('192.0.2.1')).toBe(false);
    expect(schema.properties.api.properties.allowed_origins.minItems).toBe(1);
    expect(
      schema.properties.policy.properties.idempotency_ttl_seconds.oneOf[0]?.maximum,
    ).toBe(600);
  });

  function useConfigFile(source: Record<string, unknown>): void {
    const directory = mkdtempSync(join(tmpdir(), 'ticketing-console-config-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'runtime-config.json');
    writeFileSync(file, JSON.stringify(source), 'utf8');
    process.env.CONTROL_CONFIG_FILE = file;
  }
});

function completeFileConfig(): Record<string, unknown> {
  return {
    schema_version: 'runtime-config.v3',
    api: {
      bind_host: '127.0.0.1',
      port: 12000,
      allowed_origins: ['http://console.example.invalid'],
    },
    storage: {
      data_dir: './.runtime/data',
      log_dir: './.runtime/logs',
    },
    tools: {
      adb: './tools/adb',
      scrcpy: './tools/scrcpy',
    },
    limits: {
      max_devices: 8,
      max_schedules: 64,
      heartbeat_seconds: 30,
      audit_retention_days: 7,
      clock_tolerance_ms: 250,
      websocket_max_clients: 64,
      websocket_max_buffered_bytes: 1_048_576,
      websocket_max_payload_bytes: 65_536,
      event_replay_batch_size: 32,
      event_replay_max_events: 256,
      audit_max_records: 10_000,
      operation_queue_max_queued: 100,
    },
    policy: {
      version: 'test-policy.v1',
      idempotency_ttl_seconds: 600,
      idempotency_max_entries: 100,
      confirmation_ttl_seconds: 300,
      confirmation_max_entries: 100,
      event_history_size: 1000,
    },
  };
}
