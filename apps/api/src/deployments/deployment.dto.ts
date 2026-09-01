import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import {
  DEPLOYMENT_DESIRED_STATES,
  DEPLOYMENT_OBSERVED_STATES,
  DeploymentDesiredState,
  DeploymentObservedState,
} from './deployment.types';

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Input accepted by the current mock-only plan endpoint.  The provider/mode
 * are fixed here as an additional boundary; live provider DTOs must be
 * versioned separately later. */
export class DeploymentPlanDto {
  @IsBoolean()
  @Equals(true)
  operator_confirmed!: true;

  @IsString()
  @Length(1, 64)
  @IsIn(['mock-adapter'])
  provider_id!: 'mock-adapter';

  @IsString()
  @IsIn(['mock_only'])
  execution_mode!: 'mock_only';

  @IsString()
  @IsIn([...DEPLOYMENT_DESIRED_STATES])
  desired_state!: DeploymentDesiredState;

  @IsInt()
  @Min(1)
  instances!: number;
}

export class DeploymentValidateDto {
  @IsBoolean()
  @Equals(true)
  operator_confirmed!: true;

  @IsInt()
  @Min(1)
  expected_generation!: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(OPERATION_ID_PATTERN)
  operation_id?: string;
}

export class DeploymentTransitionDto {
  @IsBoolean()
  @Equals(true)
  operator_confirmed!: true;

  @IsString()
  @IsIn([...DEPLOYMENT_OBSERVED_STATES])
  observed_state!: DeploymentObservedState;

  @IsInt()
  @Min(1)
  expected_generation!: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(OPERATION_ID_PATTERN)
  operation_id?: string;
}

export class DeploymentDesiredStateDto {
  @IsBoolean()
  @Equals(true)
  operator_confirmed!: true;

  @IsString()
  @IsIn([...DEPLOYMENT_DESIRED_STATES])
  desired_state!: DeploymentDesiredState;

  @IsInt()
  @Min(1)
  expected_generation!: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Matches(OPERATION_ID_PATTERN)
  operation_id?: string;
}
