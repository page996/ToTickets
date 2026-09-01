import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { installIsolatedTestEnvironment } from './test-environment';
import { ClockService } from '../src/common/time/clock.service';

describe('Control plane REST contract', () => {
  let app: INestApplication;
  let deviceId: string;
  let clock: ClockService;
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 }));
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    clock = app.get(ClockService);
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('registers a read-only mock device and returns a request id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Idempotency-Key', 'register-device-001')
      .send({ alias: 'Mock 01', provider: 'mock-adapter', transport: 'memory', group: 'fixture' })
      .expect(201);
    deviceId = response.body.id;
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.capabilities).toEqual(expect.objectContaining({ user_input: false, automation: false }));
  });

  it('exposes side-effect-free live, ready, and bounded diagnostics', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(live.body).toEqual(expect.objectContaining({
      schema: 'health.live.v1',
      status: 'ok',
      monotonic_uptime_ms: expect.any(Number),
    }));
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toEqual(expect.objectContaining({
      schema: 'health.ready.v1',
      checks: { config: 'ok', repositories: 'ok', event_bus: 'ok' },
    }));
    const diagnostics = await request(app.getHttpServer())
      .get('/api/v1/health/diagnostics')
      .expect(200);
    expect(diagnostics.body.resources).toEqual(expect.objectContaining({
      devices: expect.objectContaining({ max: 8 }),
      event_bus: expect.objectContaining({ current_sequence: expect.any(Number) }),
      websocket: expect.objectContaining({
        per_client_buffer_limit_bytes: 1_048_576,
      }),
      idempotency: expect.objectContaining({ in_flight: expect.any(Number) }),
      operations: expect.objectContaining({
        keyed: expect.objectContaining({ active: 0, queued: 0, capacity: 100, rejected: 0 }),
        global: expect.objectContaining({ active: 0, queued: 0, capacity: 100, rejected: 0 }),
      }),
    }));
    expect(JSON.stringify(diagnostics.body)).not.toContain(process.env.CONTROL_BIND_HOST);
    expect(JSON.stringify(diagnostics.body)).not.toContain(process.env.CONSOLE_ORIGINS);
  });

  it('exposes a side-effect-free host probe without leaking paths or environment values', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/hosts/probe').expect(200);
    expect(response.body).toEqual(expect.objectContaining({
      schema: 'host-probe.v1',
      collected_at: expect.any(String),
      resources: expect.objectContaining({
        cpu_threads: expect.any(Number),
        memory_mib: expect.any(Number),
        available_memory_mib: expect.any(Number),
      }),
      side_effects: 'none',
    }));
    expect(JSON.stringify(response.body)).not.toContain(process.env.CONTROL_CONFIG_FILE ?? 'never-used');
  });

  it('lists conservative provider capacity estimates with input permanently disabled', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/hosts/providers').expect(200);
    expect(response.body.planning).toBe('estimated_until_ramp_test');
    expect(response.body.manifests).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider_id: 'android-emulator-avd', planning_only: true }),
      expect.objectContaining({
        provider_id: 'android-emulator-avd',
        capabilities: expect.objectContaining({ user_input: false, automation: false }),
      }),
    ]));
    expect(response.body.capacity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider_id: 'android-emulator-avd',
        startup_concurrency: expect.any(Number),
        control_plane_limit: 8,
        effective_instances: expect.any(Number),
      }),
    ]));
  });

  it('returns collection envelopes and snake_case resource fields', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/devices').expect(200);
    expect(response.body.request_id).toEqual(expect.any(String));
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].last_seen_at).toEqual(expect.any(String));
    expect(response.body.items[0].lastSeenAt).toBeUndefined();
  });

  it('replays the same idempotent result', async () => {
    const payload = { alias: 'Mock 02', provider: 'mock-adapter', transport: 'memory' };
    const first = await request(app.getHttpServer()).post('/api/v1/devices').set('Idempotency-Key', 'register-device-002').send(payload).expect(201);
    const second = await request(app.getHttpServer()).post('/api/v1/devices').set('Idempotency-Key', 'register-device-002').send(payload).expect(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('requires explicit confirmation for lifecycle commands', async () => {
    const device = await request(app.getHttpServer())
      .get(`/api/v1/devices/${deviceId}`)
      .expect(200);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/commands/start`)
      .set('Idempotency-Key', 'start-device-no-confirm')
      .send({ expected_sequence: device.body.sequence })
      .expect(428);
    expect(response.body.code).toBe('operator.confirmation_required');
  });

  it('starts a device with a matching unexpired confirmation', async () => {
    const device = await request(app.getHttpServer())
      .get(`/api/v1/devices/${deviceId}`)
      .expect(200);
    const confirmation = await request(app.getHttpServer())
      .post('/api/v1/safety/confirmations')
      .set('Idempotency-Key', 'confirm-start-device')
      .send({
        operator_id: 'test-operator',
        device_id: deviceId,
        intent: 'device.start',
        confirmed: true,
        expected_sequence: device.body.sequence,
      })
      .expect(201);
    expect(confirmation.body.expected_sequence).toBe(device.body.sequence);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/commands/start`)
      .set('Idempotency-Key', 'start-device-confirmed')
      .send({
        operator_id: 'test-operator',
        confirmation_id: confirmation.body.confirmation_id,
        intent: 'device.start',
        expected_sequence: device.body.sequence,
      })
      .expect(201);
    expect(response.body.state).toBe('ready');
  });

  it('rejects a device command when state changes after confirmation', async () => {
    const device = await request(app.getHttpServer())
      .get(`/api/v1/devices/${deviceId}`)
      .expect(200);
    const staleConfirmation = await request(app.getHttpServer())
      .post('/api/v1/safety/confirmations')
      .set('Idempotency-Key', 'confirm-stale-reconnect-001')
      .send({
        operator_id: 'test-operator',
        device_id: deviceId,
        intent: 'device.reconnect',
        confirmed: true,
        expected_sequence: device.body.sequence,
      })
      .expect(201);
    const focusConfirmation = await request(app.getHttpServer())
      .post('/api/v1/safety/confirmations')
      .set('Idempotency-Key', 'confirm-focus-before-stale-001')
      .send({
        operator_id: 'test-operator',
        device_id: deviceId,
        intent: 'device.focus',
        confirmed: true,
        expected_sequence: device.body.sequence,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/focus`)
      .set('Idempotency-Key', 'focus-before-stale-001')
      .send({
        operator_id: 'test-operator',
        confirmation_id: focusConfirmation.body.confirmation_id,
        intent: 'device.focus',
        expected_sequence: device.body.sequence,
      })
      .expect(201);

    const stale = await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/commands/reconnect`)
      .set('Idempotency-Key', 'execute-stale-reconnect-001')
      .send({
        operator_id: 'test-operator',
        confirmation_id: staleConfirmation.body.confirmation_id,
        intent: 'device.reconnect',
        expected_sequence: device.body.sequence,
      })
      .expect(409);
    expect(stale.body.code).toBe('command.stale');

    const rejectedAudit = await request(app.getHttpServer())
      .get('/api/v1/audit?type=command.stale')
      .expect(200);
    expect(rejectedAudit.body.items).toContainEqual(expect.objectContaining({
      type: 'command.stale',
      operator_id: 'test-operator',
      result: 'rejected',
      metadata: expect.objectContaining({
        error_code: 'command.stale',
        confirmation_id: staleConfirmation.body.confirmation_id,
        intent: 'device.reconnect',
      }),
    }));
  });

  it('rejects expected_sequence on safety.stop-all confirmations', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/safety/confirmations')
      .set('Idempotency-Key', 'reject-stop-all-sequence-001')
      .send({
        operator_id: 'test-operator',
        intent: 'safety.stop-all',
        confirmed: true,
        expected_sequence: 1,
      })
      .expect(422);
    expect(response.body.code).toBe('schema.invalid');
  });

  it('executes stop-all only after consuming a server-issued confirmation', async () => {
    const confirmation = await request(app.getHttpServer())
      .post('/api/v1/safety/confirmations')
      .set('Idempotency-Key', 'confirm-stop-all-001')
      .send({
        operator_id: 'test-operator',
        intent: 'safety.stop-all',
        confirmed: true,
      })
      .expect(201);
    const stopped = await request(app.getHttpServer())
      .post('/api/v1/safety/stop-all')
      .set('Idempotency-Key', 'execute-stop-all-001')
      .send({
        operator_id: 'test-operator',
        confirmation_id: confirmation.body.confirmation_id,
        intent: 'safety.stop-all',
      })
      .expect(201);
    expect(stopped.body).toEqual(expect.objectContaining({ stopped: 1, failed: 0 }));
  });

  it.each([
    ['password', 'synthetic'],
    ['otp', 'not-a-real-code'],
    ['id_card', 'synthetic-id'],
    ['payment_token', 'synthetic-token'],
  ])('denies sensitive field %s before DTO validation', async (field, value) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Idempotency-Key', `deny-${field}-field`)
      .send({ alias: 'Denied', provider: 'mock-adapter', transport: 'memory', [field]: value })
      .expect(403);
    expect(response.body.code).toBe('policy.denied');
  });

  it('denies prohibited command routes with a stable policy code', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/commands/click`)
      .send({})
      .expect(403);
    expect(response.body.code).toBe('policy.denied');
  });

  it('creates a schedule but rejects acknowledgement before a reminder fires', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/schedules')
      .set('Idempotency-Key', 'create-schedule-001')
      .send({
        label: 'Synthetic reminder',
        public_reference: 'https://example.invalid/event/fixture',
        starts_at: new Date(clock.nowEpochMs() + 3600000).toISOString(),
        timezone: 'Asia/Shanghai',
        reminders: [{ offset_seconds: -60, channel: 'desktop' }],
      })
      .expect(201);
    const acknowledged = await request(app.getHttpServer())
      .post(`/api/v1/schedules/${created.body.id}/acknowledge`)
      .set('Idempotency-Key', 'ack-schedule-001')
      .send({ operator_id: 'test-operator' })
      .expect(409);
    expect(acknowledged.body.code).toBe('schedule.not_notified');
  });

  it('rejects schedule timestamps without an explicit UTC offset', async () => {
    const timestampWithoutOffset = new Date(clock.nowEpochMs() + 3600000)
      .toISOString()
      .replace(/Z$/, '');
    const response = await request(app.getHttpServer())
      .post('/api/v1/schedules')
      .set('Idempotency-Key', 'create-schedule-no-offset')
      .send({
        label: 'Ambiguous reminder',
        starts_at: timestampWithoutOffset,
        timezone: 'Asia/Shanghai',
        reminders: [{ offset_seconds: -60, channel: 'desktop' }],
      })
      .expect(422);
    expect(response.body.code).toBe('schema.invalid');
  });

  it('rejects free-form operator headers before they can reach audit storage', async () => {
    const registration = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Idempotency-Key', 'register-device-invalid-operator')
      .set('X-Operator-Id', 'display name with spaces')
      .send({ alias: 'Rejected operator', provider: 'mock-adapter', transport: 'memory' })
      .expect(422);
    expect(registration.body.code).toBe('schema.invalid');

    const response = await request(app.getHttpServer())
      .post('/api/v1/schedules')
      .set('Idempotency-Key', 'create-schedule-invalid-operator')
      .set('X-Operator-Id', 'display name with spaces')
      .send({
        label: 'Invalid operator fixture',
        starts_at: new Date(clock.nowEpochMs() + 3600000).toISOString(),
        timezone: 'UTC',
        reminders: [{ offset_seconds: -60, channel: 'desktop' }],
      })
      .expect(422);
    expect(response.body.code).toBe('schema.invalid');

    const audit = await request(app.getHttpServer()).get('/api/v1/audit').expect(200);
    expect(JSON.stringify(audit.body)).not.toContain('display name with spaces');
  });

  it('rejects reminder targets that have already elapsed', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/schedules')
      .set('Idempotency-Key', 'create-schedule-expired-reminder')
      .send({
        label: 'Expired reminder target',
        starts_at: new Date(clock.nowEpochMs() + 60_000).toISOString(),
        timezone: 'UTC',
        reminders: [{ offset_seconds: -604800, channel: 'desktop' }],
      })
      .expect(422);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'schema.invalid',
      message: expect.stringContaining('reminder target'),
    }));
  });

  it('rejects explicit nulls for optional JSON fields instead of throwing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/schedules')
      .set('Idempotency-Key', 'create-schedule-null-label')
      .send({
        label: null,
        starts_at: new Date(clock.nowEpochMs() + 3600000).toISOString(),
        timezone: 'UTC',
        reminders: [{ offset_seconds: -60, channel: 'desktop' }],
      })
      .expect(422);
    expect(response.body.code).toBe('schema.invalid');
  });

  it('exposes redacted audit records', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/audit').expect(200);
    expect(response.body.total).toBeGreaterThan(0);
    expect(response.body.page_size).toBe(50);
    expect(response.body.pageSize).toBeUndefined();
    expect(response.body.items[0].occurred_at).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain('synthetic-token');
    expect(JSON.stringify(response.body)).not.toContain('not-a-real-code');
  });
});
