import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, loadRuntimeConfig } from './runtime-config';

@Global()
@Module({
  providers: [{ provide: RUNTIME_CONFIG, useFactory: loadRuntimeConfig }],
  exports: [RUNTIME_CONFIG],
})
export class RuntimeConfigModule {}
