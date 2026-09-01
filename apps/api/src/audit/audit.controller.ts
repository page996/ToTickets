import { Controller, Get, Query } from '@nestjs/common';
import { IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../common/audit/audit.service';
import { ClockService } from '../common/time/clock.service';

class AuditQueryDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ValidateIf((_dto, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page_size = 50;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  type?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  device_id?: string;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly clock: ClockService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list({
      page: query.page,
      pageSize: query.page_size,
      ...(query.type ? { type: query.type } : {}),
      ...(query.device_id ? { deviceId: query.device_id } : {}),
    });
  }

  @Get('export')
  export() {
    return { exported_at: this.clock.nowIso(), items: this.audit.export() };
  }
}
