import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RuntimeConfig, RUNTIME_CONFIG } from '../config/runtime-config';
import { ApiError, ConfirmationRequiredError, PolicyDeniedError } from '../common/errors/api-error';
import { AuditService } from '../common/audit/audit.service';
import { EventBusService } from '../common/events/event-bus.service';
import { DeviceRecord, DeviceRepository } from '../common/storage/device.repository';
import { PolicyService } from '../common/policy/policy.service';
import { DeviceCommandDto, RegisterDeviceDto } from './device.dto';
import {
  ConfirmationReservation,
  ConfirmationService,
} from '../common/confirmation/confirmation.service';
import { DeviceAdapter } from './device-adapter';
import { ClockService } from '../common/time/clock.service';
import { KeyedSerialExecutor } from '../common/concurrency/keyed-serial-executor.service';
import { GlobalOperationCoordinator } from '../common/concurrency/global-operation-coordinator.service';

interface DeviceStopAttempt {
  state?: DeviceRecord['state'];
  stream?: DeviceRecord['stream'];
  failedComponents: Array<'lifecycle-stop' | 'preview-stop'>;
}

const DEVICE_STATES = new Set<DeviceRecord['state']>([
  'offline',
  'discovering',
  'booting',
  'ready',
  'waiting',
  'error',
]);
const ACTIVE_LIFECYCLE_STATES = new Set<DeviceRecord['state']>([
  'discovering',
  'booting',
  'ready',
  'waiting',
]);
const LIFECYCLE_RANK: Readonly<Record<DeviceRecord['state'], number>> = {
  offline: 0,
  discovering: 1,
  booting: 2,
  ready: 3,
  waiting: 4,
  error: -1,
};
const MAX_HEARTBEAT_AGE_MS = 86_400_000;

@Injectable()
export class DeviceService implements OnModuleInit, OnModuleDestroy {
  private heartbeatTimer?: NodeJS.Timeout;
  private healthCheckInFlight?: Promise<void>;

  constructor(
    private readonly repository: DeviceRepository,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly policy: PolicyService,
    private readonly confirmations: ConfirmationService,
    private readonly adapter: DeviceAdapter,
    private readonly clock: ClockService,
    private readonly executor: KeyedSerialExecutor,
    private readonly globalOperations: GlobalOperationCoordinator,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  onModuleInit(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.checkHealthNow().catch(() => undefined);
    }, this.config.limits.heartbeatSeconds * 1000);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  list(filter?: { state?: string; group?: string }): DeviceRecord[] {
    return this.repository.list().filter(
      (device) => (!filter?.state || device.state === filter.state) && (!filter?.group || device.group === filter.group),
    );
  }

  get(id: string): DeviceRecord {
    return this.requireDevice(id);
  }

  register(dto: RegisterDeviceDto, operatorId = 'local-user'): Promise<DeviceRecord> {
    return this.globalOperations.runShared(() => this.executor.run('device-registration', () => {
      if (dto.alias.trim().length === 0) throw new ApiError('schema.invalid', 'alias must contain visible text', 422);
      const group = dto.group?.trim();
      if (dto.group !== undefined && !group) {
        throw new ApiError('schema.invalid', 'group must contain visible text', 422);
      }
      const registered = this.repository.create({
        id: randomUUID(), alias: dto.alias.trim(), provider: dto.provider, transport: dto.transport,
        ...(group ? { group } : {}), state: 'offline', stream: 'stopped', focused: false,
        capabilities: { lifecycle: true, health_read: true, screen_preview: true, user_input: false, automation: false },
        lastSeenAt: this.clock.nowIso(), sequence: 1,
      }, this.config.limits.maxDevices);
      if (!registered) throw new ApiError('device.busy', 'device capacity has been reached', 409, true);
      this.audit.append({ type: 'device.registered', operatorId, deviceId: registered.id, result: 'accepted', metadata: { source: 'control-plane', state: registered.state, sequence: registered.sequence } });
      this.publishState(registered);
      return registered;
    }));
  }

  executeCommand(id: string, operation: 'start' | 'stop' | 'reconnect', dto: DeviceCommandDto): Promise<DeviceRecord> {
    return this.runDeviceWrite(id, () => {
      const device = this.requireDevice(id);
      const { reservation, operatorId } = this.reserveConfirmation(dto, `device.${operation}`, id);
      try {
        const eventType = `device.lifecycle.${({ start: 'started', stop: 'stopped', reconnect: 'reconnected' } as const)[operation]}`;
        if (operation === 'start' && ACTIVE_LIFECYCLE_STATES.has(device.state)) {
          this.audit.append({ type: eventType, operatorId, deviceId: id, result: 'accepted', metadata: { source: 'control-plane', state: device.state, sequence: device.sequence, operator_confirmed: true } });
          reservation.commit();
          return device;
        }

        let updated: DeviceRecord | undefined;
        if (operation === 'stop') {
          const attempt = this.attemptDeviceStop(id);
          updated = this.applyDeviceStopAttempt(id, operatorId, 'device.stop', attempt);
          if (attempt.failedComponents.length > 0) {
            throw new ApiError(
              'adapter.unavailable',
              'device adapter could not complete the requested operation',
              503,
              true,
            );
          }
        } else {
          const next = this.invokeAdapter(id, operatorId, `device.${operation}`, () => ({
            state: this.requireAllowedCommandState(
              operation === 'start'
                ? this.adapter.start(id, randomUUID())
                : this.adapter.reconnect(id, randomUUID()),
              device.state,
            ),
            stream: device.stream,
          }));
          updated = this.repository.update(id, (record) => {
            record.state = next.state;
            record.stream = next.stream;
            record.lastSeenAt = this.clock.nowIso();
            record.sequence += 1;
          });
        }
        if (!updated) throw new ApiError('device.not_found', 'device was not found', 404);
        this.audit.append({ type: eventType, operatorId, deviceId: id, result: 'accepted', metadata: { source: 'control-plane', state: updated.state, stream: updated.stream, sequence: updated.sequence, operator_confirmed: true } });
        this.publishState(updated);
        reservation.commit();
        return updated;
      } catch (error) {
        reservation.release();
        throw error;
      }
    });
  }

  startPreview(id: string, dto: DeviceCommandDto): Promise<DeviceRecord> {
    return this.globalOperations.runExclusive(() => {
      const device = this.requireDevice(id);
      const { reservation, operatorId } = this.reserveConfirmation(dto, 'preview.start', id);
      try {
        if (!['ready', 'waiting'].includes(device.state)) throw new ApiError('adapter.unavailable', 'device must be ready before preview', 503, true);
        if (!device.focused) throw new ApiError('device.busy', 'device must be focused before preview', 409, true);
        if (device.stream === 'running') {
          reservation.commit();
          return device;
        }
        if (this.repository.list().some((candidate) => candidate.id !== id && candidate.stream === 'running')) throw new ApiError('device.busy', 'another read-only preview is already active', 409, true);
        const stream = this.invokeAdapter(id, operatorId, 'preview.start', () =>
          this.requireAdapterStream(
            this.adapter.startReadonlyPreview(id, randomUUID()),
            'running',
          ),
        );
        const updated = this.repository.update(id, (record) => {
          record.stream = stream;
          record.sequence += 1;
        });
        if (!updated) throw new ApiError('device.not_found', 'device was not found', 404);
        this.audit.append({ type: 'screen.stream.started', operatorId, deviceId: id, result: 'accepted', metadata: { source: 'control-plane', stream: updated.stream, sequence: updated.sequence, operator_confirmed: true } });
        this.events.publish('screen.stream.started', { device_id: id, stream: updated.stream, device_sequence: updated.sequence }, `device/${id}`);
        reservation.commit();
        return updated;
      } catch (error) {
        reservation.release();
        throw error;
      }
    });
  }

  stopPreview(id: string, dto: DeviceCommandDto): Promise<DeviceRecord> {
    return this.globalOperations.runExclusive(() => {
      const device = this.requireDevice(id);
      const { reservation, operatorId } = this.reserveConfirmation(dto, 'preview.stop', id);
      try {
        if (device.stream === 'stopped') {
          reservation.commit();
          return device;
        }
        const stream = this.invokeAdapter(id, operatorId, 'preview.stop', () =>
          this.requireAdapterStream(
            this.adapter.stopReadonlyPreview(id, randomUUID()),
            'stopped',
          ),
        );
        const updated = this.repository.update(id, (record) => {
          record.stream = stream;
          record.sequence += 1;
        });
        if (!updated) throw new ApiError('device.not_found', 'device was not found', 404);
        this.audit.append({ type: 'screen.stream.stopped', operatorId, deviceId: id, result: 'accepted', metadata: { source: 'control-plane', stream: updated.stream, sequence: updated.sequence, operator_confirmed: true } });
        this.events.publish('screen.stream.stopped', { device_id: id, stream: updated.stream, device_sequence: updated.sequence }, `device/${id}`);
        reservation.commit();
        return updated;
      } catch (error) {
        reservation.release();
        throw error;
      }
    });
  }

  focus(id: string, dto: DeviceCommandDto): Promise<DeviceRecord> {
    return this.globalOperations.runExclusive(() => {
      this.requireDevice(id);
      const { reservation, operatorId } = this.reserveConfirmation(dto, 'device.focus', id);
      try {
        const activePreview = this.repository.list().find((device) => device.stream === 'running');
        if (activePreview && activePreview.id !== id) {
          throw new ApiError('device.busy', 'stop the active preview before changing focus', 409, true);
        }
        const changed = this.repository.setFocused(id);
        const updated = this.requireDevice(id);
        this.audit.append({ type: 'device.focus.changed', operatorId, deviceId: id, result: 'accepted', metadata: { source: 'control-plane', sequence: updated.sequence, operator_confirmed: true } });
        for (const device of changed) {
          this.events.publish('device.focus.changed', { device_id: device.id, focused: device.focused, device_sequence: device.sequence }, `device/${device.id}`);
        }
        reservation.commit();
        return updated;
      } catch (error) {
        reservation.release();
        throw error;
      }
    });
  }

  stopAll(operatorId = 'local-user'): Promise<{ stopped: number; failed: number }> {
    return this.globalOperations.runExclusive(() => {
      let stopped = 0;
      let failed = 0;
      for (const device of this.repository.list()) {
        if (device.state === 'offline' && device.stream === 'stopped') continue;
        const attempt = this.attemptDeviceStop(device.id);
        const updated = this.applyDeviceStopAttempt(
          device.id,
          operatorId,
          'safety.stop-all',
          attempt,
        );
        if (!updated || attempt.failedComponents.length > 0) {
          failed += 1;
          this.audit.append({
            type: 'safety.stop_device_failed',
            operatorId,
            deviceId: device.id,
            result: 'rejected',
            metadata: {
              source: 'control-plane',
              reason: 'adapter-unavailable',
              command: 'safety.stop-all',
              ...(updated ? { state: updated.state, stream: updated.stream, sequence: updated.sequence } : {}),
              operator_confirmed: true,
            },
          });
          continue;
        }
        this.audit.append({
          type: 'safety.stop_device_stopped',
          operatorId,
          deviceId: device.id,
          result: 'accepted',
          metadata: {
            source: 'control-plane',
            state: updated.state,
            stream: updated.stream,
            sequence: updated.sequence,
            command: 'safety.stop-all',
            operator_confirmed: true,
          },
        });
        this.publishState(updated);
        stopped += 1;
      }
      this.audit.append({
        type: 'safety.stop_all',
        operatorId,
        result: failed === 0 ? 'accepted' : 'rejected',
        metadata: { source: 'control-plane', count: stopped, reason: failed === 0 ? 'completed' : 'partial-failure' },
      });
      if (failed > 0) {
        throw new ApiError(
          'adapter.unavailable',
          'one or more mock adapters could not be stopped',
          503,
          true,
          { stopped, failed },
        );
      }
      return { stopped, failed };
    });
  }

  checkHealthNow(): Promise<void> {
    if (this.healthCheckInFlight) return this.healthCheckInFlight;
    const operation = this.globalOperations.runShared(async () => {
      for (const device of this.repository.list()) {
        try {
          await this.executor.run(`device:${device.id}`, () => this.checkDeviceHealth(device.id));
        } catch {
          // A single saturated or failed device check must not starve the rest.
        }
      }
    });
    const tracked = operation.finally(() => {
      if (this.healthCheckInFlight === tracked) this.healthCheckInFlight = undefined;
    });
    this.healthCheckInFlight = tracked;
    return tracked;
  }

  private runDeviceWrite<T>(id: string, operation: () => T | Promise<T>): Promise<T> {
    return this.globalOperations.runShared(() => this.executor.run(`device:${id}`, operation));
  }

  private requireDevice(id: string): DeviceRecord {
    const device = this.repository.get(id);
    if (!device) throw new ApiError('device.not_found', 'device was not found', 404);
    return device;
  }

  private publishState(device: DeviceRecord, heartbeatAgeMs = this.heartbeatAge(device)): void {
    this.events.publish('device.health.changed', { device_id: device.id, state: device.state, heartbeat_age_ms: heartbeatAgeMs, stream: device.stream, device_sequence: device.sequence }, `device/${device.id}`);
  }

  private checkDeviceHealth(deviceId: string): void {
    const before = this.requireDevice(deviceId);
    let health: ReturnType<DeviceAdapter['health']>;
    try {
      health = this.adapter.health(deviceId);
      if (
        !DEVICE_STATES.has(health.state) ||
        !Number.isSafeInteger(health.heartbeatAgeMs) ||
        health.heartbeatAgeMs < 0 ||
        health.heartbeatAgeMs > MAX_HEARTBEAT_AGE_MS
      ) {
        throw new Error('device adapter returned an invalid health snapshot');
      }
    } catch {
      this.recordHealthFailure(before, 'invalid-or-unavailable-health');
      return;
    }

    if (!isMonotonicHealthTransition(before.state, health.state)) {
      this.recordHealthFailure(before, 'stale-health-state');
      return;
    }

    // A valid health snapshot can explicitly report an adapter error. Treat
    // that signal like a disconnect so an active read-only preview is stopped
    // before exposing the device as failed.
    if (health.state === 'error') {
      this.recordHealthFailure(before, 'adapter-reported-error');
      return;
    }

    const observedEpochMs = this.clock.nowEpochMs() - health.heartbeatAgeMs;
    const previousLastSeenEpochMs = Date.parse(before.lastSeenAt);
    const lastSeenEpochMs = Number.isFinite(previousLastSeenEpochMs)
      ? Math.max(previousLastSeenEpochMs, observedEpochMs)
      : observedEpochMs;
    const stateChanged = before.state !== health.state;
    const updated = this.repository.update(deviceId, (record) => {
      record.state = health.state;
      record.lastSeenAt = new Date(lastSeenEpochMs).toISOString();
      if (stateChanged) record.sequence += 1;
    });
    if (!updated || !stateChanged) return;
    this.audit.append({
      type: 'device.health.changed',
      operatorId: 'local-system',
      deviceId,
      result: 'accepted',
      metadata: {
        source: 'control-plane',
        state: updated.state,
        sequence: updated.sequence,
      },
    });
    this.publishState(updated, health.heartbeatAgeMs);
  }

  private recordHealthFailure(
    before: DeviceRecord,
    reason: 'invalid-or-unavailable-health' | 'stale-health-state' | 'adapter-reported-error',
  ): void {
    const stream = this.stopPreviewAfterFailure(before.id, before.stream);
    if (before.state === 'error') {
      if (before.stream === 'running' && stream === 'stopped') {
        const updated = this.repository.update(before.id, (record) => {
          record.stream = 'stopped';
          record.sequence += 1;
        });
        if (updated) this.publishState(updated);
      }
      return;
    }
    const updated = this.repository.update(before.id, (record) => {
      record.state = 'error';
      if (stream === 'stopped') record.stream = 'stopped';
      record.sequence += 1;
    });
    if (!updated) return;
    this.audit.append({
      type: 'adapter.failure',
      operatorId: 'local-system',
      deviceId: before.id,
      result: 'rejected',
      metadata: {
        source: 'control-plane',
        reason,
        command: 'device.health',
        state: updated.state,
        stream: updated.stream,
        sequence: updated.sequence,
      },
    });
    this.publishState(updated);
  }

  private heartbeatAge(device: DeviceRecord): number {
    const lastSeenEpochMs = Date.parse(device.lastSeenAt);
    if (!Number.isFinite(lastSeenEpochMs)) return MAX_HEARTBEAT_AGE_MS;
    return Math.min(
      MAX_HEARTBEAT_AGE_MS,
      Math.max(0, Math.round(this.clock.nowEpochMs() - lastSeenEpochMs)),
    );
  }

  private reserveConfirmation(
    dto: DeviceCommandDto,
    expectedIntent: string,
    deviceId: string,
  ): { reservation: ConfirmationReservation; operatorId: string } {
    if (!dto?.confirmation_id || !dto.operator_id) throw new ConfirmationRequiredError();
    if (dto.intent !== expectedIntent) throw new PolicyDeniedError('confirmation intent does not match the requested operation');
    this.policy.assertIntentAllowed(dto.intent);
    return {
      reservation: this.confirmations.reserve({
        confirmationId: dto.confirmation_id,
        operatorId: dto.operator_id,
        intent: expectedIntent,
        deviceId,
        expectedSequence: dto.expected_sequence,
        currentDeviceSequence: this.requireDevice(deviceId).sequence,
      }),
      operatorId: dto.operator_id,
    };
  }

  private invokeAdapter<T>(
    deviceId: string,
    operatorId: string,
    command: string,
    operation: () => T,
  ): T {
    try {
      return operation();
    } catch {
      this.recordAdapterFailure(
        deviceId,
        operatorId,
        command,
        'adapter-unavailable',
        command !== 'preview.stop',
      );
      throw new ApiError(
        'adapter.unavailable',
        'device adapter could not complete the requested operation',
        503,
        true,
      );
    }
  }

  private recordAdapterFailure(
    deviceId: string,
    operatorId: string,
    command: string,
    reason = 'adapter-unavailable',
    attemptPreviewStop = true,
  ): DeviceRecord | undefined {
    const before = this.repository.get(deviceId);
    const stream = before && attemptPreviewStop
      ? this.stopPreviewAfterFailure(deviceId, before.stream)
      : before?.stream;
    const updated = this.repository.update(deviceId, (record) => {
      record.state = 'error';
      if (stream === 'stopped') record.stream = 'stopped';
      record.sequence += 1;
      record.lastSeenAt = this.clock.nowIso();
    });
    this.audit.append({
      type: 'adapter.failure',
      operatorId,
      deviceId,
      result: 'rejected',
      metadata: {
        source: 'control-plane',
        reason,
        command,
        ...(updated ? { state: updated.state, stream: updated.stream, sequence: updated.sequence } : {}),
        operator_confirmed: true,
      },
    });
    if (updated) this.publishState(updated);
    return updated;
  }

  private stopPreviewAfterFailure(
    deviceId: string,
    currentStream: DeviceRecord['stream'],
  ): DeviceRecord['stream'] | undefined {
    if (currentStream === 'stopped') return 'stopped';
    try {
      return this.requireAdapterStream(
        this.adapter.stopReadonlyPreview(deviceId, randomUUID()),
        'stopped',
      );
    } catch {
      return currentStream;
    }
  }

  private attemptDeviceStop(deviceId: string): DeviceStopAttempt {
    const attempt: DeviceStopAttempt = { failedComponents: [] };
    try {
      attempt.state = this.requireAdapterState(
        this.adapter.stop(deviceId, randomUUID()),
        new Set<DeviceRecord['state']>(['offline']),
      );
    } catch {
      attempt.failedComponents.push('lifecycle-stop');
    }
    try {
      attempt.stream = this.requireAdapterStream(
        this.adapter.stopReadonlyPreview(deviceId, randomUUID()),
        'stopped',
      );
    } catch {
      attempt.failedComponents.push('preview-stop');
    }
    return attempt;
  }

  private applyDeviceStopAttempt(
    deviceId: string,
    operatorId: string,
    command: 'device.stop' | 'safety.stop-all',
    attempt: DeviceStopAttempt,
  ): DeviceRecord | undefined {
    const failed = attempt.failedComponents.length > 0;
    const updated = this.repository.update(deviceId, (record) => {
      record.state = failed ? 'error' : attempt.state ?? record.state;
      if (attempt.stream !== undefined) record.stream = attempt.stream;
      record.sequence += 1;
      record.lastSeenAt = this.clock.nowIso();
    });
    if (!failed) return updated;
    this.audit.append({
      type: 'adapter.failure',
      operatorId,
      deviceId,
      result: 'rejected',
      metadata: {
        source: 'control-plane',
        reason: attempt.failedComponents.join(','),
        command,
        ...(updated ? { state: updated.state, stream: updated.stream, sequence: updated.sequence } : {}),
        operator_confirmed: true,
      },
    });
    if (updated) this.publishState(updated);
    return updated;
  }

  private requireAdapterState(
    state: DeviceRecord['state'],
    allowedStates: ReadonlySet<DeviceRecord['state']>,
  ): DeviceRecord['state'] {
    if (!DEVICE_STATES.has(state) || !allowedStates.has(state)) {
      throw new Error('device adapter returned an invalid lifecycle state');
    }
    return state;
  }

  private requireAllowedCommandState(
    state: DeviceRecord['state'],
    before: DeviceRecord['state'],
  ): DeviceRecord['state'] {
    const next = this.requireAdapterState(state, ACTIVE_LIFECYCLE_STATES);
    if (!isAllowedCommandTransition(before, next)) {
      throw new Error('device adapter returned an invalid lifecycle transition');
    }
    return next;
  }

  private requireAdapterStream(
    stream: DeviceRecord['stream'],
    expectedStream: DeviceRecord['stream'],
  ): DeviceRecord['stream'] {
    if (stream !== expectedStream) {
      throw new Error('device adapter returned an unexpected preview state');
    }
    return stream;
  }
}

function isMonotonicHealthTransition(
  before: DeviceRecord['state'],
  next: DeviceRecord['state'],
): boolean {
  if (next === 'error') return true;
  if (before === 'error') return false;
  return LIFECYCLE_RANK[next] >= LIFECYCLE_RANK[before];
}

function isAllowedCommandTransition(
  before: DeviceRecord['state'],
  next: DeviceRecord['state'],
): boolean {
  if (!ACTIVE_LIFECYCLE_STATES.has(next)) return false;
  // Explicit reconnect may recover an offline/error adapter, but it must not
  // let a stale adapter response move an already active device backwards.
  if (!ACTIVE_LIFECYCLE_STATES.has(before)) return true;
  return LIFECYCLE_RANK[next] >= LIFECYCLE_RANK[before];
}
