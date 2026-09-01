import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { operatorIdFromHeader } from '../common/http/operator-id';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DeviceCommandDto, DeviceFilterDto, RegisterDeviceDto } from './device.dto';
import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Query() filter: DeviceFilterDto) {
    return { items: this.devices.list(filter) };
  }

  @Post()
  register(
    @Body() dto: RegisterDeviceDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.register', dto, () =>
      this.devices.register(dto, operatorIdFromHeader(request)),
      operatorIdFromHeader(request),
    );
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string) {
    return this.devices.get(id);
  }

  @Post(':id/commands/start')
  start(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.commands.start', { id, dto }, () =>
      this.devices.executeCommand(id, 'start', dto),
      operatorIdFromHeader(request),
    );
  }

  @Post(':id/commands/stop')
  stop(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.commands.stop', { id, dto }, () =>
      this.devices.executeCommand(id, 'stop', dto),
      operatorIdFromHeader(request),
    );
  }

  @Post(':id/commands/reconnect')
  reconnect(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.commands.reconnect', { id, dto }, () =>
      this.devices.executeCommand(id, 'reconnect', dto),
      operatorIdFromHeader(request),
    );
  }

  @Post(':id/preview/start')
  startPreview(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.preview.start', { id, dto }, () =>
      this.devices.startPreview(id, dto),
      operatorIdFromHeader(request),
    );
  }

  @Post(':id/preview/stop')
  stopPreview(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.preview.stop', { id, dto }, () =>
      this.devices.stopPreview(id, dto),
      operatorIdFromHeader(request),
    );
  }

  @Post(':id/focus')
  focus(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeviceCommandDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    return this.idempotency.execute(key, 'devices.focus', { id, dto }, () =>
      this.devices.focus(id, dto),
      operatorIdFromHeader(request),
    );
  }
}
