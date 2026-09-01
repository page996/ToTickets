import { Module } from '@nestjs/common';
import { HostModule } from '../hosts/host.module';
import { DeploymentController } from './deployment.controller';
import { DeploymentRepository } from './deployment.repository';
import { DeploymentService } from './deployment.service';

@Module({
  imports: [HostModule],
  controllers: [DeploymentController],
  providers: [DeploymentRepository, DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
