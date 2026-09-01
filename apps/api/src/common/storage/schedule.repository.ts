import { Injectable } from '@nestjs/common';

export interface ReminderDefinition {
  offsetSeconds: number;
  channel: 'desktop' | 'sound';
}

export type ScheduleState =
  | 'draft'
  | 'scheduled'
  | 'notified'
  | 'human_confirmed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ScheduleRecord {
  id: string;
  label: string;
  publicReference?: string;
  startsAt: string;
  timezone: string;
  reminders: ReminderDefinition[];
  state: ScheduleState;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ScheduleRepository {
  private readonly records = new Map<string, ScheduleRecord>();

  list(): ScheduleRecord[] {
    return [...this.records.values()].map(cloneScheduleRecord);
  }

  get(id: string): ScheduleRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneScheduleRecord(record) : undefined;
  }

  size(): number {
    return this.records.size;
  }

  create(record: ScheduleRecord, maximumSchedules: number): ScheduleRecord | undefined {
    if (this.records.size >= maximumSchedules) return undefined;
    if (this.records.has(record.id)) throw new Error('schedule record already exists');
    const stored = cloneScheduleRecord(record);
    this.records.set(stored.id, stored);
    return cloneScheduleRecord(stored);
  }

  update(
    id: string,
    change: (record: ScheduleRecord) => void,
  ): ScheduleRecord | undefined {
    const current = this.records.get(id);
    if (!current) return undefined;
    const draft = cloneScheduleRecord(current);
    change(draft);
    if (draft.id !== id) throw new Error('schedule record id cannot change');
    const stored = cloneScheduleRecord(draft);
    this.records.set(id, stored);
    return cloneScheduleRecord(stored);
  }
}

function cloneScheduleRecord(record: ScheduleRecord): ScheduleRecord {
  return structuredClone(record);
}
