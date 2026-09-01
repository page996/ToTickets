import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { AuditRepository } from '../common/storage/audit.repository';
import { ConfirmationService } from '../common/confirmation/confirmation.service';
import { GlobalOperationCoordinator } from '../common/concurrency/global-operation-coordinator.service';
import { KeyedSerialExecutor } from '../common/concurrency/keyed-serial-executor.service';
import { EventBusService } from '../common/events/event-bus.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DeviceRepository } from '../common/storage/device.repository';
import { ScheduleRepository } from '../common/storage/schedule.repository';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { EventsGateway } from '../events/events.gateway';

export type HealthStatus = 'ok' | 'degraded';

export interface CapacityMetric {
  used: number;
  max: number;
  available: number;
  utilization: number;
}

@Injectable()
export class HealthService {
  private readonly initializedAt = performance.now();

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly devices: DeviceRepository,
    private readonly schedules: ScheduleRepository,
    private readonly audits: AuditRepository,
    private readonly events: EventBusService,
    private readonly eventGateway: EventsGateway,
    private readonly idempotency: IdempotencyService,
    private readonly confirmations: ConfirmationService,
    private readonly executor: KeyedSerialExecutor,
    private readonly globalOperations: GlobalOperationCoordinator,
  ) {}

  live(): { schema: 'health.live.v1'; status: 'ok'; monotonic_uptime_ms: number } {
    return {
      schema: 'health.live.v1',
      status: 'ok',
      monotonic_uptime_ms: this.uptimeMs(),
    };
  }

  ready(): {
    schema: 'health.ready.v1';
    status: HealthStatus;
    checks: { config: 'ok'; repositories: 'ok'; event_bus: 'ok' };
  } {
    return {
      schema: 'health.ready.v1',
      status: this.diagnostics().status,
      checks: { config: 'ok', repositories: 'ok', event_bus: 'ok' },
    };
  }

  diagnostics() {
    const deviceRecords = this.devices.list();
    const eventStats = this.events.getStats();
    const gatewayStats = this.eventGateway.getStats();
    const idempotencyStats = this.idempotency.getStats();
    const confirmationStats = this.confirmations.getStats();
    const keyedOperationStats = this.executor.getStats();
    const globalOperationStats = this.globalOperations.getStats();
    const deviceCapacity = capacity(deviceRecords.length, this.config.limits.maxDevices);
    const scheduleCapacity = capacity(
      this.schedules.size(),
      this.config.limits.maxSchedules,
    );
    const auditStats = this.audits.getStats();
    const auditCapacity = capacity(auditStats.retained, this.config.limits.auditMaxRecords);
    const historyCapacity = capacity(
      eventStats.retainedEvents,
      eventStats.historyCapacity,
    );
    const clientCapacity = capacity(
      gatewayStats.connectedClients,
      gatewayStats.clientCapacity,
    );
    const idempotencyCapacity = capacity(
      idempotencyStats.entries,
      idempotencyStats.capacity,
    );
    const confirmationCapacity = capacity(
      confirmationStats.tickets,
      confirmationStats.capacity,
    );
    const keyedOperationCapacity = capacity(
      keyedOperationStats.queued,
      keyedOperationStats.capacity,
    );
    const globalOperationCapacity = capacity(
      globalOperationStats.queued,
      globalOperationStats.capacity,
    );
    const status: HealthStatus = [
      deviceCapacity,
      scheduleCapacity,
      auditCapacity,
      clientCapacity,
      idempotencyCapacity,
      confirmationCapacity,
      keyedOperationCapacity,
      globalOperationCapacity,
    ].some((metric) => metric.utilization >= 1)
      ? 'degraded'
      : 'ok';

    return {
      schema: 'health.diagnostics.v1' as const,
      status,
      monotonic_uptime_ms: this.uptimeMs(),
      resources: {
        devices: deviceCapacity,
        schedules: scheduleCapacity,
        audit: {
          ...auditCapacity,
          retention_days: this.config.limits.auditRetentionDays,
          capacity_evictions: auditStats.capacityEvictions,
        },
        event_history: historyCapacity,
        event_bus: {
          current_sequence: eventStats.currentSequence,
          subscribers: eventStats.subscribers,
          delivery_errors: eventStats.deliveryErrors,
        },
        websocket: {
          clients: clientCapacity,
          queued_events: gatewayStats.queuedEvents,
          queued_bytes: gatewayStats.queuedBytes,
          per_client_buffer_limit_bytes:
            this.config.limits.websocketMaxBufferedBytes,
          rejected_connections: gatewayStats.rejectedConnections,
          slow_client_closures: gatewayStats.slowClientClosures,
          send_failures: gatewayStats.sendFailures,
        },
        idempotency: {
          entries: idempotencyCapacity,
          in_flight: idempotencyStats.inFlight,
        },
        confirmations: { tickets: confirmationCapacity },
        operations: {
          keyed: { ...keyedOperationStats, queue: keyedOperationCapacity },
          global: { ...globalOperationStats, queue: globalOperationCapacity },
        },
        device_state: {
          focused: deviceRecords.filter((device) => device.focused).length,
          active_previews: deviceRecords.filter((device) => device.stream === 'running').length,
        },
      },
    };
  }

  private uptimeMs(): number {
    return Math.max(0, Math.floor(performance.now() - this.initializedAt));
  }
}

function capacity(used: number, max: number): CapacityMetric {
  const boundedUsed = Math.max(0, Math.min(used, max));
  return {
    used,
    max,
    available: Math.max(0, max - used),
    utilization: max === 0 ? 1 : Number((boundedUsed / max).toFixed(4)),
  };
}
