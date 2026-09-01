import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { operatorIdFromHeader } from '../common/http/operator-id';
import { ConfirmationService } from '../common/confirmation/confirmation.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DeviceService } from '../devices/device.service';
import { IssueConfirmationDto, StopAllDto } from './safety.dto';

@Controller('safety')
export class SafetyController {
  constructor(
    private readonly devices: DeviceService,
    private readonly idempotency: IdempotencyService,
    private readonly confirmations: ConfirmationService,
  ) {}

  @Post('confirmations')
  issueConfirmation(@Body() dto: IssueConfirmationDto, @Headers('idempotency-key') key: string, @Req() request: Request) {
    return this.idempotency.execute(key, 'safety.confirmations.issue', dto, () => {
      const currentDeviceSequence = dto.intent !== 'safety.stop-all' && dto.device_id
        ? this.devices.get(dto.device_id).sequence
        : undefined;
      return this.confirmations.issue({
        operatorId: dto.operator_id,
        intent: dto.intent,
        ...(dto.device_id ? { deviceId: dto.device_id } : {}),
        ...(dto.expected_sequence !== undefined
          ? { expectedSequence: dto.expected_sequence }
          : {}),
        ...(currentDeviceSequence !== undefined ? { currentDeviceSequence } : {}),
        confirmed: dto.confirmed,
      });
    }, operatorIdFromHeader(request));
  }

  @Post('stop-all')
  stopAll(@Body() dto: StopAllDto, @Headers('idempotency-key') key: string, @Req() request: Request) {
    return this.idempotency.execute(key, 'safety.stop-all', dto, async () => {
      const reservation = this.confirmations.reserve({
        confirmationId: dto.confirmation_id,
        operatorId: dto.operator_id,
        intent: 'safety.stop-all',
      });
      try {
        const result = await this.devices.stopAll(dto.operator_id);
        reservation.commit();
        return result;
      } catch (error) {
        reservation.release();
        throw error;
      }
    }, operatorIdFromHeader(request));
  }
}
