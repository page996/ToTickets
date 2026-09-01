import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  ready() {
    return this.health.ready();
  }

  @Get('diagnostics')
  diagnostics() {
    return this.health.diagnostics();
  }
}
