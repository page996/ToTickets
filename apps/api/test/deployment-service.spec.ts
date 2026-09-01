import { AuditService } from '../src/common/audit/audit.service';
import { KeyedSerialExecutor } from '../src/common/concurrency/keyed-serial-executor.service';
import { EventBusService } from '../src/common/events/event-bus.service';
import { ApiError, IdempotencyReplayError, PolicyDeniedError } from '../src/common/errors/api-error';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { AuditRepository } from '../src/common/storage/audit.repository';
import { ClockService } from '../src/common/time/clock.service';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { DeploymentRepository } from '../src/deployments/deployment.repository';
import { DeploymentService } from '../src/deployments/deployment.service';
import { DeploymentCapacitySnapshot, DeploymentPlanInput } from '../src/deployments/deployment.types';
import { installIsolatedTestEnvironment } from './test-environment';

const OPERATOR_ID = 'deployment-service-test';
const CAPACITY: DeploymentCapacitySnapshot = {
  requestedInstances: 2,
  safeInstances: 4,
  effectiveInstances: 4,
  startupConcurrency: 2,
  confidence: 'estimated',
};

describe('DeploymentService mock-only state domain', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates an explicit mock-only plan with a non-sensitive capacity snapshot', async () => {
    const harness = createHarness();
    const record = await harness.service.plan(planInput(), {
      operatorId: OPERATOR_ID,
      idempotencyKey: 'deployment-plan-001',
      capacitySnapshot: CAPACITY,
    });

    expect(record).toEqual(expect.objectContaining({
      providerId: 'mock-adapter',
      executionMode: 'mock_only',
      planningOnly: true,
      sideEffects: 'none',
      desiredState: 'ready',
      observedState: 'planned',
      generation: 1,
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      capacitySnapshot: CAPACITY,
    }));
    expect(record.createdAt).toMatch(/Z$/);
    expect(record.updatedAt).toMatch(/Z$/);
    expect(harness.repository.get(record.id)).toEqual(record);
    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'deployment.plan.created',
      result: 'accepted',
      correlationId: record.id,
      metadata: expect.objectContaining({
        source: 'deployment-domain',
        command: 'deployment.plan',
        state: 'planned',
        count: 2,
        operation_id: record.operationId,
        deployment_id: record.id,
      }),
    }));
    expect(harness.events.replaySince(0)).toContainEqual(expect.objectContaining({
      type: 'deployment.state.changed',
      subject: `deployment/${record.id}`,
      data: expect.objectContaining({
        deployment_id: record.id,
        provider_id: 'mock-adapter',
        execution_mode: 'mock_only',
        observed_state: 'planned',
        generation: 1,
        side_effects: 'none',
      }),
    }));
    expect(JSON.stringify(record)).not.toMatch(/[A-Za-z]:\\|\/tmp\/|ANDROID_|TOKEN|password/i);
  });

  it('requires a capacity snapshot and rejects instances above effective capacity', async () => {
    const harness = createHarness();
    await expect(harness.service.plan(planInput(), { operatorId: OPERATOR_ID })).rejects.toMatchObject({
      code: 'schema.invalid',
      status: 422,
    });
    await expect(harness.service.plan(planInput(5), {
      operatorId: OPERATOR_ID,
      capacitySnapshot: { ...CAPACITY, requestedInstances: 5, effectiveInstances: 4 },
    })).rejects.toMatchObject({
      code: 'device.busy',
      status: 409,
      retryable: true,
    });
    expect(harness.repository.size()).toBe(0);
  });

  it('rejects non-mock providers and live execution modes before creating a record', async () => {
    const harness = createHarness();
    await expect(harness.service.plan({
      ...planInput(),
      provider_id: 'android-emulator-avd',
    }, { capacitySnapshot: CAPACITY })).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(harness.service.plan({
      ...planInput(),
      execution_mode: 'live',
    }, { capacitySnapshot: CAPACITY })).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(harness.repository.size()).toBe(0);
  });

  it('audits and publishes a redacted event for rejected operations', async () => {
    const harness = createHarness();
    await expect(harness.service.plan({
      ...planInput(),
      provider_id: 'android-emulator-avd',
    }, { operatorId: OPERATOR_ID, capacitySnapshot: CAPACITY })).rejects.toBeInstanceOf(PolicyDeniedError);

    expect(harness.audits.list()).toContainEqual(expect.objectContaining({
      type: 'deployment.operation.rejected',
      result: 'rejected',
      metadata: expect.objectContaining({
        source: 'deployment-domain',
        command: 'deployment.plan',
        reason: 'policy.denied',
        error_code: 'policy.denied',
      }),
    }));
    const rejection = harness.events.replaySince(0).find(
      (event) => event.type === 'deployment.operation.rejected',
    );
    expect(rejection?.data).toEqual(expect.objectContaining({
      deployment_id: null,
      operation_id: expect.any(String),
      command: 'deployment.plan',
      reason: 'policy.denied',
      error_code: 'policy.denied',
      planning_only: true,
      side_effects: 'none',
    }));
    expect(JSON.stringify(rejection)).not.toMatch(/[A-Za-z]:\\|\/tmp\/|ANDROID_|TOKEN|password/i);
  });

  it('rejects unknown fields and invalid enum/capacity values at the domain boundary', async () => {
    const harness = createHarness();
    await expect(harness.service.plan({
      ...planInput(),
      unexpected: true,
    } as never, { capacitySnapshot: CAPACITY })).rejects.toMatchObject({ code: 'schema.invalid' });
    await expect(harness.service.plan({
      ...planInput(),
      desired_state: 'running',
    } as never, { capacitySnapshot: CAPACITY })).rejects.toMatchObject({ code: 'schema.invalid' });
    await expect(harness.service.plan(planInput(), {
      capacitySnapshot: {
        ...CAPACITY,
        confidence: 'guessed',
      } as never,
    })).rejects.toMatchObject({ code: 'schema.invalid' });
    await expect(harness.service.plan(planInput(), {
      capacitySnapshot: {
        ...CAPACITY,
        effectiveInstances: 5,
      },
    })).rejects.toMatchObject({ code: 'schema.invalid' });
  });

  it('validates once and walks the explicit observed state machine with generation checks', async () => {
    const harness = createHarness();
    const planned = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });

    const reserved = await harness.service.validate(planned.id, {
      operator_confirmed: true,
      expected_generation: planned.generation,
      operation_id: 'validate-operation-001',
    }, { operatorId: OPERATOR_ID });
    expect(reserved).toEqual(expect.objectContaining({
      observedState: 'capacity_reserved',
      generation: planned.generation + 1,
      operationId: 'validate-operation-001',
    }));

    const provisioning = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'provisioning',
      expected_generation: reserved.generation,
      operation_id: 'transition-operation-001',
    }, { operatorId: OPERATOR_ID });
    const starting = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'starting',
      expected_generation: provisioning.generation,
      operation_id: 'transition-operation-002',
    }, { operatorId: OPERATOR_ID });
    const ready = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'ready',
      expected_generation: starting.generation,
      operation_id: 'transition-operation-003',
    }, { operatorId: OPERATOR_ID });
    expect(ready.observedState).toBe('ready');
    expect(ready.generation).toBe(planned.generation + 4);

    const stopping = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'stopping',
      expected_generation: ready.generation,
      operation_id: 'transition-operation-004',
    });
    const stopped = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'stopped',
      expected_generation: stopping.generation,
      operation_id: 'transition-operation-005',
    });
    const released = await harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'released',
      expected_generation: stopped.generation,
      operation_id: 'transition-operation-006',
    });
    expect(released.observedState).toBe('released');
    expect(harness.events.replaySince(0).filter((event) => event.type === 'deployment.state.changed')).toHaveLength(8);
    expect(harness.audits.list().filter((entry) => entry.type !== 'deployment.operation.rejected')).toHaveLength(8);
  });

  it('rejects stale generations and invalid transitions without changing the snapshot', async () => {
    const harness = createHarness();
    const planned = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    const reserved = await harness.service.validate(planned.id, {
      operator_confirmed: true,
      expected_generation: planned.generation,
      operation_id: 'validate-operation-002',
    });
    await expect(harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'ready',
      expected_generation: planned.generation,
      operation_id: 'stale-operation-001',
    })).rejects.toMatchObject({ code: 'command.stale', status: 409 });
    await expect(harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'released',
      expected_generation: reserved.generation,
      operation_id: 'invalid-operation-001',
    })).rejects.toMatchObject({ code: 'schema.invalid', status: 422 });
    expect(harness.service.get(planned.id)).toEqual(reserved);
  });

  it('returns the original snapshot for operation replay and rejects operation id conflicts', async () => {
    const harness = createHarness();
    const planned = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    const operationId = 'validate-operation-003';
    const first = await harness.service.validate(planned.id, {
      operator_confirmed: true,
      expected_generation: planned.generation,
      operation_id: operationId,
    });
    const replay = await harness.service.validate(planned.id, {
      operator_confirmed: true,
      expected_generation: planned.generation,
      operation_id: operationId,
    });
    expect(replay).toEqual(first);
    expect(harness.events.replaySince(0).filter((event) => event.type === 'deployment.state.changed')).toHaveLength(2);

    await expect(harness.service.transition(planned.id, {
      operator_confirmed: true,
      observed_state: 'provisioning',
      expected_generation: first.generation,
      operation_id: operationId,
    })).rejects.toBeInstanceOf(IdempotencyReplayError);
  });

  it('binds operation replay to the operator subject', async () => {
    const harness = createHarness();
    const planned = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    const operation = {
      operator_confirmed: true as const,
      expected_generation: planned.generation,
      operation_id: 'operator-bound-operation',
    };
    await harness.service.validate(planned.id, operation, { operatorId: 'operator-a' });
    await expect(harness.service.validate(planned.id, operation, { operatorId: 'operator-b' }))
      .rejects.toMatchObject({ code: 'policy.denied', status: 403 });
  });

  it('coalesces the same idempotency key and rejects a changed payload', async () => {
    const harness = createHarness();
    const options = {
      operatorId: OPERATOR_ID,
      idempotencyKey: 'deployment-plan-002',
      capacitySnapshot: CAPACITY,
    };
    const first = await harness.service.plan(planInput(), options);
    const replay = await harness.service.plan(planInput(), options);
    expect(replay).toEqual(first);
    expect(harness.repository.size()).toBe(1);
    await expect(harness.service.plan(planInput(3), {
      ...options,
      idempotencyKey: options.idempotencyKey,
      capacitySnapshot: { ...CAPACITY, requestedInstances: 3 },
    })).rejects.toMatchObject({ code: 'idempotency.replay', status: 409 });
  });

  it('changes desired state separately and keeps observed state explicit', async () => {
    const harness = createHarness();
    const planned = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    const changed = await harness.service.setDesiredState(planned.id, {
      operator_confirmed: true,
      desired_state: 'stopped',
      expected_generation: planned.generation,
      operation_id: 'desired-operation-001',
    });
    expect(changed).toEqual(expect.objectContaining({
      desiredState: 'stopped',
      observedState: 'planned',
      generation: planned.generation + 1,
    }));
    await expect(harness.service.setDesiredState(planned.id, {
      operator_confirmed: true,
      desired_state: 'ready',
      expected_generation: planned.generation,
      operation_id: 'desired-operation-stale',
    })).rejects.toMatchObject({ code: 'command.stale', status: 409 });
  });

  it('does not expose mutable repository state or external process capabilities', async () => {
    const harness = createHarness();
    const record = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    record.observedState = 'ready';
    (record.capacitySnapshot as { safeInstances: number }).safeInstances = 999;
    expect(harness.service.get(record.id)).toEqual(expect.objectContaining({
      observedState: 'planned',
      capacitySnapshot: CAPACITY,
    }));
    expect(Object.keys(harness.service).join(',')).not.toMatch(/adapter|process|command_path|executable/i);
  });

  it('bounds the retained operation replay window', async () => {
    const harness = createHarness();
    const record = await harness.service.plan(planInput(), { capacitySnapshot: CAPACITY });
    for (const operationId of ['bounded-operation-a', 'bounded-operation-b', 'bounded-operation-c']) {
      harness.repository.saveOperation({
        operationId,
        deploymentId: record.id,
        operatorId: OPERATOR_ID,
        fingerprint: operationId,
        result: record,
      }, 2);
    }
    expect(harness.repository.getOperationStats()).toEqual({
      retained: 2,
      capacityEvictions: 2,
    });
    expect(harness.repository.getOperation('bounded-operation-a')).toBeUndefined();
    expect(harness.repository.getOperation('bounded-operation-c')).toBeDefined();
  });
});

function createHarness() {
  const config = loadRuntimeConfig();
  const clock = new ClockService(config);
  const audits = new AuditRepository();
  const audit = new AuditService(audits, config, clock);
  const events = new EventBusService(config, clock);
  const idempotency = new IdempotencyService(config, clock);
  const repository = new DeploymentRepository();
  const service = new DeploymentService(
    repository,
    audit,
    events,
    idempotency,
    clock,
    new KeyedSerialExecutor(config),
    config,
  );
  return { service, repository, audits, events };
}

function planInput(instances = CAPACITY.requestedInstances): DeploymentPlanInput {
  return {
    operator_confirmed: true,
    provider_id: 'mock-adapter',
    execution_mode: 'mock_only',
    desired_state: 'ready',
    instances,
  };
}
