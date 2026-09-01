import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../src/common/audit/audit.service';
import { ApiExceptionFilter } from '../src/common/http/api-exception.filter';
import { ApiError, CommandStaleError, IdempotencyReplayError } from '../src/common/errors/api-error';

describe('ApiExceptionFilter', () => {
  it.each([
    new Error('sensitive internal details'),
    new HttpException('sensitive internal details', HttpStatus.INTERNAL_SERVER_ERROR),
  ])('classifies an internal failure without exposing its details', (exception) => {
    const audit = { append: jest.fn() } as unknown as AuditService;
    const filter = new ApiExceptionFilter(audit);
    const { host, response } = createHttpHost();

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith({
      request_id: 'request-test-001',
      code: 'request.internal',
      message: 'internal control-plane error',
      retryable: true,
    });
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain(
      'sensitive internal details',
    );
  });

  it.each([
    [new CommandStaleError(), 'command.stale'],
    [new IdempotencyReplayError(), 'idempotency.replay'],
    [new ApiError('device.busy', 'busy', 503, true), 'device.busy'],
    [new ApiError('schema.invalid', 'invalid', 422), 'schema.invalid'],
    [new ApiError('schedule.started', 'started', 409), 'schedule.started'],
  ] as const)('audits business rejection %s with stable context', (exception, code) => {
    const audit = { append: jest.fn() } as unknown as AuditService;
    const filter = new ApiExceptionFilter(audit);
    const { host, response } = createHttpHost({
      path: '/api/v1/schedules/00000000-0000-4000-8000-000000000001',
      body: {
        operator_id: 'operator-1',
        confirmation_id: '00000000-0000-4000-8000-000000000002',
        intent: 'device.start',
      },
      headerOperator: 'operator-1',
      params: { id: '00000000-0000-4000-8000-000000000001' },
    });

    filter.catch(exception, host);

    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      type: code,
      result: 'rejected',
      operatorId: 'operator-1',
      metadata: expect.objectContaining({
        error_code: code,
        confirmation_id: '00000000-0000-4000-8000-000000000002',
        intent: 'device.start',
      }),
    }));
    expect(response.status).toHaveBeenCalled();
  });

  it('does not replace the original rejection when audit persistence fails', () => {
    const audit = { append: jest.fn(() => { throw new Error('audit unavailable'); }) } as unknown as AuditService;
    const filter = new ApiExceptionFilter(audit);
    const { host, response } = createHttpHost();

    expect(() => filter.catch(new ApiError('schema.invalid', 'invalid', 422), host)).not.toThrow();
    expect(response.status).toHaveBeenCalledWith(422);
  });
});

function createHttpHost(overrides: {
  path?: string;
  body?: unknown;
  params?: Record<string, string>;
  headerOperator?: string;
} = {}): {
  host: ArgumentsHost;
  response: { status: jest.Mock; json: jest.Mock };
} {
  const request = {
    path: overrides.path ?? '/api/v1/health/live',
    body: overrides.body,
    params: overrides.params ?? {},
    requestId: 'request-test-001',
    header: jest.fn((name: string) => name.toLowerCase() === 'x-operator-id' ? overrides.headerOperator : undefined),
  } as unknown as Request;
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response as unknown as Response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}
