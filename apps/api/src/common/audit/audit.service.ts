import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { AuditRecord, AuditRepository } from '../storage/audit.repository';
import { ClockService } from '../time/clock.service';
import { safeAuditOperatorId } from '../http/operator-id';

export interface AuditInput {
  type: string;
  operatorId?: string;
  deviceId?: string;
  scheduleId?: string;
  correlationId?: string;
  result: 'accepted' | 'rejected';
  metadata?: Record<string, unknown>;
}

const ALLOWED_METADATA = new Set([
  'source',
  'reason',
  'state',
  'sequence',
  'channel',
  'command',
  'stream',
  'count',
  'operator_confirmed',
  'confirmation_id',
  'intent',
  'error_code',
]);

@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly clock: ClockService,
  ) {}

  append(input: AuditInput): AuditRecord {
    const occurredAt = this.clock.nowIso();
    const record: AuditRecord = {
      id: randomUUID(),
      type: input.type,
      occurredAt,
      operatorId: safeAuditOperatorId(input.operatorId),
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
      correlationId: input.correlationId || randomUUID(),
      policyVersion: this.config.policyVersion,
      result: input.result,
      metadata: sanitizeMetadata(input.metadata),
    };
    this.repository.append(record, this.config.limits.auditMaxRecords);
    this.prune();
    return structuredClone(record);
  }

  list(options: { page: number; pageSize: number; type?: string; deviceId?: string }): { items: AuditRecord[]; page: number; pageSize: number; total: number } {
    this.prune();
    const filtered = this.repository
      .list()
      .reverse()
      .filter((item) =>
        (!options.type || item.type === options.type) &&
        (!options.deviceId || item.deviceId === options.deviceId),
      )
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    const start = (options.page - 1) * options.pageSize;
    return {
      items: filtered.slice(start, start + options.pageSize),
      page: options.page,
      pageSize: options.pageSize,
      total: filtered.length,
    };
  }

  export(): AuditRecord[] {
    this.prune();
    return this.repository.list().slice();
  }

  private prune(): void {
    const cutoff = this.clock.nowEpochMs() - this.config.limits.auditRetentionDays * 86400000;
    this.repository.removeBefore(cutoff);
  }
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  if (!metadata) return {};
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'boolean') {
      output[key] = typeof value === 'string' ? value.slice(0, 256) : value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value;
    }
  }
  return output;
}
