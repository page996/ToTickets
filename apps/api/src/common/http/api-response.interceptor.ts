import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { requestIdOf } from './request-context';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      map((body: unknown) => {
        const requestId = requestIdOf(request);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          return { request_id: requestId, ...(toApiJson(body) as Record<string, unknown>) };
        }
        return { request_id: requestId, data: toApiJson(body) };
      }),
    );
  }
}

function toApiJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toApiJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
      toApiJson(nested),
    ]),
  );
}
