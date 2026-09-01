import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { installIsolatedTestEnvironment } from './test-environment';

describe('Deployment mock-only REST safety contract', () => {
  let app: INestApplication;
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      errorHttpStatusCode: 422,
    }));
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('requires an explicit operator confirmation and an idempotency key', async () => {
    const payload = planPayload();
    await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .send(payload)
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .send({ ...payload, operator_confirmed: false })
      .set('Idempotency-Key', 'deployment-negative-01')
      .expect(422);

    const missingKey = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .send(payload)
      .expect(422);
    expect(missingKey.body.code).toBe('schema.invalid');
  });

  it('keeps plan replay idempotent and rejects a changed payload', async () => {
    const payload = planPayload();
    const first = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-http-001')
      .set('X-Operator-Id', 'http-operator-a')
      .send(payload)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-http-001')
      .set('X-Operator-Id', 'http-operator-a')
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const changed = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-http-001')
      .set('X-Operator-Id', 'http-operator-a')
      .send({ ...payload, instances: 2 })
      .expect(409);
    expect(changed.body.code).toBe('idempotency.replay');
  });

  it('fails closed for non-mock providers and stale generations', async () => {
    const unsupported = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-negative-02')
      .send({
        ...planPayload(),
        provider_id: 'android-emulator-avd',
      })
      .expect(422);
    expect(unsupported.body.code).toBe('schema.invalid');

    const planned = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-http-002')
      .send(planPayload())
      .expect(201);
    const deploymentId = planned.body.id as string;

    const stale = await request(app.getHttpServer())
      .post(`/api/v1/deployments/${deploymentId}/validate`)
      .set('Idempotency-Key', 'deployment-http-003')
      .send({
        operator_confirmed: true,
        expected_generation: 99,
        operation_id: 'deployment-http-stale',
      })
      .expect(409);
    expect(stale.body.code).toBe('command.stale');

    const audit = await request(app.getHttpServer())
      .get('/api/v1/audit?page=1&page_size=200')
      .expect(200);
    expect(audit.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'deployment.operation.rejected',
        result: 'rejected',
        metadata: expect.objectContaining({
          command: 'deployment.validate',
          error_code: 'command.stale',
        }),
      }),
    ]));
    expect(JSON.stringify(audit.body)).not.toContain('ANDROID_');
    expect(JSON.stringify(audit.body)).not.toContain('deployment-http-stale-secret');
  });

  it('binds operation ids to the operator subject over HTTP', async () => {
    const planned = await request(app.getHttpServer())
      .post('/api/v1/deployments/plan')
      .set('Idempotency-Key', 'deployment-http-004')
      .set('X-Operator-Id', 'http-operator-a')
      .send(planPayload())
      .expect(201);
    const deploymentId = planned.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/deployments/${deploymentId}/validate`)
      .set('Idempotency-Key', 'deployment-http-005')
      .set('X-Operator-Id', 'http-operator-a')
      .send({
        operator_confirmed: true,
        expected_generation: 1,
        operation_id: 'deployment-http-bound',
      })
      .expect(200);

    const crossOperator = await request(app.getHttpServer())
      .post(`/api/v1/deployments/${deploymentId}/validate`)
      .set('Idempotency-Key', 'deployment-http-006')
      .set('X-Operator-Id', 'http-operator-b')
      .send({
        operator_confirmed: true,
        expected_generation: 1,
        operation_id: 'deployment-http-bound',
      })
      .expect(403);
    expect(crossOperator.body.code).toBe('policy.denied');
  });
});

function planPayload() {
  return {
    operator_confirmed: true,
    provider_id: 'mock-adapter',
    execution_mode: 'mock_only',
    desired_state: 'ready',
    instances: 1,
  };
}
