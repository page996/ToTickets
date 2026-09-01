import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { operatorIdFromHeader } from '../common/http/operator-id';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { HostService } from '../hosts/host.service';
import {
  DeploymentDesiredStateDto,
  DeploymentPlanDto,
  DeploymentTransitionDto,
  DeploymentValidateDto,
} from './deployment.dto';
import { DeploymentService } from './deployment.service';

/**
 * Mock-only deployment control surface.
 *
 * The controller obtains capacity from the host planner and deliberately does
 * not accept executable paths, provider arguments, credentials, or device
 * input commands.  The service methods only mutate an in-memory state model.
 */
@Controller('deployments')
export class DeploymentController {
  constructor(
    private readonly deployments: DeploymentService,
    private readonly idempotency: IdempotencyService,
    private readonly hosts: HostService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  @Get()
  list() {
    return { items: this.deployments.list() };
  }

  @Post('plan')
  plan(
    @Body() dto: DeploymentPlanDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    const operatorId = operatorIdFromHeader(request);
    const capacity = this.hosts.providers().capacity.find(
      (candidate) => candidate.providerId === dto.provider_id,
    );
    if (!capacity) {
      throw new ApiError(
        'adapter.unavailable',
        'the selected provider has no host capacity profile',
        503,
        true,
      );
    }
    return this.idempotency.execute(
      key,
      'deployments.plan',
      dto,
      () => this.deployments.plan(dto, {
        operatorId,
        maximumRecords: this.config.limits.maxDevices,
        capacitySnapshot: {
          requestedInstances: dto.instances,
          safeInstances: capacity.safeInstances,
          effectiveInstances: capacity.effectiveInstances,
          startupConcurrency: capacity.startupConcurrency,
          confidence: capacity.confidence,
        },
      }),
      operatorId,
    );
  }

  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
  ) {
    return this.deployments.get(id);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  validate(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeploymentValidateDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    const operatorId = operatorIdFromHeader(request);
    return this.idempotency.execute(
      key,
      'deployments.validate',
      { id, ...dto },
      () => this.deployments.validate(id, dto, { operatorId }),
      operatorId,
    );
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  transition(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeploymentTransitionDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    const operatorId = operatorIdFromHeader(request);
    return this.idempotency.execute(
      key,
      'deployments.transition',
      { id, ...dto },
      () => this.deployments.transition(id, dto, { operatorId }),
      operatorId,
    );
  }

  @Post(':id/desired-state')
  @HttpCode(HttpStatus.OK)
  desiredState(
    @Param('id', new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 422 })) id: string,
    @Body() dto: DeploymentDesiredStateDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    const operatorId = operatorIdFromHeader(request);
    return this.idempotency.execute(
      key,
      'deployments.desired-state',
      { id, ...dto },
      () => this.deployments.setDesiredState(id, dto, { operatorId }),
      operatorId,
    );
  }
}
