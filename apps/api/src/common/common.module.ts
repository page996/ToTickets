import { Global, Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/config.module';
import { AuditService } from './audit/audit.service';
import { EventBusService } from './events/event-bus.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { PolicyService } from './policy/policy.service';
import { DeviceRepository } from './storage/device.repository';
import { ScheduleRepository } from './storage/schedule.repository';
import { AuditRepository } from './storage/audit.repository';
import { ConfirmationService } from './confirmation/confirmation.service';
import { ClockService } from './time/clock.service';
import { KeyedSerialExecutor } from './concurrency/keyed-serial-executor.service';
import { GlobalOperationCoordinator } from './concurrency/global-operation-coordinator.service';

@Global()
@Module({
  imports: [RuntimeConfigModule],
  providers: [DeviceRepository, ScheduleRepository, AuditRepository, PolicyService, IdempotencyService, EventBusService, AuditService, ConfirmationService, ClockService, KeyedSerialExecutor, GlobalOperationCoordinator],
  exports: [DeviceRepository, ScheduleRepository, AuditRepository, PolicyService, IdempotencyService, EventBusService, AuditService, ConfirmationService, ClockService, KeyedSerialExecutor, GlobalOperationCoordinator],
})
export class CommonModule {}
