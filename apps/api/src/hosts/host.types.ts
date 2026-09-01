export type HostCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'not_checked';

export interface HostCheck {
  readonly status: HostCheckStatus;
  readonly observed?: string | number | boolean;
  readonly required?: string | number | boolean;
  readonly remediation?: string;
  readonly source: string;
}

export interface HostResourceSnapshot {
  readonly cpuThreads: number;
  readonly memoryMib: number;
  readonly availableMemoryMib: number;
  readonly diskFreeGib: number | null;
  readonly vramMib: number | null;
}

export interface HostProbeReport {
  readonly schema: 'host-probe.v1';
  readonly collectedAt: string;
  readonly platform: {
    readonly os: NodeJS.Platform;
    readonly arch: string;
  };
  readonly resources: HostResourceSnapshot;
  readonly checks: {
    readonly cpu: HostCheck;
    readonly memory: HostCheck;
    readonly disk: HostCheck;
    readonly virtualization: HostCheck;
    readonly gpu: HostCheck;
    readonly adb: HostCheck;
    readonly emulator: HostCheck;
    readonly scrcpy: HostCheck;
  };
  readonly sideEffects: 'none';
}

export type ProviderKind = 'mock' | 'avd' | 'physical_usb' | 'remote_stream';

export interface ProviderCapabilities {
  readonly lifecycle: true;
  readonly healthRead: true;
  readonly screenPreview: true;
  readonly userInput: false;
  readonly automation: false;
}

export interface ProviderManifest {
  readonly schemaVersion: 'provider-manifest.v1';
  readonly providerId: string;
  readonly kind: ProviderKind;
  readonly planningOnly: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly requirements: {
    readonly minCpuThreads: number;
    readonly minMemoryMib: number;
    readonly minDiskGib: number;
  };
  readonly instanceProfile: {
    readonly cpuThreads: number;
    readonly memoryMib: number;
    readonly diskGib: number;
    readonly vramMib: number;
    readonly streamMbps: number;
  };
  readonly maxInstances: number;
  readonly notes: readonly string[];
}

export interface ProviderCapacity {
  readonly providerId: string;
  readonly safeInstances: number;
  readonly controlPlaneLimit: number;
  readonly effectiveInstances: number;
  readonly startupConcurrency: number;
  readonly limitingResources: readonly string[];
  readonly unknownResources: readonly string[];
  readonly confidence: 'measured' | 'estimated' | 'unknown';
}
