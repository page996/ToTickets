import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsISO8601,
  IsInt,
  IsString,
  IsUrl,
  Length,
  Max,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReminderDto {
  @IsInt()
  @Min(-604800)
  @Max(0)
  offset_seconds!: number;

  @IsIn(['desktop', 'sound'])
  channel!: 'desktop' | 'sound';
}

export class CreateScheduleDto {
  @IsString()
  @Length(1, 128)
  label!: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  public_reference?: string;

  @IsISO8601()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  starts_at!: string;

  @IsString()
  @Length(1, 64)
  timezone!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => ReminderDto)
  reminders!: ReminderDto[];
}

export class UpdateScheduleDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Length(1, 128)
  label?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn(['cancelled'])
  state?: 'cancelled';

  @ValidateIf((_dto, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => ReminderDto)
  reminders?: ReminderDto[];
}

export class AcknowledgeScheduleDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  operator_id!: string;
}
