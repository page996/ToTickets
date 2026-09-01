import { AuditService } from '../src/common/audit/audit.service';
import { KeyedSerialExecutor } from '../src/common/concurrency/keyed-serial-executor.service';
import { EventBusService } from '../src/common/events/event-bus.service';
import { AuditRecord, AuditRepository } from '../src/common/storage/audit.repository';
import {
  ScheduleRecord,
  ScheduleRepository,
} from '../src/common/storage/schedule.repository';
import { ClockService } from '../src/common/time/clock.service';
import { RuntimeConfig } from '../src/config/runtime-config';
import { ReminderService } from '../src/schedules/reminder.service';
import { ScheduleService } from '../src/schedules/schedule.service';

const NOW = Date.UTC(2030, 0, 1, 0, 0, 0);

const config: RuntimeConfig = {
  schemaVersion: 'runtime-config.v3',
  api: { bindHost: 'test-host', port: 12000, allowedOrigins: ['http://test-console'] },
  limits: {
    maxDevices: 8,
    maxSchedules: 64,
    heartbeatSeconds: 5,
    auditRetentionDays: 7,
    clockToleranceMs: 250,
    websocketMaxClients: 8,
    websocketMaxBufferedBytes: 65536,
    websocketMaxPayloadBytes: 65536,
    eventReplayBatchSize: 8,
    eventReplayMaxEvents: 64,
    auditMaxRecords: 1000,
    operationQueueMaxQueued: 32,
  },
  policy: {
    idempotencyTtlSeconds: 600,
    idempotencyMaxEntries: 100,
    confirmationTtlSeconds: 300,
    confirmationMaxEntries: 100,
    eventHistorySize: 100,
  },
  policyVersion: 'test-policy.v1',
};

describe('ScheduleService state transitions', () => {
  it('requires a fired reminder before acknowledgement and does not re-arm label edits', async () => {
    const repository = new ScheduleRepository();
    const reminder = { arm: jest.fn(), cancel: jest.fn() } as unknown as ReminderService;
    const service = new ScheduleService(
      repository,
      { append: jest.fn() } as never,
      { publish: jest.fn() } as never,
      fixedClock(),
      reminder,
      immediateExecutor(),
      config,
    );
    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;

    await expect(service.acknowledge(schedule.id, 'operator')).rejects.toMatchObject({
      code: 'schedule.not_notified',
    });
    expect((reminder.cancel as jest.Mock)).not.toHaveBeenCalled();

    repository.update(schedule.id, (record) => {
      record.state = 'notified';
    });
    const edited = await service.update(schedule.id, { label: 'Edited reminder' }, 'operator');
    expect(edited.label).toBe('Edited reminder');
    expect((reminder.arm as jest.Mock)).not.toHaveBeenCalled();

    await expect(
      service.update(
        schedule.id,
        { reminders: [{ offset_seconds: -30, channel: 'desktop' }] },
        'operator',
      ),
    ).rejects.toMatchObject({ code: 'schedule.started' });

    const acknowledged = await service.acknowledge(schedule.id, 'operator');
    expect(acknowledged.state).toBe('human_confirmed');
    expect(reminder.cancel).toHaveBeenCalledWith(schedule.id);
  });

  it.each(['completed', 'failed', 'expired', 'cancelled'] as const)(
    'rejects updates to the terminal %s state',
    async (state) => {
      const repository = new ScheduleRepository();
      const reminder = { arm: jest.fn(), cancel: jest.fn() } as unknown as ReminderService;
      const service = new ScheduleService(
        repository,
        { append: jest.fn() } as never,
        { publish: jest.fn() } as never,
        fixedClock(),
        reminder,
        immediateExecutor(),
        config,
      );
      const schedule = repository.create(
        scheduleRecord({ state, startsAt: new Date(NOW + 3_600_000).toISOString() }),
        config.limits.maxSchedules,
      )!;

      await expect(service.update(schedule.id, { label: 'mutated' }, 'operator')).rejects.toMatchObject({
        code: 'schedule.started',
        status: 409,
      });
      expect(repository.get(schedule.id)).toEqual(expect.objectContaining({
        state,
        label: schedule.label,
      }));
    },
  );

  it('rejects a started cancellation that carries other mutable fields', async () => {
    const repository = new ScheduleRepository();
    const reminder = { arm: jest.fn(), cancel: jest.fn() } as unknown as ReminderService;
    const service = new ScheduleService(
      repository,
      { append: jest.fn() } as never,
      { publish: jest.fn() } as never,
      fixedClock(),
      reminder,
      immediateExecutor(),
      config,
    );
    const schedule = repository.create(
      scheduleRecord({ startsAt: new Date(NOW - 1).toISOString() }),
      config.limits.maxSchedules,
    )!;

    await expect(service.update(schedule.id, {
      state: 'cancelled',
      label: 'tampered',
      reminders: [{ offset_seconds: -30, channel: 'desktop' }],
    }, 'operator')).rejects.toMatchObject({
      code: 'schema.invalid',
      status: 422,
    });
    expect(repository.get(schedule.id)).toEqual(expect.objectContaining({
      state: 'scheduled',
      label: schedule.label,
      reminders: schedule.reminders,
    }));
    expect(reminder.cancel).not.toHaveBeenCalled();
  });

  it('rejects reminder targets that are already in the past', async () => {
    const repository = new ScheduleRepository();
    const reminder = { arm: jest.fn(), cancel: jest.fn() } as unknown as ReminderService;
    const service = new ScheduleService(
      repository,
      { append: jest.fn() } as never,
      { publish: jest.fn() } as never,
      fixedClock(),
      reminder,
      immediateExecutor(),
      config,
    );
    const createInput = {
      label: 'Expired target',
      starts_at: new Date(NOW + 60_000).toISOString(),
      timezone: 'UTC',
      reminders: [{ offset_seconds: -604800, channel: 'desktop' as const }],
    };

    await expect(service.create(createInput, 'operator')).rejects.toMatchObject({
      code: 'schema.invalid',
      status: 422,
    });
    expect(repository.size()).toBe(0);

    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;
    await expect(service.update(schedule.id, {
      reminders: [{ offset_seconds: -604800, channel: 'desktop' }],
    }, 'operator')).rejects.toMatchObject({
      code: 'schema.invalid',
      status: 422,
    });
    expect(reminder.arm).not.toHaveBeenCalled();
  });
});

describe('ReminderService recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries a due reminder after clock confidence recovers', async () => {
    const repository = new ScheduleRepository();
    const audit = { append: jest.fn() };
    const events = { publish: jest.fn() };
    let confidence: 'local' | 'uncertain' = 'uncertain';
    const clock = {
      nowEpochMs: () => NOW,
      nowIso: () => new Date(NOW).toISOString(),
      snapshot: () => ({
        server_time: new Date(NOW).toISOString(),
        monotonic_supported: true as const,
        offset_ms: 1000,
        confidence,
      }),
    } as ClockService;
    const service = new ReminderService(
      repository,
      audit as never,
      events as unknown as EventBusService,
      clock,
      immediateExecutor(),
      config,
    );
    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;

    service.arm(schedule);
    await jest.advanceTimersByTimeAsync(0);
    expect(repository.get(schedule.id)?.state).toBe('scheduled');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clock.uncertain', result: 'rejected' }),
    );

    confidence = 'local';
    await jest.advanceTimersByTimeAsync(config.limits.heartbeatSeconds * 1000);
    expect(repository.get(schedule.id)?.state).toBe('notified');
    expect(events.publish).toHaveBeenCalledWith(
      'reminder.fired',
      expect.objectContaining({ schedule_id: schedule.id }),
      `schedule/${schedule.id}`,
    );
  });

  it('audits and retries a reminder rejected by the operation queue', async () => {
    const repository = new ScheduleRepository();
    const audit = { append: jest.fn() };
    const events = { publish: jest.fn() };
    let attempt = 0;
    const executor = {
      run: jest.fn((_key: string, operation: () => unknown) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('synthetic queue rejection'))
          : Promise.resolve().then(operation);
      }),
    } as unknown as KeyedSerialExecutor;
    const service = new ReminderService(
      repository,
      audit as never,
      events as unknown as EventBusService,
      fixedClock(),
      executor,
      config,
    );
    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;

    service.arm(schedule);
    await jest.advanceTimersByTimeAsync(0);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reminder.dispatch.failed', result: 'rejected' }),
    );
    expect(repository.get(schedule.id)?.state).toBe('scheduled');

    await jest.advanceTimersByTimeAsync(config.limits.heartbeatSeconds * 1000);
    expect(repository.get(schedule.id)?.state).toBe('notified');
    expect(executor.run).toHaveBeenCalledTimes(2);
  });

  it('clears per-reminder diagnostics when a schedule is re-armed', async () => {
    const repository = new ScheduleRepository();
    const audit = { append: jest.fn() };
    const events = { publish: jest.fn() };
    let confidence: 'local' | 'uncertain' = 'uncertain';
    const clock = {
      nowEpochMs: () => NOW,
      nowIso: () => new Date(NOW).toISOString(),
      snapshot: () => ({
        server_time: new Date(NOW).toISOString(),
        monotonic_supported: true as const,
        offset_ms: 1000,
        confidence,
      }),
    } as ClockService;
    const service = new ReminderService(
      repository,
      audit as never,
      events as unknown as EventBusService,
      clock,
      immediateExecutor(),
      config,
    );
    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;

    service.arm(schedule);
    await jest.advanceTimersByTimeAsync(0);
    expect(audit.append).toHaveBeenCalledTimes(1);

    // Re-arming the same schedule starts a fresh generation and must report
    // the next clock-uncertain attempt again for the same reminder index.
    service.arm(schedule);
    await jest.advanceTimersByTimeAsync(0);
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'clock.uncertain', scheduleId: schedule.id }),
    );
    service.cancel(schedule.id);
  });

  it('does not retain a generation for cancellation or an inactive schedule', () => {
    const repository = new ScheduleRepository();
    const service = new ReminderService(
      repository,
      { append: jest.fn() } as never,
      { publish: jest.fn() } as never,
      fixedClock(),
      immediateExecutor(),
      config,
    );
    const generations = (service as unknown as {
      generations: Map<string, symbol>;
    }).generations;
    const schedule = scheduleRecord({
      startsAt: new Date(NOW + 120_000).toISOString(),
      reminders: [{ offsetSeconds: 0, channel: 'desktop' }],
    });

    service.arm(schedule);
    expect(generations.has(schedule.id)).toBe(true);
    service.cancel(schedule.id);
    expect(generations.has(schedule.id)).toBe(false);

    service.arm({ ...schedule, state: 'cancelled' });
    expect(generations.has(schedule.id)).toBe(false);
  });

  it('retries only the failed fired side effect without duplicating the audit', async () => {
    const repository = new ScheduleRepository();
    const audit = { append: jest.fn() };
    let eventAttempts = 0;
    const events = {
      publish: jest.fn((type: string) => {
        if (type === 'reminder.fired' && eventAttempts++ === 0) {
          throw new Error('synthetic event-bus failure');
        }
      }),
    };
    const service = new ReminderService(
      repository,
      audit as never,
      events as unknown as EventBusService,
      fixedClock(),
      immediateExecutor(),
      config,
    );
    const schedule = repository.create(scheduleRecord(), config.limits.maxSchedules)!;

    service.arm(schedule);
    await jest.advanceTimersByTimeAsync(0);
    expect(repository.get(schedule.id)?.state).toBe('notified');
    const firstUpdatedAt = repository.get(schedule.id)?.updatedAt;
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reminder.fired', result: 'accepted' }),
    );

    await jest.advanceTimersByTimeAsync(config.limits.heartbeatSeconds * 1000);
    expect(repository.get(schedule.id)?.state).toBe('notified');
    expect(repository.get(schedule.id)?.updatedAt).toBe(firstUpdatedAt);
    expect(audit.append.mock.calls.filter(([entry]) => entry.type === 'reminder.fired')).toHaveLength(1);
    expect(events.publish.mock.calls.filter(([type]) => type === 'reminder.fired')).toHaveLength(2);
  });
});

describe('AuditService retention', () => {
  it('prunes idle records on reads and returns newest records first', () => {
    const repository = new AuditRepository();
    repository.append(auditRecord('old', NOW - 8 * 86400000), 100);
    repository.append(auditRecord('recent-1', NOW - 2 * 86400000), 100);
    repository.append(auditRecord('recent-2', NOW - 86400000), 100);
    repository.append(auditRecord('recent-3', NOW - 86400000), 100);
    const service = new AuditService(repository, config, fixedClock());

    const page = service.list({ page: 1, pageSize: 10 });
    expect(page.items.map((item) => item.id)).toEqual(['recent-3', 'recent-2', 'recent-1']);
    expect(page.total).toBe(3);
    expect(service.export().map((item) => item.id)).toEqual([
      'recent-1',
      'recent-2',
      'recent-3',
    ]);
    expect(repository.getStats().retained).toBe(3);
  });
});

function scheduleRecord(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    label: 'Synthetic reminder',
    startsAt: new Date(NOW + 60_000).toISOString(),
    timezone: 'UTC',
    reminders: [{ offsetSeconds: -60, channel: 'desktop' }],
    state: 'scheduled',
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function fixedClock(): ClockService {
  return {
    nowEpochMs: () => NOW,
    nowIso: () => new Date(NOW).toISOString(),
    snapshot: () => ({
      server_time: new Date(NOW).toISOString(),
      monotonic_supported: true as const,
      offset_ms: 0,
      confidence: 'local' as const,
    }),
  } as ClockService;
}

function immediateExecutor(): KeyedSerialExecutor {
  return {
    run: <T>(_key: string, operation: () => T | Promise<T>) =>
      Promise.resolve().then(operation),
  } as KeyedSerialExecutor;
}

function auditRecord(id: string, occurredAt: number): AuditRecord {
  return {
    id,
    type: 'synthetic.audit',
    occurredAt: new Date(occurredAt).toISOString(),
    operatorId: 'operator',
    correlationId: `correlation-${id}`,
    policyVersion: config.policyVersion,
    result: 'accepted',
    metadata: {},
  };
}
