import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithId extends Request {
  requestId?: string;
}

export function requestContextMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header(REQUEST_ID_HEADER);
  const requestId = supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function requestIdOf(request: Request): string {
  return (request as RequestWithId).requestId ?? request.header(REQUEST_ID_HEADER) ?? randomUUID();
}
