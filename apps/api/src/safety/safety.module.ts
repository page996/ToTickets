import { Module } from '@nestjs/common';
import { DeviceModule } from '../devices/device.module';
import { SafetyController } from './safety.controller';

@Module({ imports: [DeviceModule], controllers: [SafetyController] })
export class SafetyModule {}
