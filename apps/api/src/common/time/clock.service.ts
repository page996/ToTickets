import { Inject, Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';

@Injectable()
export class ClockService {
  private readonly wallAnchor = Date.now();
  private readonly monotonicAnchor = performance.now();

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  nowEpochMs(): number {
    return this.wallAnchor + (performance.now() - this.monotonicAnchor);
  }

  nowIso(): string {
    return new Date(this.nowEpochMs()).toISOString();
  }

  snapshot(): {
    server_time: string;
    monotonic_supported: true;
    offset_ms: number;
    confidence: 'local' | 'uncertain';
  } {
    const estimated = this.nowEpochMs();
    const drift = Date.now() - estimated;
    return {
      server_time: new Date(estimated).toISOString(),
      monotonic_supported: true,
      offset_ms: Math.round(drift),
      confidence: Math.abs(drift) <= this.config.limits.clockToleranceMs ? 'local' : 'uncertain',
    };
  }
}
