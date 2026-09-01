import type { Request } from 'express';
import { ApiError } from '../errors/api-error';

const OPERATOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function operatorIdFromHeader(request: Pick<Request, 'header'>): string {
  const operatorId = request.header('x-operator-id');
  if (operatorId === undefined) return 'local-user';
  if (!OPERATOR_ID_PATTERN.test(operatorId)) {
    throw new ApiError(
      'schema.invalid',
      'x-operator-id must contain only letters, digits, dot, underscore, colon, or hyphen',
      422,
    );
  }
  return operatorId;
}

export function safeAuditOperatorId(operatorId: string | undefined): string {
  return operatorId && OPERATOR_ID_PATTERN.test(operatorId) ? operatorId : 'local-user';
}
