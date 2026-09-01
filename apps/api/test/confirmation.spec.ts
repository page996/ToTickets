import { AuditService } from '../src/common/audit/audit.service';
import { ConfirmationService } from '../src/common/confirmation/confirmation.service';
import { ClockService } from '../src/common/time/clock.service';
import { RuntimeConfig, loadRuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';

describe('ConfirmationService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects capacity pressure without discarding an unexpired ticket', () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = { ...base, policy: { ...base.policy, confirmationMaxEntries: 1 } };
    const audit = { append: jest.fn() } as unknown as AuditService;
    const service = new ConfirmationService(audit, config, new ClockService(config));
    const issued = service.issue({
      operatorId: 'test-operator',
      deviceId: 'mock-device',
      intent: 'device.start',
      expectedSequence: 1,
      currentDeviceSequence: 1,
      confirmed: true,
    });

    let error: unknown;
    try {
      service.issue({
        operatorId: 'test-operator',
        deviceId: 'other-device',
        intent: 'device.start',
        expectedSequence: 1,
        currentDeviceSequence: 1,
        confirmed: true,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'device.busy', status: 503 });
    expect(service.getStats()).toEqual({ tickets: 1, capacity: 1 });
    service.consume({
      confirmationId: issued.confirmation_id,
      operatorId: 'test-operator',
      deviceId: 'mock-device',
      intent: 'device.start',
      expectedSequence: 1,
      currentDeviceSequence: 1,
    });
    expect(service.getStats()).toEqual({ tickets: 0, capacity: 1 });
  });

  it('rejects a device confirmation when the requested sequence is already stale', () => {
    const config = loadRuntimeConfig();
    const audit = { append: jest.fn() } as unknown as AuditService;
    const service = new ConfirmationService(audit, config, new ClockService(config));

    expect(() => service.issue({
      operatorId: 'test-operator',
      deviceId: 'mock-device',
      intent: 'device.start',
      expectedSequence: 3,
      currentDeviceSequence: 4,
      confirmed: true,
    })).toThrow(expect.objectContaining({ code: 'command.stale', status: 409 }));
    expect(service.getStats().tickets).toBe(0);
  });

  it.each([
    { expectedSequence: 3, currentDeviceSequence: 4 },
    { expectedSequence: 4, currentDeviceSequence: 4 },
  ])('invalidates a ticket when reserve observes a sequence mismatch', (command) => {
    const config = loadRuntimeConfig();
    const audit = { append: jest.fn() } as unknown as AuditService;
    const service = new ConfirmationService(audit, config, new ClockService(config));
    const issued = service.issue({
      operatorId: 'test-operator',
      deviceId: 'mock-device',
      intent: 'device.start',
      expectedSequence: 3,
      currentDeviceSequence: 3,
      confirmed: true,
    });

    expect(() => service.reserve({
      confirmationId: issued.confirmation_id,
      operatorId: 'test-operator',
      deviceId: 'mock-device',
      intent: 'device.start',
      ...command,
    })).toThrow(expect.objectContaining({ code: 'command.stale', status: 409 }));
    expect(service.getStats().tickets).toBe(0);
  });

  it('keeps safety.stop-all confirmations sequence-free', () => {
    const config = loadRuntimeConfig();
    const audit = { append: jest.fn() } as unknown as AuditService;
    const service = new ConfirmationService(audit, config, new ClockService(config));

    expect(() => service.issue({
      operatorId: 'test-operator',
      intent: 'safety.stop-all',
      expectedSequence: 1,
      confirmed: true,
    })).toThrow(expect.objectContaining({ code: 'schema.invalid', status: 422 }));
  });
});
