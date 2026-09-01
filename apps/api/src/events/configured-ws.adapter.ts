import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { RuntimeConfig } from '../config/runtime-config';

export class ConfiguredWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: RuntimeConfig,
  ) {
    super(app);
  }

  override create(
    port: number,
    options: Record<string, unknown> & {
      namespace?: string;
      server?: unknown;
      path?: string;
    } = {},
  ): unknown {
    return super.create(port, {
      ...options,
      maxPayload: this.config.limits.websocketMaxPayloadBytes,
    });
  }
}
