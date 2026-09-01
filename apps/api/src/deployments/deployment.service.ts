import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service';
import { KeyedSerialExecutor } from '../common/concurrency/keyed-serial-executor.service';
import { EventBusService } from '../common/events/event-bus.service';
import {
  ApiError,
  CommandStaleError,
  IdempotencyReplayError,
  PolicyDeniedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { ClockService } from '../common/time/clock.service';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { providerManifest } from '../hosts/provider-manifests';
import { DeploymentRepository } from './deployment.repository';
import {
  DEPLOYMENT_CAPACITY_CONFIDENCE,
  DEPLOYMENT_DESIRED_STATES,
  DEPLOYMENT_EXECUTION_MODE,
  DEPLOYMENT_OBSERVED_STATES,
  DEPLOYMENT_PROVIDER_ID,
  DEPLOYMENT_STATE_TRANSITIONS,
  DeploymentCapacitySnapshot,
  DeploymentDesiredState,
  DeploymentDesiredStateInput,
  DeploymentOperationOptions,
  DeploymentPlanInput,
  DeploymentPlanOptions,
  DeploymentRecord,
  DeploymentTransitionInput,
  DeploymentValidateInput,
  DeploymentObservedState,
} from './deployment.types';

const PLAN_KEYS = ['operator_confirmed', 'provider_id', 'execution_mode', 'desired_state', 'instances'] as const;
const VALIDATE_KEYS = ['operator_confirmed', 'expected_generation', 'operation_id'] as const;
const TRANSITION_KEYS = ['operator_confirmed', 'observed_state', 'expected_generation', 'operation_id'] as const;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Mock-only deployment state coordinator.
 *
 * This service deliberately stops at a versioned state model.  It never
 * resolves an executable, launches a process, talks to ADB, or invokes a
 * device adapter.  A provider host can be added behind this contract after
 * authentication, authorization, and command-allowlist gates are complete.
 */
@Injectable()
export class DeploymentService {
  constructor(
    private readonly repository: DeploymentRepository,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly idempotency: IdempotencyService,
    private readonly clock: ClockService,
    private readonly executor: KeyedSerialExecutor,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  list(): DeploymentRecord[] {
    return this.repository
      .list()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id: string): DeploymentRecord {
    const record = this.repository.get(id);
    if (!record) throw deploymentNotFound();
    return record;
  }

  /**
   * Creates a simulation record from a trusted host-planner snapshot.  The
   * snapshot is supplied separately from the public DTO so the controller can
   * obtain it from HostService rather than trusting client-provided hardware
   * claims.
   */
  async plan(
    input: DeploymentPlanInput,
    options: DeploymentPlanOptions = {},
  ): Promise<DeploymentRecord> {
    const operatorId = options.operatorId ?? 'local-user';
    let operationId: string = randomUUID();
    try {
      const normalized = parseDeploymentPlan(input);
      const snapshot = validateCapacitySnapshot(options.capacitySnapshot, normalized.instances);
      const payload = {
        ...normalized,
        capacity_snapshot: snapshot,
      };
      return await this.runIdempotent(
        options.idempotencyKey,
        'deployments.plan',
        payload,
        operatorId,
        () => this.executor.run('deployment:registry', () => {
          const now = this.clock.nowIso();
          operationId = randomUUID();
          const record: DeploymentRecord = {
            id: randomUUID(),
            providerId: DEPLOYMENT_PROVIDER_ID,
            executionMode: DEPLOYMENT_EXECUTION_MODE,
            planningOnly: true,
            sideEffects: 'none',
            desiredState: normalized.desired_state as DeploymentDesiredState,
            observedState: 'planned',
            generation: 1,
            operationId,
            capacitySnapshot: snapshot,
            createdAt: now,
            updatedAt: now,
          };
          const created = this.repository.create(record, options.maximumRecords);
          if (!created) {
            throw new ApiError('device.busy', 'deployment capacity has been reached', 409, true);
          }
          this.repository.saveOperation({
            operationId,
            deploymentId: created.id,
            operatorId,
            fingerprint: `plan:${created.id}`,
            result: created,
          }, this.config.policy.idempotencyMaxEntries);
          this.recordAccepted(created, 'deployment.plan.created', 'deployment.plan', operatorId);
          this.publishState(created);
          return created;
        }),
      );
    } catch (error) {
      this.recordRejected(undefined, operationId, 'deployment.plan', error, operatorId);
      throw error;
    }
  }

  /**
   * Runs the side-effect-free mock validation phase.  A successful validation
   * reserves the previously measured capacity in the domain model and advances
   * `planned` directly to `capacity_reserved`; no host resource is actually
   * reserved and no external process is started.
   */
  async validate(
    id: string,
    input: DeploymentValidateInput,
    options: DeploymentOperationOptions = {},
  ): Promise<DeploymentRecord> {
    const operatorId = options.operatorId ?? 'local-user';
    let operationId: string = randomUUID();
    try {
      assertExactKeys(input, VALIDATE_KEYS, 'deployment validation');
      assertOperatorConfirmed(input.operator_confirmed);
      const expectedGeneration = validateGeneration(input.expected_generation);
      operationId = resolveOperationId(input.operation_id);
      const fingerprint = `validate:${id}:${expectedGeneration}`;
      return await this.runIdempotent(
        options.idempotencyKey,
        'deployments.validate',
        { id, ...input },
        operatorId,
        () => this.executor.run(`deployment:${id}`, () => {
          const replay = this.replayOperation(id, operationId, fingerprint, operatorId);
          if (replay) return replay;
          const current = this.get(id);
          this.assertGeneration(current, expectedGeneration);
          if (current.observedState !== 'planned' && current.observedState !== 'failed' && current.observedState !== 'degraded') {
            throw invalidTransition(current.observedState, 'capacity_reserved');
          }
          if (!this.capacityAllows(current)) {
            throw new ApiError(
              'device.busy',
              'deployment capacity snapshot is not sufficient for validation',
              409,
              true,
            );
          }
          const updated = this.applyStateChange(current, 'capacity_reserved', operationId);
          this.repository.saveOperation(
            { operationId, deploymentId: id, operatorId, fingerprint, result: updated },
            this.config.policy.idempotencyMaxEntries,
          );
          this.recordAccepted(updated, 'deployment.validated', 'deployment.validate', operatorId);
          this.publishState(updated);
          return updated;
        }),
      );
    } catch (error) {
      this.recordRejected(id, operationId, 'deployment.validate', error, operatorId);
      throw error;
    }
  }

  /**
   * Advances the observed state through the explicit mock state machine.  No
   * transition has an external side effect; `ready` is only a simulation
   * observation and never means a real third-party app is ready.
   */
  async transition(
    id: string,
    input: DeploymentTransitionInput,
    options: DeploymentOperationOptions = {},
  ): Promise<DeploymentRecord> {
    const operatorId = options.operatorId ?? 'local-user';
    let operationId: string = randomUUID();
    try {
      assertExactKeys(input, TRANSITION_KEYS, 'deployment transition');
      assertOperatorConfirmed(input.operator_confirmed);
      const target = validateObservedState(input.observed_state);
      const expectedGeneration = validateGeneration(input.expected_generation);
      operationId = resolveOperationId(input.operation_id);
      const fingerprint = `transition:${id}:${expectedGeneration}:${target}`;
      return await this.runIdempotent(
        options.idempotencyKey,
        'deployments.transition',
        { id, ...input },
        operatorId,
        () => this.executor.run(`deployment:${id}`, () => {
          const replay = this.replayOperation(id, operationId, fingerprint, operatorId);
          if (replay) return replay;
          const current = this.get(id);
          this.assertGeneration(current, expectedGeneration);
          if (current.observedState === target) {
            this.repository.saveOperation(
              { operationId, deploymentId: id, operatorId, fingerprint, result: current },
              this.config.policy.idempotencyMaxEntries,
            );
            this.recordAccepted(current, 'deployment.state.unchanged', 'deployment.transition', operatorId);
            return current;
          }
          if (!DEPLOYMENT_STATE_TRANSITIONS[current.observedState].includes(target)) {
            throw invalidTransition(current.observedState, target);
          }
          if (target === 'ready' && !this.capacityAllows(current)) {
            throw new ApiError(
              'device.busy',
              'deployment capacity snapshot is not sufficient for ready state',
              409,
              true,
            );
          }
          const updated = this.applyStateChange(current, target, operationId);
          this.repository.saveOperation(
            { operationId, deploymentId: id, operatorId, fingerprint, result: updated },
            this.config.policy.idempotencyMaxEntries,
          );
          this.recordAccepted(updated, 'deployment.state.changed', 'deployment.transition', operatorId);
          this.publishState(updated);
          return updated;
        }),
      );
    } catch (error) {
      this.recordRejected(id, operationId, 'deployment.transition', error, operatorId);
      throw error;
    }
  }

  /** Changes desired state without pretending to reconcile an external provider. */
  async setDesiredState(
    id: string,
    input: DeploymentDesiredStateInput,
    options: DeploymentOperationOptions = {},
  ): Promise<DeploymentRecord> {
    const operatorId = options.operatorId ?? 'local-user';
    let operationId: string = randomUUID();
    try {
      assertExactKeys(input, ['desired_state', ...VALIDATE_KEYS] as const, 'deployment desired state');
      assertOperatorConfirmed(input.operator_confirmed);
      const desiredState = validateDesiredState(input.desired_state);
      const expectedGeneration = validateGeneration(input.expected_generation);
      operationId = resolveOperationId(input.operation_id);
      const fingerprint = `desired:${id}:${expectedGeneration}:${desiredState}`;
      return await this.runIdempotent(
        options.idempotencyKey,
        'deployments.desired-state',
        { id, ...input },
        operatorId,
        () => this.executor.run(`deployment:${id}`, () => {
          const replay = this.replayOperation(id, operationId, fingerprint, operatorId);
          if (replay) return replay;
          const current = this.get(id);
          this.assertGeneration(current, expectedGeneration);
          if (current.desiredState === desiredState) {
            this.repository.saveOperation(
              { operationId, deploymentId: id, operatorId, fingerprint, result: current },
              this.config.policy.idempotencyMaxEntries,
            );
            this.recordAccepted(current, 'deployment.desired.unchanged', 'deployment.desired-state', operatorId);
            return current;
          }
          if (current.observedState === 'released') {
            throw invalidTransition(current.observedState, desiredState);
          }
          const updated = this.repository.update(id, (record) => {
            record.desiredState = desiredState;
            record.generation += 1;
            record.operationId = operationId;
            record.updatedAt = this.clock.nowIso();
          });
          if (!updated) throw deploymentNotFound();
          this.repository.saveOperation(
            { operationId, deploymentId: id, operatorId, fingerprint, result: updated },
            this.config.policy.idempotencyMaxEntries,
          );
          this.recordAccepted(updated, 'deployment.desired.changed', 'deployment.desired-state', operatorId);
          this.publishState(updated);
          return updated;
        }),
      );
    } catch (error) {
      this.recordRejected(id, operationId, 'deployment.desired-state', error, operatorId);
      throw error;
    }
  }

  private runIdempotent<T>(
    key: string | undefined,
    scope: string,
    payload: unknown,
    subject: string,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    if (!key) return Promise.resolve().then(operation);
    return this.idempotency.execute(key, scope, payload, operation, subject);
  }

  private replayOperation(
    deploymentId: string,
    operationId: string,
    fingerprint: string,
    operatorId: string,
  ): DeploymentRecord | undefined {
    const existing = this.repository.getOperation(operationId);
    if (!existing) return undefined;
    if (existing.operatorId !== operatorId) {
      throw new PolicyDeniedError('operation belongs to another operator');
    }
    if (existing.deploymentId !== deploymentId || existing.fingerprint !== fingerprint) {
      throw new IdempotencyReplayError();
    }
    return existing.result;
  }

  private assertGeneration(record: DeploymentRecord, expectedGeneration: number): void {
    if (record.generation !== expectedGeneration) throw new CommandStaleError();
  }

  private capacityAllows(record: DeploymentRecord): boolean {
    return record.capacitySnapshot.requestedInstances <= record.capacitySnapshot.effectiveInstances;
  }

  private applyStateChange(
    current: DeploymentRecord,
    observedState: DeploymentObservedState,
    operationId: string,
  ): DeploymentRecord {
    const updated = this.repository.update(current.id, (record) => {
      record.observedState = observedState;
      record.generation += 1;
      record.operationId = operationId;
      record.updatedAt = this.clock.nowIso();
    });
    if (!updated) throw deploymentNotFound();
    return updated;
  }

  private recordAccepted(
    record: DeploymentRecord,
    type: string,
    command: string,
    operatorId: string,
  ): void {
    this.audit.append({
      type,
      operatorId,
      // operation_id is an opaque client-visible value and need not be a UUID;
      // the audit contract's correlation_id remains a UUID resource identity.
      correlationId: record.id,
      result: 'accepted',
      metadata: {
        source: 'deployment-domain',
        command,
        state: record.observedState,
        count: record.capacitySnapshot.requestedInstances,
        operator_confirmed: true,
        operation_id: record.operationId,
        deployment_id: record.id,
      },
    });
  }

  private recordRejected(
    deploymentId: string | undefined,
    operationId: string,
    command: string,
    error: unknown,
    operatorId: string,
  ): void {
    const reason = rejectionReason(error);
    const errorCode = error instanceof ApiError ? error.code : 'request.internal';
    try {
      this.audit.append({
        type: 'deployment.operation.rejected',
        operatorId,
        ...(deploymentId ? { correlationId: deploymentId } : { correlationId: operationId }),
        result: 'rejected',
        metadata: { source: 'deployment-domain', command, reason, error_code: errorCode },
      });
      this.events.publish(
        'deployment.operation.rejected',
        {
          deployment_id: deploymentId ?? null,
          operation_id: operationId,
          command,
          reason,
          error_code: errorCode,
          planning_only: true,
          side_effects: 'none',
        },
        deploymentId ? `deployment/${deploymentId}` : 'deployment/unassigned',
      );
    } catch {
      // Rejection telemetry is best effort and must never replace the domain error.
    }
  }

  private publishState(record: DeploymentRecord): void {
    this.events.publish(
      'deployment.state.changed',
      {
        deployment_id: record.id,
        provider_id: record.providerId,
        execution_mode: record.executionMode,
        planning_only: record.planningOnly,
        side_effects: record.sideEffects,
        desired_state: record.desiredState,
        observed_state: record.observedState,
        generation: record.generation,
        operation_id: record.operationId,
        capacity_snapshot: {
          requested_instances: record.capacitySnapshot.requestedInstances,
          safe_instances: record.capacitySnapshot.safeInstances,
          effective_instances: record.capacitySnapshot.effectiveInstances,
          startup_concurrency: record.capacitySnapshot.startupConcurrency,
          confidence: record.capacitySnapshot.confidence,
        },
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      },
      `deployment/${record.id}`,
    );
  }
}

export function parseDeploymentPlan(input: unknown): DeploymentPlanInput {
  assertExactKeys(input, PLAN_KEYS, 'deployment plan');
  if (!isRecord(input)) throw schemaError('deployment plan must be an object');
  assertOperatorConfirmed(input.operator_confirmed);
  if (input.provider_id !== DEPLOYMENT_PROVIDER_ID) {
    throw new PolicyDeniedError('only mock-adapter deployments are enabled');
  }
  if (input.execution_mode !== DEPLOYMENT_EXECUTION_MODE) {
    throw new PolicyDeniedError('only mock_only deployment execution is enabled');
  }
  const manifest = providerManifest(DEPLOYMENT_PROVIDER_ID);
  if (!manifest || manifest.kind !== 'mock') {
    throw new PolicyDeniedError('the selected provider is not a mock provider');
  }
  if (!isDesiredState(input.desired_state)) {
    throw schemaError('desired_state is not supported');
  }
  if (!isPositiveInteger(input.instances) || input.instances > 64) {
    throw schemaError('instances must be an integer between 1 and 64');
  }
  return {
    operator_confirmed: true,
    provider_id: DEPLOYMENT_PROVIDER_ID,
    execution_mode: DEPLOYMENT_EXECUTION_MODE,
    desired_state: input.desired_state,
    instances: input.instances,
  };
}

function assertOperatorConfirmed(value: unknown): asserts value is true {
  if (value !== true) throw schemaError('operator_confirmed must be true');
}

function validateCapacitySnapshot(
  value: DeploymentCapacitySnapshot | undefined,
  requestedInstances: number,
): DeploymentCapacitySnapshot {
  if (!isRecord(value)) throw schemaError('capacity_snapshot is required from the host planner');
  assertExactKeys(value, [
    'requestedInstances',
    'safeInstances',
    'effectiveInstances',
    'startupConcurrency',
    'confidence',
  ] as const, 'capacity_snapshot');
  const requested = value.requestedInstances;
  const safe = value.safeInstances;
  const effective = value.effectiveInstances;
  const startup = value.startupConcurrency;
  if (
    !isNonNegativeInteger(requested) ||
    !isNonNegativeInteger(safe) ||
    !isNonNegativeInteger(effective) ||
    !isNonNegativeInteger(startup) ||
    !isCapacityConfidence(value.confidence)
  ) {
    throw schemaError('capacity_snapshot contains invalid values');
  }
  if (requested !== requestedInstances) throw schemaError('capacity_snapshot.requestedInstances must match instances');
  if (effective > safe) throw schemaError('capacity_snapshot.effectiveInstances cannot exceed safeInstances');
  if (startup > effective) throw schemaError('capacity_snapshot.startupConcurrency cannot exceed effectiveInstances');
  if (requestedInstances > effective) {
    throw new ApiError('device.busy', 'instances exceed the effective host capacity', 409, true);
  }
  return {
    requestedInstances: requested,
    safeInstances: safe,
    effectiveInstances: effective,
    startupConcurrency: startup,
    confidence: value.confidence,
  };
}

function validateGeneration(value: unknown): number {
  if (!isPositiveInteger(value)) throw schemaError('expected_generation must be a positive integer');
  return value;
}

function resolveOperationId(value: unknown): string {
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) {
    throw schemaError('operation_id must contain 8-128 safe characters');
  }
  return value;
}

function validateDesiredState(value: unknown): DeploymentDesiredState {
  if (!isDesiredState(value)) throw schemaError('desired_state is not supported');
  return value;
}

function validateObservedState(value: unknown): DeploymentObservedState {
  if (!isObservedState(value)) throw schemaError('observed_state is not supported');
  return value;
}

function isDesiredState(value: unknown): value is DeploymentDesiredState {
  return typeof value === 'string' && (DEPLOYMENT_DESIRED_STATES as readonly string[]).includes(value);
}

function isObservedState(value: unknown): value is DeploymentObservedState {
  return typeof value === 'string' && (DEPLOYMENT_OBSERVED_STATES as readonly string[]).includes(value);
}

function isCapacityConfidence(value: unknown): value is DeploymentCapacitySnapshot['confidence'] {
  return typeof value === 'string' && (DEPLOYMENT_CAPACITY_CONFIDENCE as readonly string[]).includes(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  name: string,
): void {
  if (!isRecord(value)) throw schemaError(`${name} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw schemaError(`${name} contains unknown fields`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(message: string): ApiError {
  return new ApiError('schema.invalid', message, 422);
}

function deploymentNotFound(): ApiError {
  // The shared error union has no deployment-specific code yet.  Keep the
  // HTTP contract stable for now; the future controller can map this to a
  // versioned deployment.not_found code in a major contract revision.
  return new ApiError('request.invalid', 'deployment was not found', 404);
}

function invalidTransition(
  from: string,
  to: string,
): ApiError {
  return new ApiError('schema.invalid', `deployment cannot transition from ${from} to ${to}`, 422);
}

function rejectionReason(error: unknown): string {
  if (error instanceof PolicyDeniedError) return 'policy.denied';
  if (error instanceof CommandStaleError) return 'command.stale';
  if (error instanceof IdempotencyReplayError) return 'idempotency.replay';
  if (error instanceof ApiError) return error.code;
  return 'operation.rejected';
}
