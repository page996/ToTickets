import { Inject, Injectable } from '@nestjs/common';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { ApiError } from '../errors/api-error';

export interface GlobalOperationCoordinatorStats {
  active: number;
  queued: number;
  capacity: number;
  rejected: number;
  activeSharedOperations: number;
  activeExclusiveOperations: number;
}

type OperationKind = 'shared' | 'exclusive';

interface QueuedOperation<T> {
  kind: OperationKind;
  operation: () => Promise<T> | T;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

@Injectable()
export class GlobalOperationCoordinator {
  private readonly queue: QueuedOperation<unknown>[] = [];
  private activeSharedOperations = 0;
  private activeExclusiveOperations = 0;
  private rejected = 0;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  runShared<T>(operation: () => Promise<T> | T): Promise<T> {
    return this.enqueue('shared', operation);
  }

  runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    return this.enqueue('exclusive', operation);
  }

  getStats(): GlobalOperationCoordinatorStats {
    return {
      active: this.activeSharedOperations + this.activeExclusiveOperations,
      queued: this.queue.length,
      capacity: this.config.limits.operationQueueMaxQueued,
      rejected: this.rejected,
      activeSharedOperations: this.activeSharedOperations,
      activeExclusiveOperations: this.activeExclusiveOperations,
    };
  }

  private enqueue<T>(kind: OperationKind, operation: () => Promise<T> | T): Promise<T> {
    if (this.queue.length >= this.config.limits.operationQueueMaxQueued) {
      this.rejected += 1;
      return Promise.reject(queueCapacityError());
    }
    const result = new Promise<T>((resolve, reject) => {
      this.queue.push({ kind, operation, resolve, reject } as QueuedOperation<unknown>);
    });
    this.drain();
    return result;
  }

  private drain(): void {
    if (this.activeExclusiveOperations > 0) return;
    while (this.queue[0]?.kind === 'shared') this.start(this.queue.shift()!);
    if (this.activeSharedOperations === 0 && this.queue[0]?.kind === 'exclusive') {
      this.start(this.queue.shift()!);
    }
  }

  private start(entry: QueuedOperation<unknown>): void {
    if (entry.kind === 'shared') this.activeSharedOperations += 1;
    else this.activeExclusiveOperations += 1;
    void Promise.resolve()
      .then(entry.operation)
      .then(
        (value) => {
          this.finish(entry.kind);
          entry.resolve(value);
        },
        (error: unknown) => {
          this.finish(entry.kind);
          entry.reject(error);
        },
      );
  }

  private finish(kind: OperationKind): void {
        if (kind === 'shared') this.activeSharedOperations -= 1;
        else this.activeExclusiveOperations -= 1;
        this.drain();
  }
}

function queueCapacityError(): ApiError {
  return new ApiError('device.busy', 'operation queue capacity has been reached', 503, true);
}
