import { MockDeviceAdapter } from '../src/devices/device-adapter';

describe('MockDeviceAdapter', () => {
  it('exposes lifecycle, health and read-only preview only', () => {
    const adapter = new MockDeviceAdapter();
    const deviceId = 'synthetic-mock-device';

    expect(adapter.start(deviceId, 'synthetic-operation')).toBe('ready');
    expect(adapter.health(deviceId)).toEqual({ state: 'ready', heartbeatAgeMs: 0 });
    expect(adapter.startReadonlyPreview(deviceId, 'synthetic-operation')).toBe('running');
    expect(adapter.stopReadonlyPreview(deviceId, 'synthetic-operation')).toBe('stopped');
    expect(adapter.stop(deviceId, 'synthetic-operation')).toBe('offline');

    for (const prohibited of ['click', 'tap', 'input', 'purchase', 'captcha', 'pay']) {
      expect(prohibited in (adapter as unknown as Record<string, unknown>)).toBe(false);
    }
  });
});
