import { describe, expect, it, vi } from 'vitest';
import type { ConsoleRuntimeConfig } from '../config/runtime-config';
import { ApiClient, ControlPlaneError } from './api-client';

const config: ConsoleRuntimeConfig = {
  schemaVersion: 'console-runtime.v1',
  apiBaseUrl: requiredTestEnvironment('CONSOLE_TEST_API_BASE_URL').replace(/\/$/, ''),
  eventsUrl: requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL').replace(/\/$/, ''),
  operatorId: 'test-operator',
  refreshIntervalMs: 2000,
  staleAfterMs: 10000,
};

const DEVICE_ID = '00000000-0000-4000-8000-000000000001';
const SCHEDULE_ID = '00000000-0000-4000-8000-000000000002';
const AUDIT_ID = '00000000-0000-4000-8000-000000000003';
const CORRELATION_ID = '00000000-0000-4000-8000-000000000004';
const CONFIRMATION_ID = '00000000-0000-4000-8000-000000000005';

describe('ApiClient', () => {
  it('invokes fetch with globalThis as the receiver', async () => {
    let receiver: unknown;
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({ request_id: 'request-receiver', items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    };
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await client.listDevices();

    expect(receiver).toBe(globalThis);
  });

  it('builds resource URLs from injected configuration and maps snake_case devices', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        request_id: 'request-devices',
        items: [{
          id: DEVICE_ID,
          alias: 'Mock 01',
          provider: 'mock-adapter',
          transport: 'memory',
          state: 'ready',
          stream: 'stopped',
          focused: false,
          capabilities: {
            lifecycle: true,
            health_read: true,
            screen_preview: true,
            user_input: false,
            automation: false,
          },
          last_seen_at: '2026-08-25T08:00:00.000Z',
          sequence: 3,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    const devices = await client.listDevices();

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(new URL('devices', `${config.apiBaseUrl}/`).toString());
    expect(devices.items[0]).toEqual(expect.objectContaining({
      id: DEVICE_ID,
      lastSeenAt: '2026-08-25T08:00:00.000Z',
    }));
    expect(devices.items[0]).not.toHaveProperty('last_seen_at');
  });

  it.each([
    ['lifecycle', { lifecycle: false }],
    ['health_read', { health_read: false }],
    ['screen_preview', { screen_preview: false }],
    ['user_input', { user_input: true }],
    ['automation', { automation: true }],
  ])('rejects a device with an unsafe %s capability flag', async (_field, change) => {
    const capabilities = {
      lifecycle: true,
      health_read: true,
      screen_preview: true,
      user_input: false,
      automation: false,
      ...change,
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'request-invalid-capability',
      items: [{
        id: DEVICE_ID,
        alias: 'Mock 01',
        provider: 'mock-adapter',
        transport: 'memory',
        state: 'ready',
        stream: 'stopped',
        focused: false,
        capabilities,
        last_seen_at: '2026-08-25T08:00:00.000Z',
        sequence: 1,
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.listDevices()).rejects.toMatchObject({ code: 'response.invalid' });
  });

  it('maps schedule and audit collection fields at the wire boundary', async () => {
    const responses = [
      {
        request_id: 'request-schedules',
        items: [{
          id: SCHEDULE_ID,
          label: 'Synthetic reminder',
          starts_at: '2026-08-25T09:00:00.000Z',
          timezone: 'Asia/Shanghai',
          reminders: [{ offset_seconds: -60, channel: 'desktop' }],
          state: 'scheduled',
          created_at: '2026-08-25T08:00:00.000Z',
          updated_at: '2026-08-25T08:00:00.000Z',
        }],
      },
      {
        request_id: 'request-audit',
        items: [{
          id: AUDIT_ID,
          type: 'schedule.created',
          occurred_at: '2026-08-25T08:00:00.000Z',
          operator_id: 'test-operator',
          schedule_id: SCHEDULE_ID,
          correlation_id: CORRELATION_ID,
          policy_version: 'test-policy.v1',
          result: 'accepted',
          metadata: { source: 'control-plane' },
        }],
        page: 2,
        page_size: 25,
        total: 26,
      },
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    const schedules = await client.listSchedules();
    const audit = await client.listAudit({ page: 2, pageSize: 25 });

    expect(schedules.items[0]).toEqual(expect.objectContaining({
      startsAt: '2026-08-25T09:00:00.000Z',
      reminders: [{ offsetSeconds: -60, channel: 'desktop' }],
    }));
    expect(audit).toEqual(expect.objectContaining({ page: 2, pageSize: 25, total: 26 }));
    expect(audit.items[0]).toEqual(expect.objectContaining({
      occurredAt: '2026-08-25T08:00:00.000Z',
      operatorId: 'test-operator',
      scheduleId: SCHEDULE_ID,
    }));
  });

  it('uses separate idempotent writes to issue and consume a stop-all confirmation', async () => {
    const responses = [
      {
        request_id: 'request-confirmation',
        confirmation_id: CONFIRMATION_ID,
        intent: 'safety.stop-all',
        expires_at: '2026-08-25T08:01:00.000Z',
      },
      { request_id: 'request-stop-all', stopped: 0, failed: 0 },
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(responses.shift()), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.stopAll({
      confirmation: 'confirmation-intent-key',
      command: 'stop-all-intent-key',
    })).resolves.toEqual({ stopped: 0, failed: 0 });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      new URL('safety/confirmations', `${config.apiBaseUrl}/`).toString(),
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      new URL('safety/stop-all', `${config.apiBaseUrl}/`).toString(),
    );
    const firstInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const secondInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    const firstHeaders = new Headers(firstInit.headers);
    const secondHeaders = new Headers(secondInit.headers);
    expect(firstHeaders.get('Idempotency-Key')).toBe('confirmation-intent-key');
    expect(secondHeaders.get('Idempotency-Key')).toBe('stop-all-intent-key');
    expect(firstHeaders.get('X-Operator-Id')).toBe('test-operator');
    expect(JSON.parse(String(firstInit.body))).toEqual({
      operator_id: 'test-operator',
      intent: 'safety.stop-all',
      confirmed: true,
    });
    expect(JSON.parse(String(secondInit.body))).toEqual({
      operator_id: 'test-operator',
      confirmation_id: CONFIRMATION_ID,
      intent: 'safety.stop-all',
    });
  });

  it('binds a device confirmation and lifecycle command to the same snapshot sequence', async () => {
    const device = {
      request_id: 'request-device',
      id: DEVICE_ID,
      alias: 'Mock 01',
      provider: 'mock-adapter',
      transport: 'memory',
      state: 'ready',
      stream: 'stopped',
      focused: false,
      capabilities: {
        lifecycle: true,
        health_read: true,
        screen_preview: true,
        user_input: false,
        automation: false,
      },
      last_seen_at: '2026-08-25T08:00:00.000Z',
      sequence: 2,
    };
    const responses = [
      {
        request_id: 'request-confirmation',
        confirmation_id: CONFIRMATION_ID,
        intent: 'device.start',
        expires_at: '2026-08-25T08:01:00.000Z',
        expected_sequence: 2,
      },
      device,
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(responses.shift()), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);
    const confirmation = await client.issueConfirmation(
      'device.start',
      DEVICE_ID,
      2,
      'stable-confirmation-intent-key',
    );
    await client.deviceCommand(
      DEVICE_ID,
      'start',
      confirmation,
      'stable-device-intent-key',
    );

    const confirmationInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const commandInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(confirmationInit.body))).toEqual({
      operator_id: 'test-operator',
      intent: 'device.start',
      device_id: DEVICE_ID,
      expected_sequence: 2,
      confirmed: true,
    });
    expect(JSON.parse(String(commandInit.body))).toEqual({
      operator_id: 'test-operator',
      confirmation_id: CONFIRMATION_ID,
      intent: 'device.start',
      expected_sequence: 2,
    });
    expect(new Headers(confirmationInit.headers).get('Idempotency-Key')).toBe('stable-confirmation-intent-key');
    expect(new Headers(commandInit.headers).get('Idempotency-Key')).toBe('stable-device-intent-key');
  });

  it('rejects a confirmation ticket whose intent differs from the request', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'request-mismatched-confirmation',
      confirmation_id: CONFIRMATION_ID,
      intent: 'device.stop',
      expires_at: '2026-08-25T08:01:00.000Z',
      expected_sequence: 2,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.issueConfirmation('device.start', DEVICE_ID, 2))
      .rejects.toMatchObject({ code: 'response.invalid' });
  });

  it.each([
    { public_reference: '' },
    { acknowledged_at: null },
    { reminders: [{ offset_seconds: -60, channel: 'desktop', extra: true }] },
  ])('rejects malformed optional schedule fields', async (change) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'request-invalid-schedule',
      items: [{
        id: SCHEDULE_ID,
        label: 'Synthetic reminder',
        starts_at: '2026-08-25T09:00:00.000Z',
        timezone: 'Asia/Shanghai',
        reminders: [{ offset_seconds: -60, channel: 'desktop' }],
        state: 'scheduled',
        created_at: '2026-08-25T08:00:00.000Z',
        updated_at: '2026-08-25T08:00:00.000Z',
        ...change,
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.listSchedules()).rejects.toMatchObject({ code: 'response.invalid' });
  });

  it.each([
    { metadata: { source: { nested: true } } },
    { metadata: { source: null } },
    { device_id: '' },
    { schedule_id: 'not-a-uuid' },
  ])('rejects malformed audit optional fields and metadata', async (change) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'request-invalid-audit',
      items: [{
        id: AUDIT_ID,
        type: 'schedule.created',
        occurred_at: '2026-08-25T08:00:00.000Z',
        operator_id: 'test-operator',
        correlation_id: CORRELATION_ID,
        policy_version: 'test-policy.v1',
        result: 'accepted',
        metadata: { source: 'control-plane' },
        ...change,
      }],
      page: 1,
      page_size: 25,
      total: 1,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.listAudit({ page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ code: 'response.invalid' });
  });

  it('includes the confirmation sequence in preview and focus command bodies', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      request_id: 'request-device',
      id: DEVICE_ID,
      alias: 'Mock 01',
      provider: 'mock-adapter',
      transport: 'memory',
      state: 'ready',
      stream: 'stopped',
      focused: true,
      capabilities: {
        lifecycle: true,
        health_read: true,
        screen_preview: true,
        user_input: false,
        automation: false,
      },
      last_seen_at: '2026-08-25T08:00:00.000Z',
      sequence: 3,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);
    const confirmation = {
      operator_id: 'test-operator',
      confirmation_id: CONFIRMATION_ID,
      intent: 'preview.start' as const,
      expected_sequence: 2,
    };

    await client.previewCommand(DEVICE_ID, 'start', confirmation);
    await client.focusDevice(DEVICE_ID, { ...confirmation, intent: 'device.focus' });

    for (const call of fetcher.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({
        expected_sequence: 2,
      }));
    }
  });

  it('preserves structured error details for partial writes', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      request_id: 'request-partial-stop',
      code: 'adapter.unavailable',
      message: 'one or more adapters could not be stopped',
      retryable: true,
      details: { stopped: 2, failed: 1 },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    const error = await client.cancelSchedule(
      SCHEDULE_ID,
      'stable-cancel-key',
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error).toEqual(expect.objectContaining({
      code: 'adapter.unavailable',
      requestId: 'request-partial-stop',
      retryable: true,
      status: 503,
      details: { stopped: 2, failed: 1 },
    }));
  });

  it.each([
    null,
    42,
    { request_id: 'request-invalid-device', items: [{ id: 'device', alias: 'Bad', provider: 'mock-adapter', transport: 'memory', state: 'unknown', stream: 'stopped', focused: false, capabilities: { user_input: false, automation: false }, last_seen_at: '2026-08-25T08:00:00.000Z', sequence: 1 }] },
  ])('rejects malformed successful payloads at the response boundary', async (payload) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.listDevices()).rejects.toMatchObject({ code: 'response.invalid' });
  });

  it('normalizes malformed error payloads without throwing a native type error', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(null), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new ApiClient(config, fetcher as unknown as typeof fetch);

    await expect(client.cancelSchedule(SCHEDULE_ID, 'malformed-error-key'))
      .rejects.toMatchObject({ code: 'request.failed', status: 422 });
  });

  it('does not expose device input or purchase operations', () => {
    const methods = Object.getOwnPropertyNames(ApiClient.prototype).join(' ');
    expect(methods).not.toMatch(/click|tap|input|purchase|captcha|pay|broadcast/i);
  });
});

function requiredTestEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be injected for console tests`);
  return value;
}
