import { Controller, Get } from '@nestjs/common';
import { HostService } from './host.service';

@Controller('hosts')
export class HostController {
  constructor(private readonly hosts: HostService) {}

  @Get('probe')
  probe() {
    return this.hosts.probe();
  }

  @Get('providers')
  providers() {
    return this.hosts.providers();
  }
}

