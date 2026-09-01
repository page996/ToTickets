import { IdempotencyReplayError } from '../src/common/errors/api-error';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';
import { ClockService } from '../src/common/time/clock.service';
import { RuntimeConfig } from '../src/config/runtime-config';

describe('IdempotencyService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns an immutable copy of the original result for a replay', async () => {
    const config = loadRuntimeConfig();
    const service = new IdempotencyService(config, new ClockService(config));
    const original = await service.execute(
      'idempotency-test-001',
      'devices.commands.start',
      { device_id: 'synthetic-device' },
      () => ({ state: 'ready' }),
    );
    original.state = 'offline';
    const replay = await service.execute(
      'idempotency-test-001',
      'devices.commands.start',
      { device_id: 'synthetic-device' },
      () => ({ state: 'error' }),
    );
    expect(replay).toEqual({ state: 'ready' });
  });

  it('rejects reuse across operation scopes even when the payload matches', async () => {
    const config = loadRuntimeConfig();
    const service = new IdempotencyService(config, new ClockService(config));
    await service.execute(
      'idempotency-test-002',
      'devices.commands.start',
      { device_id: 'synthetic-device' },
      () => ({ state: 'ready' }),
    );
    await expect(
      service.execute(
        'idempotency-test-002',
        'devices.commands.stop',
        { device_id: 'synthetic-device' },
        () => ({ state: 'offline' }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyReplayError);
  });

  it('binds the idempotency fingerprint to the authenticated operator subject', async () => {
    const config = loadRuntimeConfig();
    const service = new IdempotencyService(config, new ClockService(config));
    await service.execute(
      'idempotency-subject-001',
      'devices.register',
      { alias: 'Synthetic device' },
      () => ({ id: 'first-result' }),
      'operator-a',
    );

    await expect(service.execute(
      'idempotency-subject-001',
      'devices.register',
      { alias: 'Synthetic device' },
      () => ({ id: 'second-result' }),
      'operator-b',
    )).rejects.toBeInstanceOf(IdempotencyReplayError);
  });

  it('coalesces concurrent requests with the same key and fingerprint', async () => {
    const config = loadRuntimeConfig();
    const service = new IdempotencyService(config, new ClockService(config));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;
    const operation = async () => {
      executions += 1;
      await gate;
      return { state: 'ready' };
    };

    const first = service.execute(
      'idempotency-test-003',
      'devices.commands.start',
      { device_id: 'synthetic-device' },
      operation,
    );
    const second = service.execute(
      'idempotency-test-003',
      'devices.commands.start',
      { device_id: 'synthetic-device' },
      operation,
    );
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: 'ready' },
      { state: 'ready' },
    ]);
    expect(executions).toBe(1);
  });

  it('keeps in-flight entries when the configured cache capacity is reached', async () => {
    const base = loadRuntimeConfig();
    const config: RuntimeConfig = { ...base, policy: { ...base.policy, idempotencyMaxEntries: 1 } };
    const service = new IdempotencyService(config, new ClockService(config));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = service.execute('idempotency-test-004', 'devices.commands.start', {}, async () => {
      await gate;
      return { state: 'ready' };
    });

    await expect(service.execute('idempotency-test-005', 'devices.commands.start', {}, () => ({ state: 'ready' })))
      .rejects.toMatchObject({ code: 'device.busy', status: 503 });
    expect(service.getStats()).toEqual({ entries: 1, inFlight: 1, capacity: 1 });
    release();
    await first;
    await service.execute('idempotency-test-005', 'devices.commands.start', {}, () => ({ state: 'ready' }));
    expect(service.getStats()).toEqual({ entries: 1, inFlight: 0, capacity: 1 });
  });
});
