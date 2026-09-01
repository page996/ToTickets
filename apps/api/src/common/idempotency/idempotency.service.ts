import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { IdempotencyReplayError, ApiError } from '../errors/api-error';
import { ClockService } from '../time/clock.service';

interface IdempotentResult {
  fingerprint: string;
  expiresAt: number;
  createdAt: number;
  inFlight: boolean;
  result: Promise<unknown>;
}

export interface IdempotencyStats {
  entries: number;
  inFlight: number;
  capacity: number;
}

@Injectable()
export class IdempotencyService {
  private readonly entries = new Map<string, IdempotentResult>();

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly clock: ClockService,
  ) {}

  async execute<T>(
    key: string,
    scope: string,
    payload: unknown,
    operation: () => Promise<T> | T,
    subject = 'local-user',
  ): Promise<T> {
    if (typeof key !== 'string') {
      throw new ApiError('schema.invalid', 'Idempotency-Key is required', 422);
    }
    const normalizedKey = key.trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(normalizedKey)) {
      throw new ApiError('schema.invalid', 'Idempotency-Key must contain 8-128 safe characters', 422);
    }
    this.prune();
    const fingerprint = createHash('sha256')
      .update(stableJson({ scope, subject, payload }))
      .digest('hex');
    const existing = this.entries.get(normalizedKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyReplayError();
      return structuredClone(await existing.result) as T;
    }

    this.enforceCapacity();
    const createdAt = this.clock.nowEpochMs();
    const result = Promise.resolve()
      .then(operation)
      .then((value) => structuredClone(value));
    const entry: IdempotentResult = {
      fingerprint,
      expiresAt: createdAt + this.config.policy.idempotencyTtlSeconds * 1000,
      createdAt,
      inFlight: true,
      result,
    };
    this.entries.set(normalizedKey, entry);
    try {
      const value = await result;
      entry.inFlight = false;
      return structuredClone(value) as T;
    } catch (error) {
      if (this.entries.get(normalizedKey) === entry) this.entries.delete(normalizedKey);
      throw error;
    }
  }

  getStats(): IdempotencyStats {
    this.prune();
    let inFlight = 0;
    for (const entry of this.entries.values()) if (entry.inFlight) inFlight += 1;
    return { entries: this.entries.size, inFlight, capacity: this.config.policy.idempotencyMaxEntries };
  }

  private prune(): void {
    const now = this.clock.nowEpochMs();
    for (const [key, entry] of this.entries) {
      if (!entry.inFlight && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private enforceCapacity(): void {
    while (this.entries.size >= this.config.policy.idempotencyMaxEntries) {
      const candidate = [...this.entries.entries()]
        .filter(([, entry]) => !entry.inFlight)
        .sort(([, left], [, right]) => left.createdAt - right.createdAt || left.expiresAt - right.expiresAt)[0];
      if (!candidate) {
        throw new ApiError('device.busy', 'idempotency cache capacity has been reached', 503, true);
      }
      this.entries.delete(candidate[0]);
    }
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
