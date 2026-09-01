/**
 * Deployment domain types deliberately describe a simulation boundary.  A
 * deployment record is not a device record and does not contain executable
 * paths, credentials, or provider-specific command arguments.
 */

export const DEPLOYMENT_PROVIDER_ID = 'mock-adapter' as const;
export const DEPLOYMENT_EXECUTION_MODE = 'mock_only' as const;

export const DEPLOYMENT_DESIRED_STATES = ['stopped', 'ready', 'released'] as const;
export type DeploymentDesiredState = (typeof DEPLOYMENT_DESIRED_STATES)[number];

export const DEPLOYMENT_OBSERVED_STATES = [
  'planned',
  'validating',
  'capacity_reserved',
  'provisioning',
  'starting',
  'ready',
  'degraded',
  'failed',
  'stopping',
  'stopped',
  'released',
] as const;
export type DeploymentObservedState = (typeof DEPLOYMENT_OBSERVED_STATES)[number];

export const DEPLOYMENT_CAPACITY_CONFIDENCE = ['measured', 'estimated', 'unknown'] as const;
export type DeploymentCapacityConfidence = (typeof DEPLOYMENT_CAPACITY_CONFIDENCE)[number];

/**
 * A non-sensitive snapshot copied from the host planner.  It is intentionally
 * independent of HostService's implementation so another host/provider
 * planner can be introduced without changing the deployment contract.
 */
export interface DeploymentCapacitySnapshot {
  readonly requestedInstances: number;
  readonly safeInstances: number;
  readonly effectiveInstances: number;
  readonly startupConcurrency: number;
  readonly confidence: DeploymentCapacityConfidence;
}

export interface DeploymentPlanInput {
  readonly operator_confirmed: true;
  readonly provider_id: string;
  readonly execution_mode: string;
  readonly desired_state: string;
  readonly instances: number;
}

export interface DeploymentOperationInput {
  readonly operator_confirmed: true;
  readonly expected_generation: number;
  readonly operation_id?: string;
}

export interface DeploymentValidateInput extends DeploymentOperationInput {}

export interface DeploymentTransitionInput extends DeploymentOperationInput {
  readonly observed_state: string;
}

export interface DeploymentDesiredStateInput extends DeploymentOperationInput {
  readonly desired_state: string;
}

export interface DeploymentPlanOptions {
  readonly operatorId?: string;
  readonly idempotencyKey?: string;
  readonly capacitySnapshot?: DeploymentCapacitySnapshot;
  /** Optional repository bound for a caller that owns deployment quotas. */
  readonly maximumRecords?: number;
}

export interface DeploymentOperationOptions {
  readonly operatorId?: string;
  readonly idempotencyKey?: string;
}

export interface DeploymentRecord {
  id: string;
  providerId: typeof DEPLOYMENT_PROVIDER_ID;
  executionMode: typeof DEPLOYMENT_EXECUTION_MODE;
  /** True even for the mock implementation: this record never starts a host process. */
  planningOnly: true;
  sideEffects: 'none';
  desiredState: DeploymentDesiredState;
  observedState: DeploymentObservedState;
  /** Monotonic state version; starts at one and advances on accepted changes. */
  generation: number;
  /** Operation that produced the current snapshot. */
  operationId: string;
  capacitySnapshot: DeploymentCapacitySnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentOperationRecord {
  readonly operationId: string;
  readonly deploymentId: string;
  readonly operatorId: string;
  readonly fingerprint: string;
  readonly result: DeploymentRecord;
}

export const DEPLOYMENT_STATE_TRANSITIONS: Readonly<Record<
  DeploymentObservedState,
  readonly DeploymentObservedState[]
>> = Object.freeze({
  planned: ['validating', 'stopped', 'failed'],
  validating: ['capacity_reserved', 'failed'],
  capacity_reserved: ['provisioning', 'starting', 'ready', 'failed', 'stopped'],
  provisioning: ['starting', 'failed', 'stopping'],
  starting: ['ready', 'degraded', 'failed'],
  ready: ['degraded', 'stopping', 'stopped'],
  degraded: ['validating', 'starting', 'stopping', 'failed'],
  failed: ['validating', 'stopping', 'stopped', 'released'],
  stopping: ['stopped', 'failed'],
  stopped: ['validating', 'released'],
  released: [],
} as const);
