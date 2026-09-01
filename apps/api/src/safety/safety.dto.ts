import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { SAFE_CONFIRMATION_INTENTS } from '../common/confirmation/confirmation.service';

export class IssueConfirmationDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  operator_id!: string;

  @IsIn(SAFE_CONFIRMATION_INTENTS)
  intent!: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsUUID()
  device_id?: string;

  @IsBoolean()
  confirmed!: boolean;

  @ValidateIf((dto: IssueConfirmationDto) => dto.intent !== 'safety.stop-all')
  @IsDefined()
  @IsInt()
  @Min(1)
  expected_sequence?: number;
}

export class StopAllDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  operator_id!: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsUUID()
  confirmation_id?: string;

  @IsString()
  @IsIn(['safety.stop-all'])
  intent!: 'safety.stop-all';
}
