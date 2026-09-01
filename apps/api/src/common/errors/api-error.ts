export type ApiErrorCode =
  | 'policy.denied'
  | 'operator.confirmation_required'
  | 'command.expired'
  | 'command.stale'
  | 'idempotency.replay'
  | 'device.not_found'
  | 'device.busy'
  | 'adapter.unavailable'
  | 'clock.uncertain'
  | 'schema.invalid'
  | 'schedule.not_found'
  | 'schedule.not_notified'
  | 'schedule.started'
  | 'request.internal'
  | 'request.invalid';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = 400,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class PolicyDeniedError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('policy.denied', message, 403, false, details);
  }
}

export class ConfirmationRequiredError extends ApiError {
  constructor(message = 'an explicit operator confirmation is required') {
    super('operator.confirmation_required', message, 428);
  }
}

export class CommandExpiredError extends ApiError {
  constructor(message = 'the operator confirmation has expired') {
    super('command.expired', message, 409);
  }
}

export class CommandStaleError extends ApiError {
  constructor(message = 'the device state changed after operator confirmation') {
    super('command.stale', message, 409);
  }
}

export class IdempotencyReplayError extends ApiError {
  constructor(message = 'the idempotency key was already used with different parameters') {
    super('idempotency.replay', message, 409);
  }
}
