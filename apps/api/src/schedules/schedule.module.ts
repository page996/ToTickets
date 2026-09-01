import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ReminderService } from './reminder.service';

@Module({ controllers: [ScheduleController], providers: [ScheduleService, ReminderService] })
export class ScheduleModule {}
