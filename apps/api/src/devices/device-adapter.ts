import { Injectable } from '@nestjs/common';
import { DeviceState, StreamState } from '../common/storage/device.repository';

export abstract class DeviceAdapter {
  abstract start(deviceId: string, requestId: string): DeviceState;
  abstract stop(deviceId: string, requestId: string): DeviceState;
  abstract reconnect(deviceId: string, requestId: string): DeviceState;
  abstract health(deviceId: string): { state: DeviceState; heartbeatAgeMs: number };
  abstract startReadonlyPreview(deviceId: string, requestId: string): StreamState;
  abstract stopReadonlyPreview(deviceId: string, requestId: string): StreamState;
}

@Injectable()
export class MockDeviceAdapter implements DeviceAdapter {
  private readonly states = new Map<string, DeviceState>();
  private readonly streams = new Map<string, StreamState>();

  start(deviceId: string, _requestId: string): DeviceState {
    this.states.set(deviceId, 'ready');
    return 'ready';
  }

  stop(deviceId: string, _requestId: string): DeviceState {
    this.states.set(deviceId, 'offline');
    this.streams.set(deviceId, 'stopped');
    return 'offline';
  }

  reconnect(deviceId: string, _requestId: string): DeviceState {
    this.states.set(deviceId, 'ready');
    return 'ready';
  }

  health(deviceId: string): { state: DeviceState; heartbeatAgeMs: number } {
    return { state: this.states.get(deviceId) ?? 'offline', heartbeatAgeMs: 0 };
  }

  startReadonlyPreview(deviceId: string, _requestId: string): StreamState {
    this.streams.set(deviceId, 'running');
    return 'running';
  }

  stopReadonlyPreview(deviceId: string, _requestId: string): StreamState {
    this.streams.set(deviceId, 'stopped');
    return 'stopped';
  }
}
