import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '../errors/api-error';
import { requestIdOf } from './request-context';
import { isProhibitedOperationPath } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { safeAuditOperatorId } from './operator-id';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = 'request.internal';
    let message = 'internal control-plane error';
    let retryable = true;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      retryable = exception.retryable;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const prohibitedRoute = status === HttpStatus.NOT_FOUND && isProhibitedOperationPath(request.path);
      if (prohibitedRoute) {
        status = HttpStatus.FORBIDDEN;
        code = 'policy.denied';
        message = 'the requested operation is outside the human-in-the-loop policy';
      }
      if (!prohibitedRoute) {
        const internal = status >= HttpStatus.INTERNAL_SERVER_ERROR;
        code = internal
          ? 'request.internal'
          : status === HttpStatus.UNPROCESSABLE_ENTITY
            ? 'schema.invalid'
            : 'request.invalid';
        retryable = internal;
        if (!internal) {
          message = 'request could not be processed';
          const payload = exception.getResponse();
          if (typeof payload === 'string') {
            message = payload;
          } else if (payload && typeof payload === 'object') {
            const record = payload as Record<string, unknown>;
            const candidate = record.message;
            message = Array.isArray(candidate) ? 'request schema validation failed' : String(candidate ?? message);
            if (Array.isArray(candidate)) {
              details = { violations: candidate.map((item) => String(item)) };
            }
          }
        }
      }
    }

    if (exception instanceof ApiError || status < HttpStatus.INTERNAL_SERVER_ERROR) {
      auditRejection(this.audit, request, code);
    }

    response.status(status).json({
      request_id: requestIdOf(request),
      code,
      message,
      ...(retryable ? { retryable: true } : {}),
      ...(details ? { details } : {}),
    });
  }
}

function auditRejection(audit: AuditService, request: Request, code: string): void {
  const body = request.body;
  const bodyRecord = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined;
  const confirmationId = typeof bodyRecord?.confirmation_id === 'string' && isUuidV4(bodyRecord.confirmation_id)
    ? bodyRecord.confirmation_id
    : undefined;
  const intent = typeof bodyRecord?.intent === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(bodyRecord.intent)
    ? bodyRecord.intent
    : undefined;
  try {
    audit.append({
      type: code,
      operatorId: auditOperatorId(request),
      deviceId: auditDeviceId(request),
      result: 'rejected',
      metadata: {
        source: 'control-plane',
        reason: isProhibitedOperationPath(request.path) && code === 'policy.denied'
          ? 'prohibited-route'
          : code,
        error_code: code,
        ...(confirmationId ? { confirmation_id: confirmationId } : {}),
        ...(intent ? { intent } : {}),
      },
    });
  } catch {
    // Audit persistence is best effort and must never replace the original rejection.
  }
}

function auditOperatorId(request: Request): string {
  const body = request.body;
  const bodyOperator = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).operator_id
    : undefined;
  const headerOperator = request.header('x-operator-id');
  const candidate = typeof headerOperator === 'string'
    ? headerOperator
    : bodyOperator;
  return safeAuditOperatorId(typeof candidate === 'string' ? candidate : undefined);
}

function auditDeviceId(request: Request): string | undefined {
  const body = request.body;
  const bodyDevice = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).device_id
    : undefined;
  const pathDevice = request.params?.id;
  const candidate = typeof bodyDevice === 'string' ? bodyDevice : pathDevice;
  return typeof candidate === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : undefined;
}

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
