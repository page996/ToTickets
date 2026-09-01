import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { CommonModule } from './common/common.module';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { requestContextMiddleware } from './common/http/request-context';
import { ApiResponseInterceptor } from './common/http/api-response.interceptor';
import { PolicyGuard } from './common/policy/policy.guard';
import { RuntimeConfigModule } from './config/config.module';
import { DeviceModule } from './devices/device.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { SafetyModule } from './safety/safety.module';
import { ScheduleModule } from './schedules/schedule.module';

@Module({
  imports: [
    RuntimeConfigModule,
    CommonModule,
    DeviceModule,
    ScheduleModule,
    AuditModule,
    SafetyModule,
    EventsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('{*path}');
  }
}
