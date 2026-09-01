import { AuditService } from '../src/common/audit/audit.service';
import { GlobalOperationCoordinator } from '../src/common/concurrency/global-operation-coordinator.service';
import { KeyedSerialExecutor } from '../src/common/concurrency/keyed-serial-executor.service';
import { ConfirmationService } from '../src/common/confirmation/confirmation.service';
import { EventBusService } from '../src/common/events/event-bus.service';
import { AuditRepository } from '../src/common/storage/audit.repository';
import { DeviceRepository } from '../src/common/storage/device.repository';
import { ClockService } from '../src/common/time/clock.service';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { DeviceAdapter, MockDeviceAdapter } from '../src/devices/device-adapter';
import { DeviceCommandDto } from '../src/devices/device.dto';
import { DeviceService } from '../src/devices/device.service';
import { PolicyService } from '../src/common/policy/policy.service';
import { installIsolatedTestEnvironment } from './test-environment';

const OPERATOR_ID = 'device-service-test';

describe('DeviceService safety invariants', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stops an active preview together with the device lifecycle', async () => {
    const harness = createHarness();
    const device = await registerDevice(harness, 'Preview device');
    await startDevice(harness, device.id);
    await harness.service.focus(device.id, command(harness, device.id, 'device.focus'));
    await harness.service.startPreview(device.id, command(harness, device.id, 'preview.start'));

    const stopped = await harness.service.executeCommand(
      device.id,
      'stop',
      command(harness, device.id, 'device.stop'),
    );

    expect(stopped).toEqual(expect.objectContaining({ state: 'offline', stream: 'stopped' }));
    expect(harness.repository.get(device.id)).toEqual(
      expect.objectContaining({ state: 'offline', stream: 'stopped' }),
    );
    expect(harness.events.replaySince(0).at(-1)?.data).toEqual(
      expect.objectContaining({ device_id: device.id, state: 'offline', stream: 'stopped' }),
    );
  });

  it('records a successful preview stop when the lifecycle stop fails', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'stop').mockImplementationOnce(() => {
      throw new Error('synthetic lifecycle stop failure');
    });
    const previewStop = jest.spyOn(adapter, 'stopReadonlyPreview');
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Partial lifecycle stop device');
    await startActivePreview(harness, device.id);
    const before = harness.repository.get(device.id)!;

    await expect(harness.service.executeCommand(
      device.id,
      'stop',
      command(harness, device.id, 'device.stop'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(previewStop).toHaveBeenCalledWith(device.id, expect.any(String));
    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'stopped',
      sequence: before.sequence + 1,
    }));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({
        command: 'device.stop',
        reason: 'lifecycle-stop',
        stream: 'stopped',
      }),
    }));
    expect(harness.events.replaySince(0).at(-1)?.data).toEqual(expect.objectContaining({
      device_id: device.id,
      state: 'error',
      stream: 'stopped',
    }));
  });

  it('preserves a running preview when the preview stop sub-step fails', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'stop').mockReturnValueOnce('offline');
    jest.spyOn(adapter, 'stopReadonlyPreview').mockImplementationOnce(() => {
      throw new Error('synthetic preview stop failure');
    });
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Partial preview stop device');
    await startActivePreview(harness, device.id);
    const before = harness.repository.get(device.id)!;

    await expect(harness.service.executeCommand(
      device.id,
      'stop',
      command(harness, device.id, 'device.stop'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'running',
      sequence: before.sequence + 1,
    }));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({
        command: 'device.stop',
        reason: 'preview-stop',
        stream: 'running',
      }),
    }));
    expect(harness.events.replaySince(0).at(-1)?.data).toEqual(expect.objectContaining({
      device_id: device.id,
      state: 'error',
      stream: 'running',
    }));
  });

  it('does not report a direct preview stop that the adapter rejected', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'stopReadonlyPreview').mockImplementationOnce(() => {
      throw new Error('synthetic direct preview stop failure');
    });
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Preview stop failure device');
    await startActivePreview(harness, device.id);
    const before = harness.repository.get(device.id)!;
    const eventSequence = harness.events.getCurrentSequence();

    await expect(harness.service.stopPreview(
      device.id,
      command(harness, device.id, 'preview.stop'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'running',
      sequence: before.sequence + 1,
    }));
    expect(harness.events.replaySince(eventSequence)).toEqual([
      expect.objectContaining({
        type: 'device.health.changed',
        data: expect.objectContaining({ state: 'error', stream: 'running' }),
      }),
    ]);
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({ command: 'preview.stop', stream: 'running' }),
    }));
  });

  it('keeps focus and the single active preview on the same device', async () => {
    const harness = createHarness();
    const first = await registerDevice(harness, 'First device');
    const second = await registerDevice(harness, 'Second device');
    await startDevice(harness, first.id);
    await startDevice(harness, second.id);

    const previewConfirmation = command(harness, first.id, 'preview.start');
    await expect(harness.service.startPreview(first.id, previewConfirmation)).rejects.toMatchObject({
      code: 'device.busy',
      status: 409,
    });

    await harness.service.focus(first.id, command(harness, first.id, 'device.focus'));
    await expect(harness.service.startPreview(
      first.id,
      command(harness, first.id, 'preview.start'),
    )).resolves.toEqual(
      expect.objectContaining({ focused: true, stream: 'running' }),
    );

    const secondFocusConfirmation = command(harness, second.id, 'device.focus');
    await expect(harness.service.focus(second.id, secondFocusConfirmation)).rejects.toMatchObject({
      code: 'device.busy',
      status: 409,
    });
    await harness.service.stopPreview(first.id, command(harness, first.id, 'preview.stop'));
    await expect(harness.service.focus(second.id, secondFocusConfirmation)).resolves.toEqual(
      expect.objectContaining({ id: second.id, focused: true }),
    );

    expect(harness.repository.list().filter((candidate) => candidate.focused)).toEqual([
      expect.objectContaining({ id: second.id, stream: 'stopped' }),
    ]);
  });

  it('marks adapter failures and requires a fresh confirmation for retry', async () => {
    const adapter = new MockDeviceAdapter();
    const originalStart = adapter.start.bind(adapter);
    jest.spyOn(adapter, 'start')
      .mockImplementationOnce(() => {
        throw new Error('synthetic adapter failure');
      })
      .mockImplementation(originalStart);
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Failure device');
    const startConfirmation = command(harness, device.id, 'device.start');

    await expect(
      harness.service.executeCommand(device.id, 'start', startConfirmation),
    ).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503, retryable: true });
    expect(harness.repository.get(device.id)).toEqual(
      expect.objectContaining({ state: 'error', stream: 'stopped', sequence: 2 }),
    );
    expect(harness.audits.list()).toContainEqual(
      expect.objectContaining({
        type: 'adapter.failure',
        deviceId: device.id,
        result: 'rejected',
        metadata: expect.objectContaining({ command: 'device.start', state: 'error' }),
      }),
    );
    expect(harness.confirmations.getStats().tickets).toBe(1);

    await expect(
      harness.service.executeCommand(device.id, 'start', startConfirmation),
    ).rejects.toMatchObject({ code: 'command.stale', status: 409 });
    await expect(
      harness.service.executeCommand(
        device.id,
        'start',
        command(harness, device.id, 'device.start'),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: 'ready', stream: 'stopped' }));
    expect(harness.confirmations.getStats().tickets).toBe(0);
  });

  it('rejects an invalid lifecycle state returned by an adapter', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'start').mockReturnValueOnce(
      'invalid-state' as ReturnType<DeviceAdapter['start']>,
    );
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Invalid lifecycle response device');

    await expect(harness.service.executeCommand(
      device.id,
      'start',
      command(harness, device.id, 'device.start'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'stopped',
      sequence: device.sequence + 1,
    }));
  });

  it('rejects a preview adapter result that contradicts the requested operation', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'startReadonlyPreview').mockReturnValueOnce('stopped');
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Invalid preview response device');
    await startDevice(harness, device.id);
    await harness.service.focus(device.id, command(harness, device.id, 'device.focus'));
    const before = harness.repository.get(device.id)!;

    await expect(harness.service.startPreview(
      device.id,
      command(harness, device.id, 'preview.start'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'stopped',
      sequence: before.sequence + 1,
    }));
  });

  it('keeps an active device start idempotent instead of moving it backwards', async () => {
    const adapter = new MockDeviceAdapter();
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Waiting device');
    await startDevice(harness, device.id);
    harness.repository.update(device.id, (record) => {
      record.state = 'waiting';
    });
    const before = harness.repository.get(device.id)!;
    const start = jest.spyOn(adapter, 'start');

    const result = await harness.service.executeCommand(
      device.id,
      'start',
      command(harness, device.id, 'device.start'),
    );

    expect(result).toEqual(expect.objectContaining({ state: 'waiting', sequence: before.sequence }));
    expect(start).not.toHaveBeenCalled();
  });

  it('rejects a reconnect response that regresses an active lifecycle state', async () => {
    const adapter = new MockDeviceAdapter();
    const reconnect = jest.spyOn(adapter, 'reconnect').mockReturnValue('discovering');
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Regressive reconnect device');
    await startDevice(harness, device.id);
    harness.repository.update(device.id, (record) => {
      record.state = 'waiting';
    });
    const before = harness.repository.get(device.id)!;

    await expect(harness.service.executeCommand(
      device.id,
      'reconnect',
      command(harness, device.id, 'device.reconnect'),
    )).rejects.toMatchObject({ code: 'adapter.unavailable', status: 503 });

    expect(reconnect).toHaveBeenCalledWith(device.id, expect.any(String));
    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      sequence: before.sequence + 1,
    }));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({ command: 'device.reconnect' }),
    }));
  });

  it('polls adapter health without advancing sequence for an unchanged state', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'health').mockReturnValue({ state: 'offline', heartbeatAgeMs: 125 });
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Stable heartbeat device');
    const eventSequence = harness.events.getCurrentSequence();

    await harness.service.checkHealthNow();

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'offline',
      sequence: device.sequence,
    }));
    expect(harness.events.replaySince(eventSequence)).toEqual([]);
    expect(harness.audits.list().filter((entry) => entry.type === 'device.health.changed')).toEqual([]);
  });

  it('publishes and audits a real adapter health state transition', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'health').mockReturnValue({ state: 'waiting', heartbeatAgeMs: 125 });
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Changing heartbeat device');
    const eventSequence = harness.events.getCurrentSequence();

    await harness.service.checkHealthNow();

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'waiting',
      sequence: device.sequence + 1,
    }));
    expect(harness.events.replaySince(eventSequence)).toEqual([
      expect.objectContaining({
        type: 'device.health.changed',
        data: expect.objectContaining({
          device_id: device.id,
          state: 'waiting',
          heartbeat_age_ms: 125,
          device_sequence: device.sequence + 1,
        }),
      }),
    ]);
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'device.health.changed',
      operatorId: 'local-system',
      deviceId: device.id,
      result: 'accepted',
    }));
  });

  it('records a health adapter failure only when entering the error state', async () => {
    const adapter = new MockDeviceAdapter();
    jest.spyOn(adapter, 'health').mockImplementation(() => {
      throw new Error('synthetic health failure');
    });
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Failing heartbeat device');
    const eventSequence = harness.events.getCurrentSequence();

    await harness.service.checkHealthNow();
    await harness.service.checkHealthNow();

    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      sequence: device.sequence + 1,
    }));
    expect(harness.events.replaySince(eventSequence)).toHaveLength(1);
    expect(harness.audits.list().filter(
      (entry) => entry.type === 'adapter.failure' && entry.metadata.command === 'device.health',
    )).toHaveLength(1);
  });

  it('rejects a regressive health state and stops an active preview when possible', async () => {
    const adapter = new MockDeviceAdapter();
    const health = jest.spyOn(adapter, 'health');
    const stopPreview = jest.spyOn(adapter, 'stopReadonlyPreview');
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Regressive heartbeat device');
    await startActivePreview(harness, device.id);
    const before = harness.repository.get(device.id)!;
    health.mockReturnValue({ state: 'offline', heartbeatAgeMs: 0 });

    await harness.service.checkHealthNow();

    expect(stopPreview).toHaveBeenCalledWith(device.id, expect.any(String));
    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'stopped',
      sequence: before.sequence + 1,
    }));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({ reason: 'stale-health-state', command: 'device.health' }),
    }));
  });

  it('stops an active preview when health explicitly reports an adapter error', async () => {
    const adapter = new MockDeviceAdapter();
    const health = jest.spyOn(adapter, 'health');
    const stopPreview = jest.spyOn(adapter, 'stopReadonlyPreview');
    const harness = createHarness(adapter);
    const device = await registerDevice(harness, 'Reported health error device');
    await startActivePreview(harness, device.id);
    const before = harness.repository.get(device.id)!;
    health.mockReturnValue({ state: 'error', heartbeatAgeMs: 0 });

    await harness.service.checkHealthNow();

    expect(stopPreview).toHaveBeenCalledWith(device.id, expect.any(String));
    expect(harness.repository.get(device.id)).toEqual(expect.objectContaining({
      state: 'error',
      stream: 'stopped',
      sequence: before.sequence + 1,
    }));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: device.id,
      metadata: expect.objectContaining({ reason: 'adapter-reported-error', command: 'device.health' }),
    }));
  });

  it('continues polling other devices when one health check fails', async () => {
    const adapter = new MockDeviceAdapter();
    const harness = createHarness(adapter);
    const first = await registerDevice(harness, 'First health failure');
    const second = await registerDevice(harness, 'Second health success');
    jest.spyOn(adapter, 'health').mockImplementation((deviceId) => {
      if (deviceId === first.id) throw new Error('synthetic health failure');
      return { state: 'waiting', heartbeatAgeMs: 0 };
    });

    await harness.service.checkHealthNow();

    expect(harness.repository.get(first.id)?.state).toBe('error');
    expect(harness.repository.get(second.id)).toEqual(expect.objectContaining({ state: 'waiting' }));
  });

  it('rejects a group that becomes empty after trimming', async () => {
    const harness = createHarness();

    await expect(harness.service.register(
      { alias: 'Whitespace group', provider: 'mock-adapter', transport: 'memory', group: '   ' },
      OPERATOR_ID,
    )).rejects.toMatchObject({ code: 'schema.invalid', status: 422 });
    expect(harness.repository.size()).toBe(0);
  });

  it('writes an accepted audit record for every device stopped by stop-all', async () => {
    const harness = createHarness();
    const first = await registerDevice(harness, 'Emergency device 1');
    const second = await registerDevice(harness, 'Emergency device 2');
    await startDevice(harness, first.id);
    await startDevice(harness, second.id);

    await expect(harness.service.stopAll(OPERATOR_ID)).resolves.toEqual({ stopped: 2, failed: 0 });

    const perDeviceAudits = harness.audits.list().filter(
      (entry) => entry.type === 'safety.stop_device_stopped',
    );
    expect(perDeviceAudits).toHaveLength(2);
    expect(perDeviceAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: first.id, result: 'accepted' }),
      expect.objectContaining({ deviceId: second.id, result: 'accepted' }),
    ]));
    expect(perDeviceAudits.every((entry) => entry.metadata.command === 'safety.stop-all')).toBe(true);
    expect(harness.repository.list()).toEqual([
      expect.objectContaining({ id: first.id, state: 'offline', stream: 'stopped' }),
      expect.objectContaining({ id: second.id, state: 'offline', stream: 'stopped' }),
    ]);
  });

  it('audits each stop-all outcome and continues after one adapter failure', async () => {
    const adapter = new MockDeviceAdapter();
    const originalStop = adapter.stop.bind(adapter);
    jest.spyOn(adapter, 'stop')
      .mockImplementationOnce(() => {
        throw new Error('synthetic stop failure');
      })
      .mockImplementation(originalStop);
    const previewStop = jest.spyOn(adapter, 'stopReadonlyPreview');
    const harness = createHarness(adapter);
    const first = await registerDevice(harness, 'Failing emergency device');
    const second = await registerDevice(harness, 'Healthy emergency device');
    await startDevice(harness, first.id);
    await startDevice(harness, second.id);
    await harness.service.focus(first.id, command(harness, first.id, 'device.focus'));
    await harness.service.startPreview(first.id, command(harness, first.id, 'preview.start'));

    await expect(harness.service.stopAll(OPERATOR_ID)).rejects.toMatchObject({
      code: 'adapter.unavailable',
      details: { stopped: 1, failed: 1 },
    });

    const perDeviceAudits = harness.audits.list().filter(
      (entry) => ['safety.stop_device_stopped', 'safety.stop_device_failed'].includes(entry.type),
    );
    expect(perDeviceAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'safety.stop_device_failed',
        deviceId: first.id,
        result: 'rejected',
      }),
      expect.objectContaining({
        type: 'safety.stop_device_stopped',
        deviceId: second.id,
        result: 'accepted',
      }),
    ]));
    expect(harness.repository.get(first.id)).toEqual(
      expect.objectContaining({ state: 'error', stream: 'stopped' }),
    );
    expect(harness.repository.get(second.id)).toEqual(
      expect.objectContaining({ state: 'offline', stream: 'stopped' }),
    );
    expect(previewStop).toHaveBeenCalledWith(first.id, expect.any(String));
    expect(previewStop).toHaveBeenCalledWith(second.id, expect.any(String));
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'adapter.failure',
      deviceId: first.id,
      metadata: expect.objectContaining({
        command: 'safety.stop-all',
        reason: 'lifecycle-stop',
        stream: 'stopped',
      }),
    }));
  });
});

function createHarness(adapter: DeviceAdapter = new MockDeviceAdapter()) {
  const config = loadRuntimeConfig();
  const clock = new ClockService(config);
  const repository = new DeviceRepository();
  const audits = new AuditRepository();
  const audit = new AuditService(audits, config, clock);
  const events = new EventBusService(config, clock);
  const confirmations = new ConfirmationService(audit, config, clock);
  const service = new DeviceService(
    repository,
    audit,
    events,
    new PolicyService(),
    confirmations,
    adapter,
    clock,
    new KeyedSerialExecutor(config),
    new GlobalOperationCoordinator(config),
    config,
  );
  return { service, repository, audits, events, confirmations, adapter };
}

async function registerDevice(harness: ReturnType<typeof createHarness>, alias: string) {
  return harness.service.register(
    { alias, provider: 'mock-adapter', transport: 'memory' },
    OPERATOR_ID,
  );
}

async function startDevice(harness: ReturnType<typeof createHarness>, deviceId: string) {
  return harness.service.executeCommand(
    deviceId,
    'start',
    command(harness, deviceId, 'device.start'),
  );
}

async function startActivePreview(
  harness: ReturnType<typeof createHarness>,
  deviceId: string,
): Promise<void> {
  await startDevice(harness, deviceId);
  await harness.service.focus(deviceId, command(harness, deviceId, 'device.focus'));
  await harness.service.startPreview(deviceId, command(harness, deviceId, 'preview.start'));
}

function command(
  harness: ReturnType<typeof createHarness>,
  deviceId: string,
  intent: string,
): DeviceCommandDto {
  const expectedSequence = harness.repository.get(deviceId)?.sequence;
  if (expectedSequence === undefined) throw new Error('test device was not found');
  const confirmation = harness.confirmations.issue({
    operatorId: OPERATOR_ID,
    deviceId,
    intent,
    expectedSequence,
    currentDeviceSequence: expectedSequence,
    confirmed: true,
  });
  return {
    operator_id: OPERATOR_ID,
    confirmation_id: confirmation.confirmation_id,
    intent,
    expected_sequence: expectedSequence,
  };
}
