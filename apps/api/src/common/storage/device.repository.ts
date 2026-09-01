import { Injectable } from '@nestjs/common';

export type DeviceState = 'offline' | 'discovering' | 'booting' | 'ready' | 'waiting' | 'error';
export type StreamState = 'stopped' | 'running';

export interface DeviceCapabilities {
  lifecycle: true;
  health_read: true;
  screen_preview: true;
  user_input: false;
  automation: false;
}

export interface DeviceRecord {
  id: string;
  alias: string;
  provider: string;
  transport: string;
  group?: string;
  state: DeviceState;
  stream: StreamState;
  focused: boolean;
  capabilities: DeviceCapabilities;
  lastSeenAt: string;
  sequence: number;
}

@Injectable()
export class DeviceRepository {
  private readonly records = new Map<string, DeviceRecord>();
  private focusedDeviceId?: string;

  list(): DeviceRecord[] {
    return [...this.records.values()].map(cloneDeviceRecord);
  }

  get(id: string): DeviceRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneDeviceRecord(record) : undefined;
  }

  create(record: DeviceRecord, maximumDevices: number): DeviceRecord | undefined {
    if (this.records.size >= maximumDevices) return undefined;
    if (this.records.has(record.id)) throw new Error('device record already exists');
    const stored = cloneDeviceRecord(record);
    this.records.set(stored.id, stored);
    return cloneDeviceRecord(stored);
  }

  update(id: string, change: (record: DeviceRecord) => void): DeviceRecord | undefined {
    const current = this.records.get(id);
    if (!current) return undefined;
    const draft = cloneDeviceRecord(current);
    change(draft);
    if (draft.id !== id) throw new Error('device record id cannot change');
    const stored = cloneDeviceRecord(draft);
    this.records.set(id, stored);
    return cloneDeviceRecord(stored);
  }

  size(): number {
    return this.records.size;
  }

  setFocused(deviceId: string | undefined): DeviceRecord[] {
    if (deviceId !== undefined && !this.records.has(deviceId)) return [];
    this.focusedDeviceId = deviceId;
    const changed: DeviceRecord[] = [];
    for (const device of this.records.values()) {
      const focused = device.id === deviceId;
      if (device.focused === focused) continue;
      device.focused = focused;
      device.sequence += 1;
      changed.push(cloneDeviceRecord(device));
    }
    return changed;
  }

  getFocused(): string | undefined {
    return this.focusedDeviceId;
  }
}

function cloneDeviceRecord(record: DeviceRecord): DeviceRecord {
  return structuredClone(record);
}
