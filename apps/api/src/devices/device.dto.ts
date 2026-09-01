import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @Length(1, 128)
  alias!: string;

  @IsString()
  @IsIn(['mock-adapter'])
  provider!: string;

  @IsString()
  @IsIn(['memory'])
  transport!: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Length(1, 64)
  @Matches(/^[^\\/\0\r\n]+$/)
  group?: string;
}

export class OperatorConfirmationDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  operator_id?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsUUID()
  confirmation_id?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Length(1, 64)
  intent?: string;
}

export class DeviceCommandDto extends OperatorConfirmationDto {
  @IsInt()
  @Min(1)
  expected_sequence!: number;
}

export class DeviceFilterDto {
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsIn(['offline', 'discovering', 'booting', 'ready', 'waiting', 'error'])
  state?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Length(1, 64)
  group?: string;
}

export class PreviewCommandDto extends DeviceCommandDto {}
