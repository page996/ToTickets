import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { operatorIdFromHeader } from '../common/http/operator-id';
import { AcknowledgeScheduleDto, CreateScheduleDto, UpdateScheduleDto } from './schedule.dto';
import { ScheduleService } from './schedule.service';

@Controller()
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService, private readonly idempotency: IdempotencyService) {}

  @Get('schedules')
  list() { return { items: this.schedules.list() }; }

  @Post('schedules')
  create(@Body() dto: CreateScheduleDto, @Headers('idempotency-key') key: string, @Req() request: Request) {
    return this.idempotency.execute(key, 'schedules.create', dto, () =>
      this.schedules.create(dto, operatorIdFromHeader(request)),
      operatorIdFromHeader(request),
    );
  }

  @Get('schedules/:id')
  get(@Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string) { return this.schedules.get(id); }

  @Patch('schedules/:id')
  update(@Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string, @Body() dto: UpdateScheduleDto, @Headers('idempotency-key') key: string, @Req() request: Request) {
    return this.idempotency.execute(key, 'schedules.update', { id, dto }, () =>
      this.schedules.update(id, dto, operatorIdFromHeader(request)),
      operatorIdFromHeader(request),
    );
  }

  @Post('schedules/:id/acknowledge')
  acknowledge(@Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string, @Body() dto: AcknowledgeScheduleDto, @Headers('idempotency-key') key: string, @Req() request: Request) {
    return this.idempotency.execute(key, 'schedules.acknowledge', { id, dto }, () =>
      this.schedules.acknowledge(id, dto.operator_id),
      operatorIdFromHeader(request),
    );
  }

  @Get('clock')
  clock() { return this.schedules.clock(); }
}
