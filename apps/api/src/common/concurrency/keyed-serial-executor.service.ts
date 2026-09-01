import { Inject, Injectable } from '@nestjs/common';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { ApiError } from '../errors/api-error';

export interface KeyedSerialExecutorStats {
  active: number;
  queued: number;
  capacity: number;
  rejected: number;
  activeKeys: number;
}

interface QueuedOperation<T> {
  operation: () => Promise<T> | T;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface KeyState {
  running: boolean;
  queued: QueuedOperation<unknown>[];
}

@Injectable()
export class KeyedSerialExecutor {
  private readonly states = new Map<string, KeyState>();
  private active = 0;
  private queued = 0;
  private rejected = 0;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  run<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
    const state = this.states.get(key) ?? this.createState(key);
    if (!state.running) return this.start(key, state, operation);
    if (this.queued >= this.config.limits.operationQueueMaxQueued) {
      this.rejected += 1;
      return Promise.reject(queueCapacityError());
    }
    this.queued += 1;
    return new Promise<T>((resolve, reject) => {
      state.queued.push({ operation, resolve, reject } as QueuedOperation<unknown>);
    });
  }

  getStats(): KeyedSerialExecutorStats {
    return {
      active: this.active,
      queued: this.queued,
      capacity: this.config.limits.operationQueueMaxQueued,
      rejected: this.rejected,
      activeKeys: this.states.size,
    };
  }

  private createState(key: string): KeyState {
    const state: KeyState = { running: false, queued: [] };
    this.states.set(key, state);
    return state;
  }

  private start<T>(key: string, state: KeyState, operation: () => Promise<T> | T): Promise<T> {
    state.running = true;
    this.active += 1;
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        state.running = false;
        this.active -= 1;
        const next = state.queued.shift();
        if (!next) {
          this.states.delete(key);
          return;
        }
        this.queued -= 1;
        void this.start(key, state, next.operation).then(next.resolve, next.reject);
      });
  }
}

function queueCapacityError(): ApiError {
  return new ApiError('device.busy', 'operation queue capacity has been reached', 503, true);
}
