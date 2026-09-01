import { Injectable } from '@nestjs/common';

export interface AuditRecord {
  id: string;
  type: string;
  occurredAt: string;
  operatorId: string;
  deviceId?: string;
  scheduleId?: string;
  correlationId: string;
  policyVersion: string;
  result: 'accepted' | 'rejected';
  metadata: Record<string, string | number | boolean>;
}

@Injectable()
export class AuditRepository {
  private readonly records: AuditRecord[] = [];
  private capacityEvictions = 0;

  append(record: AuditRecord, maximumRecords: number): void {
    this.records.push(structuredClone(record));
    const overflow = this.records.length - maximumRecords;
    if (overflow > 0) {
      this.records.splice(0, overflow);
      this.capacityEvictions += overflow;
    }
  }

  list(): AuditRecord[] {
    return structuredClone(this.records);
  }

  removeBefore(cutoffEpochMs: number): void {
    while (this.records.length && Date.parse(this.records[0].occurredAt) < cutoffEpochMs) {
      this.records.shift();
    }
  }

  getStats(): { retained: number; capacityEvictions: number } {
    return { retained: this.records.length, capacityEvictions: this.capacityEvictions };
  }
}
