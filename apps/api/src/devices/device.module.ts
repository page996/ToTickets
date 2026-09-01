import { Module } from '@nestjs/common';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { DeviceAdapter, MockDeviceAdapter } from './device-adapter';

@Module({
  controllers: [DeviceController],
  providers: [DeviceService, { provide: DeviceAdapter, useClass: MockDeviceAdapter }],
  exports: [DeviceService],
})
export class DeviceModule {}
