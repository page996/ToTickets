import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request, { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { ScheduleRepository } from '../src/common/storage/schedule.repository';
import { ClockService } from '../src/common/time/clock.service';
import { installIsolatedTestEnvironment } from './test-environment';

type JsonObject = Record<string, unknown>;

interface OpenApiOperation extends JsonObject {
  operationId: string;
  parameters?: unknown[];
  requestBody?: JsonObject;
  responses: Record<string, JsonObject>;
}

interface ControllerRoute {
  method: string;
  path: string;
  successStatus: number;
}

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'put', 'delete', 'head', 'options']);
const GLOBAL_PREFIX = '/api/v1';
const SPEC_PATH = resolve(__dirname, '../../../docs/openapi.v1.json');
const document = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as JsonObject;

describe('OpenAPI 3.1 REST contract', () => {
  let app: INestApplication;
  let clock: ClockService;
  const originalEnv = process.env;

  beforeAll(async () => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(GLOBAL_PREFIX.slice(1));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        errorHttpStatusCode: 422,
        stopAtFirstError: false,
      }),
    );
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    clock = app.get(ClockService);
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('covers exactly every decorated HTTP route with unique operation ids and schemas', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document).not.toHaveProperty('servers');
    assertAllReferencesResolve(document);

    const actualRoutes = collectControllerRoutes(AppModule);
    const documented = collectDocumentedOperations();
    expect([...documented.keys()].sort()).toEqual(
      actualRoutes.map(routeKey).sort(),
    );

    const operationIds = [...documented.values()].map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.every((operationId) => /^[a-z][A-Za-z0-9]+$/.test(operationId))).toBe(true);

    for (const route of actualRoutes) {
      const operation = documented.get(routeKey(route));
      expect(operation).toBeDefined();
      expect(operation?.responses).toHaveProperty(String(route.successStatus));
      expect(operation?.responses).toHaveProperty('500');
      assertResponseHasJsonSchema(operation!.responses[String(route.successStatus)]!);
      for (const responseObject of Object.values(operation!.responses)) {
        assertResponseHasJsonSchema(responseObject);
      }

      if (route.method === 'post' || route.method === 'patch') {
        expect(operation?.requestBody).toBeDefined();
        expect(requestSchema(operation!)).toBeDefined();
        expect(resolveParameters(operation!).some((parameter) =>
          parameter.name === 'Idempotency-Key' && parameter.in === 'header' && parameter.required === true,
        )).toBe(true);
      } else {
        expect(operation?.requestBody).toBeUndefined();
      }
    }

    const paths = document.paths as Record<string, JsonObject>;
    for (const [path, pathItem] of Object.entries(paths)) {
      const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      if (placeholders.length === 0) continue;
      const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      for (const [method, candidate] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const operation = candidate as OpenApiOperation;
        const parameters = [...sharedParameters, ...(operation.parameters ?? [])]
          .map((parameter) => resolveObject(parameter));
        for (const placeholder of placeholders) {
          expect(parameters.some((parameter) =>
            parameter.name === placeholder && parameter.in === 'path' && parameter.required === true,
          )).toBe(true);
        }
      }
    }
  });

  it('keeps conditional confirmation and strict request schemas aligned with policy', () => {
    const validDeviceConfirmation = {
      operator_id: 'contract-operator',
      intent: 'device.start',
      device_id: '00000000-0000-4000-8000-000000000001',
      confirmed: true,
      expected_sequence: 1,
    };
    expectRequestValid('post', '/api/v1/safety/confirmations', validDeviceConfirmation);
    expectRequestInvalid('post', '/api/v1/safety/confirmations', {
      operator_id: 'contract-operator',
      intent: 'safety.stop-all',
      confirmed: false,
    });
    expectRequestInvalid('post', '/api/v1/safety/confirmations', {
      ...validDeviceConfirmation,
      intent: 'safety.stop-all',
    });
    expectRequestInvalid('post', '/api/v1/safety/confirmations', {
      operator_id: 'contract-operator',
      intent: 'device.start',
      confirmed: true,
    });
    expectRequestInvalid('post', '/api/v1/devices/{id}/commands/start', {
      operator_id: 'contract-operator',
      confirmation_id: '00000000-0000-4000-8000-000000000002',
      intent: 'device.stop',
      expected_sequence: 1,
    });
    expectRequestInvalid('post', '/api/v1/devices', {
      alias: 'Synthetic device',
      provider: 'mock-adapter',
      transport: 'memory',
      password: 'not-accepted',
    });
    expectRequestValid('patch', '/api/v1/schedules/{id}', { label: 'renamed', reminders: [{ offset_seconds: -60, channel: 'desktop' }] });
    expectRequestValid('patch', '/api/v1/schedules/{id}', { state: 'cancelled' });
    expectRequestInvalid('patch', '/api/v1/schedules/{id}', { state: 'cancelled', label: 'renamed' });
    expectRequestInvalid('patch', '/api/v1/schedules/{id}', { state: 'cancelled', reminders: [{ offset_seconds: -60, channel: 'desktop' }] });
    expectRequestInvalid('patch', '/api/v1/schedules/{id}', {});
    expectRequestInvalid('post', '/api/v1/devices', {
      alias: 'Synthetic device',
      provider: 'mock-adapter',
      transport: 'memory',
      group: '   ',
    });
  });

  it('validates successful runtime responses for every documented operation', async () => {
    const exercised = new Set<string>();
    const capture = (method: string, path: string, response: Response): Response => {
      expect(response.status).toBe(successStatus(method, path));
      expectResponseValid(method, path, response.status, response.body as unknown);
      exercised.add(`${method} ${path}`);
      return response;
    };

    capture('get', '/api/v1/health/live', await request(app.getHttpServer()).get('/api/v1/health/live'));
    capture('get', '/api/v1/health/ready', await request(app.getHttpServer()).get('/api/v1/health/ready'));
    capture(
      'get',
      '/api/v1/health/diagnostics',
      await request(app.getHttpServer()).get('/api/v1/health/diagnostics'),
    );
    capture(
      'get',
      '/api/v1/hosts/probe',
      await request(app.getHttpServer()).get('/api/v1/hosts/probe'),
    );
    capture(
      'get',
      '/api/v1/hosts/providers',
      await request(app.getHttpServer()).get('/api/v1/hosts/providers'),
    );

    const registration = {
      alias: 'OpenAPI mock device',
      provider: 'mock-adapter',
      transport: 'memory',
      group: 'contract-fixture',
    };
    expectRequestValid('post', '/api/v1/devices', registration);
    const registered = capture(
      'post',
      '/api/v1/devices',
      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Idempotency-Key', 'openapi-register-device')
        .set('X-Operator-Id', 'contract-operator')
        .send(registration),
    );
    const deviceId = String(registered.body.id);

    capture(
      'get',
      '/api/v1/devices',
      await request(app.getHttpServer()).get('/api/v1/devices?state=offline&group=contract-fixture'),
    );
    capture(
      'get',
      '/api/v1/devices/{id}',
      await request(app.getHttpServer()).get(`/api/v1/devices/${deviceId}`),
    );

    const schedulePayload = {
      label: 'OpenAPI reminder fixture',
      public_reference: 'https://example.invalid/event/openapi-fixture',
      starts_at: new Date(clock.nowEpochMs() + 3_600_000).toISOString(),
      timezone: 'Asia/Shanghai',
      reminders: [{ offset_seconds: -60, channel: 'desktop' }],
    };
    expectRequestValid('post', '/api/v1/schedules', schedulePayload);
    const createdSchedule = capture(
      'post',
      '/api/v1/schedules',
      await request(app.getHttpServer())
        .post('/api/v1/schedules')
        .set('Idempotency-Key', 'openapi-create-schedule')
        .set('X-Operator-Id', 'contract-operator')
        .send(schedulePayload),
    );
    const scheduleId = String(createdSchedule.body.id);

    capture('get', '/api/v1/schedules', await request(app.getHttpServer()).get('/api/v1/schedules'));
    capture(
      'get',
      '/api/v1/schedules/{id}',
      await request(app.getHttpServer()).get(`/api/v1/schedules/${scheduleId}`),
    );
    const updateSchedule = { label: 'Updated OpenAPI reminder fixture' };
    expectRequestValid('patch', '/api/v1/schedules/{id}', updateSchedule);
    capture(
      'patch',
      '/api/v1/schedules/{id}',
      await request(app.getHttpServer())
        .patch(`/api/v1/schedules/${scheduleId}`)
        .set('Idempotency-Key', 'openapi-update-schedule')
        .set('X-Operator-Id', 'contract-operator')
        .send(updateSchedule),
    );

    app.get(ScheduleRepository).update(scheduleId, (schedule) => {
      schedule.state = 'notified';
    });
    const acknowledge = { operator_id: 'contract-operator' };
    expectRequestValid('post', '/api/v1/schedules/{id}/acknowledge', acknowledge);
    capture(
      'post',
      '/api/v1/schedules/{id}/acknowledge',
      await request(app.getHttpServer())
        .post(`/api/v1/schedules/${scheduleId}/acknowledge`)
        .set('Idempotency-Key', 'openapi-acknowledge-schedule')
        .send(acknowledge),
    );
    capture('get', '/api/v1/clock', await request(app.getHttpServer()).get('/api/v1/clock'));

    const executeDeviceCommand = async (path: string, intent: string, key: string): Promise<void> => {
      const snapshot = await request(app.getHttpServer()).get(`/api/v1/devices/${deviceId}`).expect(200);
      const confirmationPayload = {
        operator_id: 'contract-operator',
        device_id: deviceId,
        intent,
        confirmed: true,
        expected_sequence: snapshot.body.sequence,
      };
      expectRequestValid('post', '/api/v1/safety/confirmations', confirmationPayload);
      const confirmation = capture(
        'post',
        '/api/v1/safety/confirmations',
        await request(app.getHttpServer())
          .post('/api/v1/safety/confirmations')
          .set('Idempotency-Key', `openapi-confirm-${key}`)
          .send(confirmationPayload),
      );
      const commandPayload = {
        operator_id: 'contract-operator',
        confirmation_id: confirmation.body.confirmation_id,
        intent,
        expected_sequence: snapshot.body.sequence,
      };
      expectRequestValid('post', path, commandPayload);
      capture(
        'post',
        path,
        await request(app.getHttpServer())
          .post(path.replace('{id}', deviceId))
          .set('Idempotency-Key', `openapi-command-${key}`)
          .send(commandPayload),
      );
    };

    await executeDeviceCommand('/api/v1/devices/{id}/commands/start', 'device.start', 'start');
    await executeDeviceCommand('/api/v1/devices/{id}/focus', 'device.focus', 'focus');
    await executeDeviceCommand('/api/v1/devices/{id}/preview/start', 'preview.start', 'preview-start');
    await executeDeviceCommand('/api/v1/devices/{id}/preview/stop', 'preview.stop', 'preview-stop');
    await executeDeviceCommand('/api/v1/devices/{id}/commands/reconnect', 'device.reconnect', 'reconnect');
    await executeDeviceCommand('/api/v1/devices/{id}/commands/stop', 'device.stop', 'stop');

    const stopAllConfirmationPayload = {
      operator_id: 'contract-operator',
      intent: 'safety.stop-all',
      confirmed: true,
    };
    expectRequestValid('post', '/api/v1/safety/confirmations', stopAllConfirmationPayload);
    const stopAllConfirmation = capture(
      'post',
      '/api/v1/safety/confirmations',
      await request(app.getHttpServer())
        .post('/api/v1/safety/confirmations')
        .set('Idempotency-Key', 'openapi-confirm-stop-all')
        .send(stopAllConfirmationPayload),
    );
    const stopAllPayload = {
      operator_id: 'contract-operator',
      confirmation_id: stopAllConfirmation.body.confirmation_id,
      intent: 'safety.stop-all',
    };
    expectRequestValid('post', '/api/v1/safety/stop-all', stopAllPayload);
    capture(
      'post',
      '/api/v1/safety/stop-all',
      await request(app.getHttpServer())
        .post('/api/v1/safety/stop-all')
        .set('Idempotency-Key', 'openapi-execute-stop-all')
        .send(stopAllPayload),
    );

    capture(
      'get',
      '/api/v1/audit',
      await request(app.getHttpServer()).get('/api/v1/audit?page=1&page_size=20'),
    );
    capture(
      'get',
      '/api/v1/audit/export',
      await request(app.getHttpServer()).get('/api/v1/audit/export'),
    );

    expect([...exercised].sort()).toEqual([...collectDocumentedOperations().keys()].sort());
  });

  it('validates the documented error envelope against an actual rejected request', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .send({ alias: 'Missing key', provider: 'mock-adapter', transport: 'memory' })
      .expect(422);
    expectResponseValid('post', '/api/v1/devices', 422, response.body as unknown);
    expect(response.body).toEqual(expect.objectContaining({
      request_id: expect.any(String),
      code: 'schema.invalid',
      message: expect.any(String),
    }));
  });
});

function collectControllerRoutes(rootModule: Function): ControllerRoute[] {
  const controllers = new Set<Function>();
  const modules = new Set<Function>();

  const visit = (candidate: unknown): void => {
    const moduleType = moduleClassOf(candidate);
    if (!moduleType || modules.has(moduleType)) return;
    modules.add(moduleType);
    const declared = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) as Function[] | undefined;
    for (const controller of declared ?? []) controllers.add(controller);
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[] | undefined;
    for (const imported of imports ?? []) visit(imported);
  };
  visit(rootModule);

  const routes: ControllerRoute[] = [];
  for (const controller of controllers) {
    const controllerPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, controller));
    const prototype = controller.prototype as object;
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (typeof descriptor?.value !== 'function') continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, descriptor.value) as RequestMethod | undefined;
      if (requestMethod === undefined) continue;
      const method = String(RequestMethod[requestMethod]).toLowerCase();
      const methodPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, descriptor.value));
      const explicitStatus = Reflect.getMetadata(HTTP_CODE_METADATA, descriptor.value) as number | undefined;
      for (const controllerPath of controllerPaths) {
        for (const methodPath of methodPaths) {
          routes.push({
            method,
            path: joinRoutePaths(GLOBAL_PREFIX, controllerPath, methodPath),
            successStatus: explicitStatus ?? (method === 'post' ? 201 : 200),
          });
        }
      }
    }
  }
  return routes.sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
}

function moduleClassOf(candidate: unknown): Function | undefined {
  if (typeof candidate === 'function') return candidate;
  if (!isObject(candidate)) return undefined;
  return typeof candidate.module === 'function' ? candidate.module : undefined;
}

function metadataPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [typeof value === 'string' ? value : ''];
}

function joinRoutePaths(...segments: string[]): string {
  const joined = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`.replace(/:([^/]+)/g, '{$1}');
}

function collectDocumentedOperations(): Map<string, OpenApiOperation> {
  const operations = new Map<string, OpenApiOperation>();
  const paths = document.paths as Record<string, JsonObject>;
  for (const [path, pathItem] of Object.entries(paths)) {
    expect(path.startsWith(GLOBAL_PREFIX)).toBe(true);
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      operations.set(`${method} ${path}`, candidate as OpenApiOperation);
    }
  }
  return operations;
}

function routeKey(route: ControllerRoute): string {
  return `${route.method} ${route.path}`;
}

function successStatus(method: string, path: string): number {
  const operation = collectDocumentedOperations().get(`${method} ${path}`);
  if (!operation) throw new Error(`OpenAPI operation is missing: ${method} ${path}`);
  const statuses = Object.keys(operation.responses).map(Number).filter((status) => status >= 200 && status < 300);
  if (statuses.length !== 1) throw new Error(`Expected one success response for ${method} ${path}`);
  return statuses[0]!;
}

function requestSchema(operation: OpenApiOperation): JsonObject {
  const requestBody = resolveObject(operation.requestBody);
  const content = requestBody.content as Record<string, JsonObject> | undefined;
  const mediaType = content?.['application/json'];
  if (!mediaType || !isObject(mediaType.schema)) throw new Error(`Missing JSON request schema for ${operation.operationId}`);
  return mediaType.schema;
}

function resolveParameters(operation: OpenApiOperation): JsonObject[] {
  return (operation.parameters ?? []).map((parameter) => resolveObject(parameter));
}

function assertResponseHasJsonSchema(response: JsonObject): void {
  const resolved = resolveObject(response);
  const content = resolved.content as Record<string, JsonObject> | undefined;
  expect(content?.['application/json']).toBeDefined();
  expect(content?.['application/json']?.schema).toBeDefined();
  const headers = resolved.headers as Record<string, unknown> | undefined;
  expect(headers?.['X-Request-Id']).toBeDefined();
}

function expectRequestValid(method: string, path: string, payload: unknown): void {
  const operation = collectDocumentedOperations().get(`${method} ${path}`);
  if (!operation) throw new Error(`OpenAPI operation is missing: ${method} ${path}`);
  expect(validateSchema(payload, requestSchema(operation))).toEqual([]);
}

function expectRequestInvalid(method: string, path: string, payload: unknown): void {
  const operation = collectDocumentedOperations().get(`${method} ${path}`);
  if (!operation) throw new Error(`OpenAPI operation is missing: ${method} ${path}`);
  expect(validateSchema(payload, requestSchema(operation))).not.toEqual([]);
}

function expectResponseValid(method: string, path: string, status: number, payload: unknown): void {
  const operation = collectDocumentedOperations().get(`${method} ${path}`);
  if (!operation) throw new Error(`OpenAPI operation is missing: ${method} ${path}`);
  const response = resolveObject(operation.responses[String(status)]);
  const content = response.content as Record<string, JsonObject>;
  const schema = content['application/json']?.schema;
  if (!isObject(schema)) throw new Error(`Response schema is missing: ${method} ${path} ${status}`);
  expect(validateSchema(payload, schema)).toEqual([]);
}

function assertAllReferencesResolve(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAllReferencesResolve(item);
    return;
  }
  if (!isObject(value)) return;
  if (typeof value.$ref === 'string') expect(() => resolveReference(value.$ref as string)).not.toThrow();
  for (const nested of Object.values(value)) assertAllReferencesResolve(nested);
}

function resolveObject(value: unknown): JsonObject {
  if (!isObject(value)) throw new Error('Expected an OpenAPI object');
  if (typeof value.$ref !== 'string') return value;
  const resolved = resolveReference(value.$ref);
  if (!isObject(resolved)) throw new Error(`Reference does not resolve to an object: ${value.$ref}`);
  return resolved;
}

function resolveReference(reference: string): unknown {
  if (!reference.startsWith('#/')) throw new Error(`Only local OpenAPI references are supported: ${reference}`);
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, part) => isObject(current) ? current[part] : undefined, document);
}

function validateSchema(value: unknown, inputSchema: JsonObject, pointer = '$'): string[] {
  const schema = resolveObject(inputSchema);
  const errors: string[] = [];

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (isObject(branch)) errors.push(...validateSchema(value, branch, pointer));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) =>
      isObject(branch) && validateSchema(value, branch, pointer).length === 0,
    ).length;
    if (matches !== 1) errors.push(`${pointer} must match exactly one oneOf branch`);
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((branch) =>
      isObject(branch) && validateSchema(value, branch, pointer).length === 0,
    ).length;
    if (matches === 0) errors.push(`${pointer} must match at least one anyOf branch`);
  }
  if ('const' in schema && !Object.is(value, schema.const)) {
    errors.push(`${pointer} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${pointer} must be one of the declared values`);
  }

  const declaredTypes = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type) ? schema.type.map(String) : [];
  if (declaredTypes.length > 0 && !declaredTypes.some((type) => matchesType(value, type))) {
    errors.push(`${pointer} must be ${declaredTypes.join(' or ')}`);
    return errors;
  }

  if (isObject(value) && (declaredTypes.includes('object') || schema.properties || schema.required)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${pointer}.${key} is required`);
    }
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
      errors.push(`${pointer} has too few properties`);
    }
    for (const [key, nested] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (isObject(propertySchema)) {
        errors.push(...validateSchema(nested, propertySchema, `${pointer}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}.${key} is not allowed`);
      } else if (isObject(schema.additionalProperties)) {
        errors.push(...validateSchema(nested, schema.additionalProperties, `${pointer}.${key}`));
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${pointer} has too few items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${pointer} has too many items`);
    if (isObject(schema.items)) {
      value.forEach((item, index) => errors.push(...validateSchema(item, schema.items as JsonObject, `${pointer}[${index}]`)));
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${pointer} is too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${pointer} is too long`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${pointer} does not match its pattern`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errors.push(`${pointer} is not a date-time`);
    if (schema.format === 'uri') {
      try {
        new URL(value);
      } catch {
        errors.push(`${pointer} is not a URI`);
      }
    }
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${pointer} is not a UUID`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${pointer} is below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${pointer} is above maximum`);
  }
  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
