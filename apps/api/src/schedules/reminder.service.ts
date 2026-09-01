import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { EventBusService } from '../common/events/event-bus.service';
import { ScheduleRecord, ScheduleRepository } from '../common/storage/schedule.repository';
import { ClockService } from '../common/time/clock.service';
import { KeyedSerialExecutor } from '../common/concurrency/keyed-serial-executor.service';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

@Injectable()
export class ReminderService implements OnModuleDestroy {
  private readonly timers = new Map<string, Array<NodeJS.Timeout | undefined>>();
  private readonly generations = new Map<string, symbol>();
  private readonly uncertainReminders = new Set<string>();
  private readonly failedReminders = new Set<string>();
  private readonly firedAudits = new Set<string>();
  private readonly firedEvents = new Set<string>();

  constructor(
    private readonly repository: ScheduleRepository,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly clock: ClockService,
    private readonly executor: KeyedSerialExecutor,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  arm(schedule: ScheduleRecord): void {
    const generation = this.beginGeneration(schedule.id);
    // A re-arm represents a new attempt for every reminder index. Do not let
    // diagnostics from the previous generation suppress its first retry.
    this.clearReportedState(schedule.id);
    if (schedule.state !== 'scheduled') {
      this.generations.delete(schedule.id);
      return;
    }
    const handles = schedule.reminders.map((reminder, index) =>
      this.armOne(
        schedule.id,
        index,
        Date.parse(schedule.startsAt) + reminder.offsetSeconds * 1000,
        generation,
      ),
    );
    if (handles.length === 0) {
      this.generations.delete(schedule.id);
      return;
    }
    this.timers.set(schedule.id, handles);
  }

  cancel(scheduleId: string): void {
    this.beginGeneration(scheduleId);
    this.clearReportedState(scheduleId);
    this.generations.delete(scheduleId);
  }

  onModuleDestroy(): void {
    for (const scheduleId of this.timers.keys()) this.cancel(scheduleId);
  }

  private armOne(
    scheduleId: string,
    reminderIndex: number,
    targetEpochMs: number,
    generation: symbol,
    minimumDelayMs = 0,
  ): NodeJS.Timeout {
    const remaining = targetEpochMs - this.clock.nowEpochMs();
    const delay = Math.max(
      minimumDelayMs,
      Math.min(Math.max(0, remaining), MAX_TIMER_DELAY_MS),
    );
    return setTimeout(() => {
      if (!this.isCurrentGeneration(scheduleId, generation)) return;
      const currentRemaining = targetEpochMs - this.clock.nowEpochMs();
      if (currentRemaining > 0) {
        const replacement = this.armOne(
          scheduleId,
          reminderIndex,
          targetEpochMs,
          generation,
        );
        this.replaceTimer(scheduleId, reminderIndex, generation, replacement);
        return;
      }
      void this.dispatch(scheduleId, reminderIndex, targetEpochMs, generation);
    }, Math.max(0, delay));
  }

  private async dispatch(
    scheduleId: string,
    reminderIndex: number,
    targetEpochMs: number,
    generation: symbol,
  ): Promise<void> {
    try {
      if (!this.isCurrentGeneration(scheduleId, generation)) return;
      const result = await this.executor.run(`schedule:${scheduleId}`, () =>
        this.isCurrentGeneration(scheduleId, generation)
          ? this.fire(scheduleId, reminderIndex, generation)
          : 'ignored',
      );
      if (!this.isCurrentGeneration(scheduleId, generation)) return;
      if (result === 'clock-uncertain') {
        const replacement = this.armOne(
          scheduleId,
          reminderIndex,
          targetEpochMs,
          generation,
          this.config.limits.heartbeatSeconds * 1000,
        );
        this.replaceTimer(scheduleId, reminderIndex, generation, replacement);
        return;
      }
      this.completeTimer(scheduleId, reminderIndex, generation);
    } catch {
      if (!this.isCurrentGeneration(scheduleId, generation)) return;
      this.reportDispatchFailure(scheduleId, reminderIndex, generation);
      const schedule = this.repository.get(scheduleId);
      if (this.isCurrentGeneration(scheduleId, generation) &&
        (schedule?.state === 'scheduled' || schedule?.state === 'notified')) {
        const replacement = this.armOne(
          scheduleId,
          reminderIndex,
          targetEpochMs,
          generation,
          this.config.limits.heartbeatSeconds * 1000,
        );
        this.replaceTimer(scheduleId, reminderIndex, generation, replacement);
      } else {
        this.completeTimer(scheduleId, reminderIndex, generation);
      }
    }
  }

  private fire(
    scheduleId: string,
    reminderIndex: number,
    generation: symbol,
  ): 'fired' | 'clock-uncertain' | 'ignored' {
    if (!this.isCurrentGeneration(scheduleId, generation)) return 'ignored';
    const schedule = this.repository.get(scheduleId);
    if (!schedule || !['scheduled', 'notified'].includes(schedule.state)) return 'ignored';
    const reminder = schedule.reminders[reminderIndex];
    if (!reminder) return 'ignored';
    const clock = this.clock.snapshot();
    if (clock.confidence === 'uncertain') {
      const key = reminderKey(scheduleId, reminderIndex);
      if (!this.uncertainReminders.has(key)) {
        this.uncertainReminders.add(key);
        this.audit.append({
          type: 'clock.uncertain',
          scheduleId,
          result: 'rejected',
          metadata: { source: 'control-plane', reason: 'clock-drift' },
        });
        this.events.publish(
          'clock.uncertain',
          { schedule_id: scheduleId, offset_ms: clock.offset_ms },
          `schedule/${scheduleId}`,
        );
      }
      return 'clock-uncertain';
    }
    this.uncertainReminders.delete(reminderKey(scheduleId, reminderIndex));
    const key = reminderKey(scheduleId, reminderIndex);
    const alreadyNotified = schedule.state === 'notified';
    const updated = alreadyNotified
      ? schedule
      : this.repository.update(scheduleId, (record) => {
          record.state = 'notified';
          record.updatedAt = this.clock.nowIso();
        });
    if (!updated) return 'ignored';
    // Audit and event delivery are separate side effects. Mark each one only
    // after it succeeds so a retry can complete the missing side effect
    // without duplicating the one that already committed.
    if (!this.firedAudits.has(key)) {
      this.audit.append({
        type: 'reminder.fired',
        scheduleId,
        result: 'accepted',
        metadata: { source: 'control-plane', channel: reminder.channel, state: updated.state },
      });
      this.firedAudits.add(key);
    }
    if (!this.firedEvents.has(key)) {
      this.events.publish(
        'reminder.fired',
        { schedule_id: scheduleId, channel: reminder.channel, state: updated.state },
        `schedule/${scheduleId}`,
      );
      this.firedEvents.add(key);
    }
    return 'fired';
  }

  private reportDispatchFailure(
    scheduleId: string,
    reminderIndex: number,
    generation: symbol,
  ): void {
    if (!this.isCurrentGeneration(scheduleId, generation)) return;
    const key = reminderKey(scheduleId, reminderIndex);
    if (this.failedReminders.has(key)) return;
    this.failedReminders.add(key);
    try {
      this.audit.append({
        type: 'reminder.dispatch.failed',
        scheduleId,
        result: 'rejected',
        metadata: { source: 'control-plane', reason: 'dispatch-failed' },
      });
    } catch {
      // Diagnostics are best effort after the original dispatch failure.
    }
    try {
      this.events.publish(
        'reminder.dispatch.failed',
        { schedule_id: scheduleId, reminder_index: reminderIndex },
        `schedule/${scheduleId}`,
      );
    } catch {
      // A saturated event bus must not create an unhandled timer rejection.
    }
  }

  private replaceTimer(
    scheduleId: string,
    reminderIndex: number,
    generation: symbol,
    replacement: NodeJS.Timeout,
  ): void {
    if (!this.isCurrentGeneration(scheduleId, generation)) {
      clearTimeout(replacement);
      return;
    }
    const handles = this.timers.get(scheduleId);
    if (handles) handles[reminderIndex] = replacement;
    else clearTimeout(replacement);
  }

  private completeTimer(scheduleId: string, reminderIndex: number, generation: symbol): void {
    if (!this.isCurrentGeneration(scheduleId, generation)) return;
    const handles = this.timers.get(scheduleId);
    if (!handles) return;
    handles[reminderIndex] = undefined;
    const key = reminderKey(scheduleId, reminderIndex);
    this.failedReminders.delete(key);
    this.uncertainReminders.delete(key);
    this.firedAudits.delete(key);
    this.firedEvents.delete(key);
    if (handles.every((handle) => handle === undefined)) {
      this.timers.delete(scheduleId);
      this.generations.delete(scheduleId);
    }
  }

  private beginGeneration(scheduleId: string): symbol {
    for (const timer of this.timers.get(scheduleId) ?? []) {
      if (timer) clearTimeout(timer);
    }
    this.timers.delete(scheduleId);
    const generation = Symbol(scheduleId);
    this.generations.set(scheduleId, generation);
    return generation;
  }

  private isCurrentGeneration(scheduleId: string, generation: symbol): boolean {
    return this.generations.get(scheduleId) === generation;
  }

  private clearReportedState(scheduleId: string): void {
    const prefix = `${scheduleId}:`;
    for (const key of this.uncertainReminders) {
      if (key.startsWith(prefix)) this.uncertainReminders.delete(key);
    }
    for (const key of this.failedReminders) {
      if (key.startsWith(prefix)) this.failedReminders.delete(key);
    }
    for (const key of this.firedAudits) {
      if (key.startsWith(prefix)) this.firedAudits.delete(key);
    }
    for (const key of this.firedEvents) {
      if (key.startsWith(prefix)) this.firedEvents.delete(key);
    }
  }
}

function reminderKey(scheduleId: string, reminderIndex: number): string {
  return `${scheduleId}:${reminderIndex}`;
}
