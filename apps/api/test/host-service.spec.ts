import { calculateProviderCapacity } from '../src/hosts/host.service';
import { providerManifest } from '../src/hosts/provider-manifests';
import { HostResourceSnapshot } from '../src/hosts/host.types';

describe('host capacity planning', () => {
  const resources: HostResourceSnapshot = {
    cpuThreads: 32,
    memoryMib: 32768,
    availableMemoryMib: 16000,
    diskFreeGib: 80,
    vramMib: 16384,
  };

  it('keeps resource reserves and reports the tightest known limit', () => {
    const manifest = providerManifest('android-emulator-avd')!;
    expect(calculateProviderCapacity(resources, manifest, 8)).toEqual(expect.objectContaining({
      providerId: 'android-emulator-avd',
      safeInstances: 2,
      controlPlaneLimit: 8,
      effectiveInstances: 2,
      startupConcurrency: 2,
      limitingResources: ['memory_mib'],
      confidence: 'estimated',
    }));
  });

  it('does not turn an unknown GPU probe into a zero capacity', () => {
    const manifest = providerManifest('android-emulator-avd')!;
    const result = calculateProviderCapacity({ ...resources, vramMib: null }, manifest, 8);
    expect(result.safeInstances).toBe(2);
    expect(result.unknownResources).toContain('vram_mib');
    expect(result.confidence).toBe('unknown');
  });

  it('limits startup bursts to two instances', () => {
    const manifest = providerManifest('mock-adapter')!;
    const result = calculateProviderCapacity(resources, manifest, 8);
    expect(result.safeInstances).toBe(30);
    expect(result.effectiveInstances).toBe(8);
    expect(result.startupConcurrency).toBe(2);
  });

  it('marks every provider as non-input capable', () => {
    for (const id of ['mock-adapter', 'android-emulator-avd', 'android-physical-usb', 'android-remote-stream']) {
      const manifest = providerManifest(id)!;
      expect(manifest.capabilities.userInput).toBe(false);
      expect(manifest.capabilities.automation).toBe(false);
    }
  });
});
