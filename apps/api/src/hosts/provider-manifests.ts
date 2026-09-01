import { ProviderManifest } from './host.types';

const readonlyCapabilities = Object.freeze({
  lifecycle: true,
  healthRead: true,
  screenPreview: true,
  userInput: false,
  automation: false,
} as const);

// Profiles are planning estimates. They are not performance promises and must be
// replaced by a ramp-test record before a deployment is enabled.
export const PROVIDER_MANIFESTS: readonly ProviderManifest[] = Object.freeze([
  {
    schemaVersion: 'provider-manifest.v1',
    providerId: 'mock-adapter',
    kind: 'mock',
    planningOnly: false,
    capabilities: readonlyCapabilities,
    requirements: { minCpuThreads: 1, minMemoryMib: 256, minDiskGib: 1 },
    instanceProfile: { cpuThreads: 1, memoryMib: 256, diskGib: 1, vramMib: 0, streamMbps: 0 },
    maxInstances: 64,
    notes: ['Synthetic state only; no external device or platform access.'],
  },
  {
    schemaVersion: 'provider-manifest.v1',
    providerId: 'android-emulator-avd',
    kind: 'avd',
    planningOnly: true,
    capabilities: readonlyCapabilities,
    requirements: { minCpuThreads: 4, minMemoryMib: 4096, minDiskGib: 16 },
    instanceProfile: { cpuThreads: 4, memoryMib: 4096, diskGib: 16, vramMib: 1024, streamMbps: 6 },
    maxInstances: 64,
    notes: [
      'Official Android Emulator/AVD candidate; verify image, hypervisor and GPU on the target host.',
      'Only lifecycle and read-only observation are in scope; user input and automation remain disabled.',
    ],
  },
  {
    schemaVersion: 'provider-manifest.v1',
    providerId: 'android-physical-usb',
    kind: 'physical_usb',
    planningOnly: true,
    capabilities: readonlyCapabilities,
    requirements: { minCpuThreads: 1, minMemoryMib: 512, minDiskGib: 1 },
    instanceProfile: { cpuThreads: 1, memoryMib: 512, diskGib: 1, vramMib: 0, streamMbps: 8 },
    maxInstances: 64,
    notes: ['Requires a user-selected device and explicit USB authorization; no automatic input.'],
  },
  {
    schemaVersion: 'provider-manifest.v1',
    providerId: 'android-remote-stream',
    kind: 'remote_stream',
    planningOnly: true,
    capabilities: readonlyCapabilities,
    requirements: { minCpuThreads: 2, minMemoryMib: 1024, minDiskGib: 1 },
    instanceProfile: { cpuThreads: 2, memoryMib: 1024, diskGib: 1, vramMib: 0, streamMbps: 12 },
    maxInstances: 64,
    notes: [
      'Planning profile only; provider quotas, network latency, data handling and pricing require separate approval.',
      'Remote streaming does not establish compatibility or remove platform integrity/behavior checks.',
    ],
  },
]);

export function providerManifest(providerId: string): ProviderManifest | undefined {
  return PROVIDER_MANIFESTS.find((manifest) => manifest.providerId === providerId);
}
