import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service';
import { EventBusService } from '../common/events/event-bus.service';
import { ApiError } from '../common/errors/api-error';
import { ScheduleRecord, ScheduleRepository } from '../common/storage/schedule.repository';
import { CreateScheduleDto, UpdateScheduleDto } from './schedule.dto';
import { ClockService } from '../common/time/clock.service';
import { ReminderService } from './reminder.service';
import { KeyedSerialExecutor } from '../common/concurrency/keyed-serial-executor.service';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';

const TERMINAL_SCHEDULE_STATES = new Set<ScheduleRecord['state']>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

@Injectable()
export class ScheduleService {
  constructor(
    private readonly repository: ScheduleRepository,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly clockService: ClockService,
    private readonly reminderService: ReminderService,
    private readonly executor: KeyedSerialExecutor,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  list(): ScheduleRecord[] {
    return this.repository.list().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  get(id: string): ScheduleRecord {
    const schedule = this.repository.get(id);
    if (!schedule) throw new ApiError('schedule.not_found', 'schedule was not found', 404);
    return schedule;
  }

  create(dto: CreateScheduleDto, operatorId = 'local-user'): Promise<ScheduleRecord> {
    return this.executor.run('schedule-registration', () => {
      if (dto.label.trim().length === 0) throw new ApiError('schema.invalid', 'label must contain visible text', 422);
      const startsAt = parseStart(dto.starts_at, this.clockService.nowEpochMs());
      assertTimeZone(dto.timezone);
      assertReminderTargetsInFuture(
        startsAt.getTime(),
        dto.reminders,
        this.clockService.nowEpochMs(),
      );
      const now = this.clockService.nowIso();
      const created = this.repository.create({
        id: randomUUID(),
        label: dto.label.trim(),
        ...(dto.public_reference ? { publicReference: validatePublicReference(dto.public_reference) } : {}),
        startsAt: startsAt.toISOString(),
        timezone: dto.timezone,
        reminders: dto.reminders.map((item) => ({ offsetSeconds: item.offset_seconds, channel: item.channel })),
        state: 'scheduled',
        createdAt: now,
        updatedAt: now,
      }, this.config.limits.maxSchedules);
      if (!created) throw new ApiError('device.busy', 'schedule capacity has been reached', 409, true);
      this.audit.append({ type: 'schedule.created', operatorId, scheduleId: created.id, result: 'accepted', metadata: { source: 'control-plane', state: created.state } });
      this.events.publish('schedule.created', { schedule_id: created.id, state: created.state, starts_at: created.startsAt }, `schedule/${created.id}`);
      this.reminderService.arm(created);
      return created;
    });
  }

  update(id: string, dto: UpdateScheduleDto, operatorId = 'local-user'): Promise<ScheduleRecord> {
    return this.executor.run(`schedule:${id}`, () => {
      const schedule = this.get(id);
      if (dto.label === undefined && dto.reminders === undefined && dto.state === undefined) {
        throw new ApiError('schema.invalid', 'schedule update must include at least one supported field', 422);
      }
      if (dto.label !== undefined && dto.label.trim().length === 0) {
        throw new ApiError('schema.invalid', 'label must contain visible text', 422);
      }
      const isCancellation = dto.state === 'cancelled';
      const hasNonCancellationFields = dto.label !== undefined || dto.reminders !== undefined;
      if (isCancellation && hasNonCancellationFields) {
        throw new ApiError(
          'schema.invalid',
          'cancellation updates must not include label or reminders',
          422,
        );
      }
      if (TERMINAL_SCHEDULE_STATES.has(schedule.state)) {
        throw new ApiError('schedule.started', 'terminal schedules cannot be modified', 409);
      }
      if (Date.parse(schedule.startsAt) <= this.clockService.nowEpochMs() && !isCancellation) {
        throw new ApiError('schedule.started', 'started schedules may only be cancelled', 409);
      }
      if (dto.reminders !== undefined && schedule.state !== 'scheduled') {
        throw new ApiError(
          'schedule.started',
          'reminders may only be changed before the first notification',
          409,
        );
      }
      if (dto.reminders !== undefined) {
        assertReminderTargetsInFuture(
          Date.parse(schedule.startsAt),
          dto.reminders,
          this.clockService.nowEpochMs(),
        );
      }
      const updated = this.repository.update(id, (record) => {
        if (dto.label !== undefined) record.label = dto.label.trim();
        if (dto.reminders !== undefined) record.reminders = dto.reminders.map((item) => ({ offsetSeconds: item.offset_seconds, channel: item.channel }));
        if (dto.state === 'cancelled') record.state = 'cancelled';
        record.updatedAt = this.clockService.nowIso();
      });
      if (!updated) throw new ApiError('schedule.not_found', 'schedule was not found', 404);
      this.audit.append({ type: `schedule.${dto.state === 'cancelled' ? 'cancelled' : 'updated'}`, operatorId, scheduleId: id, result: 'accepted', metadata: { source: 'control-plane', state: updated.state } });
      this.events.publish('schedule.updated', { schedule_id: id, state: updated.state }, `schedule/${id}`);
      if (dto.state === 'cancelled') this.reminderService.cancel(id);
      else if (dto.reminders !== undefined) this.reminderService.arm(updated);
      return updated;
    });
  }

  acknowledge(id: string, operatorId: string): Promise<ScheduleRecord> {
    return this.executor.run(`schedule:${id}`, () => {
      const schedule = this.get(id);
      if (schedule.state !== 'notified') {
        throw new ApiError(
          'schedule.not_notified',
          'only a fired reminder may be acknowledged',
          409,
        );
      }
      const acknowledgedAt = this.clockService.nowIso();
      const updated = this.repository.update(id, (record) => {
        record.state = 'human_confirmed';
        record.acknowledgedAt = acknowledgedAt;
        record.updatedAt = acknowledgedAt;
      });
      if (!updated) throw new ApiError('schedule.not_found', 'schedule was not found', 404);
      this.audit.append({ type: 'reminder.acknowledged', operatorId, scheduleId: id, result: 'accepted', metadata: { source: 'console-ui', state: updated.state, operator_confirmed: true } });
      this.events.publish('reminder.acknowledged', { schedule_id: id, state: updated.state }, `schedule/${id}`);
      this.reminderService.cancel(id);
      return updated;
    });
  }

  clock() {
    return this.clockService.snapshot();
  }
}

function parseStart(value: string, nowEpochMs: number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApiError('schema.invalid', 'starts_at must be a valid ISO-8601 timestamp', 422);
  if (date.getTime() <= nowEpochMs) throw new ApiError('schema.invalid', 'starts_at must be in the future', 422);
  return date;
}

function assertReminderTargetsInFuture(
  startsAtEpochMs: number,
  reminders: ReadonlyArray<{ offset_seconds: number }>,
  nowEpochMs: number,
): void {
  for (const reminder of reminders) {
    const targetEpochMs = startsAtEpochMs + reminder.offset_seconds * 1000;
    if (!Number.isFinite(targetEpochMs) || targetEpochMs <= nowEpochMs) {
      throw new ApiError(
        'schema.invalid',
        'each reminder target must be in the future',
        422,
      );
    }
  }
}

function assertTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw new ApiError('schema.invalid', 'timezone must be a recognized IANA time zone', 422);
  }
}

function validatePublicReference(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ApiError('schema.invalid', 'public_reference must be a public URL without credentials, query, or fragment', 422);
  }
  return parsed.toString();
}
