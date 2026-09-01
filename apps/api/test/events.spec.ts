import { EventBusService } from '../src/common/events/event-bus.service';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';
import { ClockService } from '../src/common/time/clock.service';

describe('EventBusService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('publishes CloudEvents envelopes and replays by global sequence', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const first = bus.publish('device.health.changed', { device_id: 'synthetic-device', state: 'ready' }, 'device/synthetic-device');
    const second = bus.publish('reminder.fired', { schedule_id: 'synthetic-schedule' }, 'schedule/synthetic-schedule');

    expect(first.specversion).toBe('1.0');
    expect(first.data.sequence).toBe(1);
    expect(first.schema).toContain('device-health-changed.v1.json');
    expect(second.data.sequence).toBe(2);
    expect(bus.replaySince(1)).toEqual([second]);
    expect(bus.replayWindow(1).events).toEqual([second]);
  });

  it('requires a snapshot when retained history cannot satisfy the cursor', () => {
    process.env.EVENT_HISTORY_SIZE = '10';
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    for (let index = 0; index < 11; index += 1) {
      bus.publish('device.health.changed', {
        device_id: `synthetic-device-${index}`,
        state: 'ready',
      });
    }

    const replay = bus.replayWindow(0);
    expect(replay.sync).toEqual(
      expect.objectContaining({
        protocol: 'event-stream.sync.v1',
        current_sequence: 11,
        oldest_available_sequence: 2,
        reset_required: true,
      }),
    );
    expect(replay.events).toEqual([]);
  });

  it('requires a snapshot when the client reconnects to a new stream instance', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    bus.publish('device.health.changed', { device_id: 'synthetic-device', state: 'ready' });
    const current = bus.replayWindow(0);

    const replay = bus.replayWindow(1, `${current.sync.stream_id}-stale`);
    expect(replay.sync.reset_required).toBe(true);
    expect(replay.events).toEqual([]);
  });

  it('isolates a failing subscriber and reports the delivery error', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const delivered: number[] = [];
    bus.subscribe(() => {
      throw new Error('synthetic subscriber failure');
    });
    bus.subscribe((event) => delivered.push(event.data.sequence));

    expect(() => bus.publish('device.health.changed', { device_id: 'synthetic-device' }))
      .not.toThrow();
    expect(delivered).toEqual([1]);
    expect(bus.getStats()).toEqual(expect.objectContaining({
      currentSequence: 1,
      retainedEvents: 1,
      subscribers: 2,
      deliveryErrors: 1,
    }));
  });

  it('delivers reentrant publications to every subscriber in global sequence order', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    const observed: number[] = [];
    bus.subscribe((event) => {
      if (event.data.sequence === 1) bus.publish('synthetic.event', { marker: 2 });
    });
    bus.subscribe((event) => observed.push(event.data.sequence));

    bus.publish('synthetic.event', { marker: 1 });

    expect(observed).toEqual([1, 2]);
  });

  it('registers a listener before taking its replay boundary', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    bus.publish('synthetic.event', { marker: 1 });
    const live: number[] = [];

    const subscription = bus.subscribeWithReplay(0, undefined, (event) => {
      live.push(event.data.sequence);
    });
    bus.publish('synthetic.event', { marker: 2 });

    expect(subscription.replay.sync.current_sequence).toBe(1);
    expect(subscription.replay.events.map((event) => event.data.sequence)).toEqual([1]);
    expect(live).toEqual([2]);
    subscription.unsubscribe();
  });

  it('serializes replay within a byte budget and resets without retaining partial frames', () => {
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    bus.publish('synthetic.event', { marker: 'x'.repeat(700) });
    bus.publish('synthetic.event', { marker: 'y'.repeat(700) });

    const subscription = bus.subscribeWithSerializedReplay(0, undefined, 1024, () => undefined);
    const sync = JSON.parse(subscription.syncFrame) as { reset_required: boolean };

    expect(sync.reset_required).toBe(true);
    expect(subscription.resetForByteBudget).toBe(true);
    expect(subscription.replayFrames).toEqual([]);
    expect(subscription.replayBytes).toBe(0);
    subscription.unsubscribe();
    expect(bus.getStats().subscribers).toBe(0);
  });

  it('requires a snapshot when a valid cursor exceeds the per-client replay budget', () => {
    process.env.EVENT_REPLAY_MAX_EVENTS = '2';
    const config = loadRuntimeConfig();
    const bus = new EventBusService(config, new ClockService(config));
    for (let index = 0; index < 3; index += 1) {
      bus.publish('device.health.changed', { device_id: `synthetic-device-${index}` });
    }

    expect(bus.replayWindow(0)).toEqual(expect.objectContaining({
      sync: expect.objectContaining({ reset_required: true, current_sequence: 3 }),
      events: [],
    }));
  });
});
