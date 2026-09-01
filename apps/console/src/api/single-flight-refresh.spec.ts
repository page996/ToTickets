import { describe, expect, it, vi } from 'vitest';
import { SingleFlightRefresh } from './single-flight-refresh';

describe('SingleFlightRefresh', () => {
  it('coalesces a burst into one active and one trailing operation', async () => {
    const releases: Array<() => void> = [];
    let concurrent = 0;
    let maximumConcurrent = 0;
    let invocation = 0;
    let markSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const operation = vi.fn(async () => {
      invocation += 1;
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      if (invocation === 2) markSecondStarted?.();
      await new Promise<void>((resolve) => releases.push(resolve));
      concurrent -= 1;
    });
    const coordinator = new SingleFlightRefresh(operation);

    const first = coordinator.request();
    const duplicateOne = coordinator.request();
    const duplicateTwo = coordinator.request();
    expect(operation).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await secondStarted;
    expect(operation).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await Promise.all([first, duplicateOne, duplicateTwo]);

    expect(maximumConcurrent).toBe(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not run a queued refresh after disposal', async () => {
    let release: (() => void) | undefined;
    const operation = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const coordinator = new SingleFlightRefresh(operation);

    const active = coordinator.request();
    void coordinator.request();
    coordinator.dispose();
    release?.();
    await active;

    expect(operation).toHaveBeenCalledTimes(1);
    await coordinator.request();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
