import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PolicyDeniedError } from '../errors/api-error';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'otp',
  'sms_code',
  'smscode',
  'verification_code',
  'id_card',
  'idcard',
  'identity_number',
  'payment_token',
  'payment_password',
  'payment_code',
  'cookie',
  'authorization',
  'access_token',
  'refresh_token',
  'bearer_token',
  'secret',
].map(normalized));

const PROHIBITED_TERMS = [
  'click',
  'tap',
  'input',
  'purchase',
  'order',
  'captcha',
  'pay',
  'broadcast',
  'batch-input',
  'batch_input',
  'batchinput',
  'ocr',
  'credential',
];

export function isProhibitedOperationPath(path: string): boolean {
  const candidate = normalized(path);
  return PROHIBITED_TERMS.some((term) => candidate.includes(normalized(term)));
}

function normalized(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

@Injectable()
export class PolicyService {
  inspectRequest(request: Request): void {
    this.inspectValue(request.body, new Set());
    if (isProhibitedOperationPath(request.path)) {
      throw new PolicyDeniedError('the requested operation is outside the human-in-the-loop policy');
    }
    const targets = (request.body as Record<string, unknown> | undefined)?.targets;
    const deviceIds = (request.body as Record<string, unknown> | undefined)?.device_ids;
    const deviceIdsCamel = (request.body as Record<string, unknown> | undefined)?.deviceIds;
    for (const value of [targets, deviceIds, deviceIdsCamel]) {
      if (Array.isArray(value) && value.length > 1) {
        throw new PolicyDeniedError('commands may target only one device at a time');
      }
    }
  }

  assertIntentAllowed(intent: string): void {
    const normalizedIntent = normalized(intent);
    if (PROHIBITED_TERMS.some((term) => normalizedIntent.includes(normalized(term)))) {
      throw new PolicyDeniedError('the requested command is prohibited by policy');
    }
  }

  private inspectValue(value: unknown, visited: Set<object>): void {
    if (Array.isArray(value)) {
      if (value.length > 1 && value.every((entry) => typeof entry === 'string' && this.looksLikeDeviceId(entry))) {
        throw new PolicyDeniedError('batch device commands are not supported');
      }
      for (const entry of value) this.inspectValue(entry, visited);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const keyName = normalized(key);
      if (SENSITIVE_KEYS.has(keyName) || [...SENSITIVE_KEYS].some((candidate) => keyName.includes(candidate))) {
        throw new PolicyDeniedError(`field ${key} is not accepted by the control plane`);
      }
      if (typeof nested === 'string' && (keyName === 'command' || keyName === 'action' || keyName === 'intent')) {
        this.assertIntentAllowed(nested);
      }
      this.inspectValue(nested, visited);
    }
  }

  private looksLikeDeviceId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
  }
}
