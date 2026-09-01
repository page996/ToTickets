import { KeyedSerialExecutor } from '../src/common/concurrency/keyed-serial-executor.service';
import { GlobalOperationCoordinator } from '../src/common/concurrency/global-operation-coordinator.service';
import { DeviceRepository, DeviceRecord } from '../src/common/storage/device.repository';
import { ScheduleRecord, ScheduleRepository } from '../src/common/storage/schedule.repository';
import { AuditRecord, AuditRepository } from '../src/common/storage/audit.repository';
import { AuditService } from '../src/common/audit/audit.service';
import { loadRuntimeConfig, RuntimeConfig } from '../src/config/runtime-config';
import { ClockService } from '../src/common/time/clock.service';
import { installIsolatedTestEnvironment } from './test-environment';

describe('mock control-plane concurrency primitives', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('serializes a key while allowing independent keys to run concurrently', async () => {
    const executor = new KeyedSerialExecutor(loadRuntimeConfig());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    const first = executor.run('device:a', async () => { started.push('a1'); await gate; });
    const second = executor.run('device:a', () => { started.push('a2'); });
    const other = executor.run('device:b', () => { started.push('b1'); });

    await other;
    expect(started).toEqual(['a1', 'b1']);
    release();
    await Promise.all([first, second]);
    expect(started).toEqual(['a1', 'b1', 'a2']);
    expect(executor.getStats()).toEqual(expect.objectContaining({ active: 0, queued: 0, rejected: 0, activeKeys: 0 }));
  });

  it('waits for in-flight device writes before a global operation and holds later writes', async () => {
    const coordinator = new GlobalOperationCoordinator(loadRuntimeConfig());
    let releaseShared!: () => void;
    const sharedGate = new Promise<void>((resolve) => { releaseShared = resolve; });
    const events: string[] = [];
    const shared = coordinator.runShared(async () => { events.push('shared-start'); await sharedGate; events.push('shared-end'); });
    const global = coordinator.runExclusive(() => { events.push('global'); });
    const laterShared = coordinator.runShared(() => { events.push('later-shared'); });

    await Promise.resolve();
    expect(events).toEqual(['shared-start']);
    releaseShared();
    await Promise.all([shared, global, laterShared]);
    expect(events).toEqual(['shared-start', 'shared-end', 'global', 'later-shared']);
    expect(coordinator.getStats()).toEqual(expect.objectContaining({ active: 0, queued: 0, rejected: 0, activeSharedOperations: 0, activeExclusiveOperations: 0 }));
  });

  it('rejects a keyed wait when the queue is full and releases after failures', async () => {
    const executor = new KeyedSerialExecutor(configWithQueueCapacity(1));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = executor.run('device:a', async () => { await gate; throw new Error('synthetic failure'); });
    const second = executor.run('device:a', () => 'after-failure');

    await expect(executor.run('device:a', () => 'rejected')).rejects.toMatchObject({
      code: 'device.busy', status: 503, retryable: true,
    });
    expect(executor.getStats()).toEqual(expect.objectContaining({ active: 1, queued: 1, capacity: 1, rejected: 1 }));
    release();
    await expect(first).rejects.toThrow('synthetic failure');
    await expect(second).resolves.toBe('after-failure');
    expect(executor.getStats()).toEqual(expect.objectContaining({ active: 0, queued: 0, rejected: 1, activeKeys: 0 }));
  });

  it('preserves FIFO fairness across shared and exclusive work with bounded rejection', async () => {
    const coordinator = new GlobalOperationCoordinator(configWithQueueCapacity(2));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const first = coordinator.runShared(async () => { events.push('shared-1-start'); await gate; events.push('shared-1-end'); });
    const exclusive = coordinator.runExclusive(() => { events.push('exclusive'); throw new Error('synthetic failure'); });
    const laterShared = coordinator.runShared(() => { events.push('shared-2'); });

    await expect(coordinator.runShared(() => 'rejected')).rejects.toMatchObject({
      code: 'device.busy', status: 503, retryable: true,
    });
    expect(coordinator.getStats()).toEqual(expect.objectContaining({ active: 1, queued: 2, capacity: 2, rejected: 1 }));
    release();
    await first;
    await expect(exclusive).rejects.toThrow('synthetic failure');
    await laterShared;
    expect(events).toEqual(['shared-1-start', 'shared-1-end', 'exclusive', 'shared-2']);
    expect(coordinator.getStats()).toEqual(expect.objectContaining({ active: 0, queued: 0, rejected: 1 }));
  });

  it('does not expose mutable device records from reads', () => {
    const repository = new DeviceRepository();
    const record: DeviceRecord = {
      id: 'mock-device', alias: 'Mock', provider: 'mock-adapter', transport: 'memory', state: 'offline', stream: 'stopped', focused: false,
      capabilities: { lifecycle: true, health_read: true, screen_preview: true, user_input: false, automation: false },
      lastSeenAt: '2026-01-01T00:00:00.000Z', sequence: 1,
    };
    expect(repository.create(record, 1)).toBeDefined();
    const leaked = repository.get(record.id)!;
    leaked.alias = 'changed-outside-repository';
    expect(repository.get(record.id)!.alias).toBe('Mock');
    repository.update(record.id, (device) => { device.alias = 'controlled-change'; });
    expect(repository.get(record.id)!.alias).toBe('controlled-change');
  });

  it('increments every changed device when focus moves', () => {
    const repository = new DeviceRepository();
    const record = (id: string): DeviceRecord => ({
      id, alias: id, provider: 'mock-adapter', transport: 'memory', state: 'ready', stream: 'stopped', focused: false,
      capabilities: { lifecycle: true, health_read: true, screen_preview: true, user_input: false, automation: false },
      lastSeenAt: '2026-01-01T00:00:00.000Z', sequence: 1,
    });
    repository.create(record('device-a'), 2);
    repository.create(record('device-b'), 2);

    expect(repository.setFocused('device-a')).toEqual([
      expect.objectContaining({ id: 'device-a', focused: true, sequence: 2 }),
    ]);
    expect(repository.setFocused('device-b')).toEqual([
      expect.objectContaining({ id: 'device-a', focused: false, sequence: 3 }),
      expect.objectContaining({ id: 'device-b', focused: true, sequence: 2 }),
    ]);
  });

  it('does not expose mutable schedule records from reads', () => {
    const repository = new ScheduleRepository();
    const record: ScheduleRecord = {
      id: 'schedule-a', label: 'Synthetic', startsAt: '2030-01-01T00:00:00.000Z', timezone: 'UTC',
      reminders: [{ offsetSeconds: -60, channel: 'desktop' }], state: 'scheduled',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    repository.create(record, 1);
    expect(repository.create({ ...record, id: 'schedule-b' }, 1)).toBeUndefined();
    const leaked = repository.get(record.id)!;
    leaked.label = 'outside-change';
    leaked.reminders[0].offsetSeconds = -1;
    expect(repository.get(record.id)).toEqual(expect.objectContaining({
      label: 'Synthetic',
      reminders: [{ offsetSeconds: -60, channel: 'desktop' }],
    }));
  });

  it('bounds audit retention and returns isolated snapshots', () => {
    const repository = new AuditRepository();
    const record = (index: number): AuditRecord => ({
      id: `audit-${index}`,
      type: 'synthetic.event',
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      operatorId: 'test-operator',
      correlationId: `correlation-${index}`,
      policyVersion: 'test-policy.v1',
      result: 'accepted',
      metadata: { sequence: index },
    });
    repository.append(record(1), 2);
    repository.append(record(2), 2);
    repository.append(record(3), 2);

    const leaked = repository.list();
    leaked[0].metadata.sequence = 99;
    expect(repository.list().map((entry) => entry.id)).toEqual(['audit-2', 'audit-3']);
    expect(repository.list()[0].metadata.sequence).toBe(2);
    expect(repository.getStats()).toEqual({ retained: 2, capacityEvictions: 1 });
  });

  it('drops non-finite audit metadata numbers instead of serializing them as null', () => {
    const config = loadRuntimeConfig();
    const clock = new ClockService(config);
    const repository = new AuditRepository();
    const audit = new AuditService(repository, config, clock);

    const record = audit.append({
      type: 'synthetic.numeric-metadata',
      result: 'accepted',
      metadata: { sequence: Number.NaN, count: Number.POSITIVE_INFINITY, source: 'test' },
    });

    expect(record.metadata).toEqual({ source: 'test' });
    expect(JSON.stringify(record.metadata)).not.toContain('null');
  });
});

function configWithQueueCapacity(operationQueueMaxQueued: number): RuntimeConfig {
  const base = loadRuntimeConfig();
  return { ...base, limits: { ...base.limits, operationQueueMaxQueued } };
}
