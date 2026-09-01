import { join } from 'node:path';
import { calculateProviderCapacity, collectResources, HostService } from '../src/hosts/host.service';
import { providerManifest } from '../src/hosts/provider-manifests';
import { HostResourceSnapshot } from '../src/hosts/host.types';
import { RuntimeConfig } from '../src/config/runtime-config';

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

  it('uses only configured storage and tool paths for host checks', () => {
    const missingDataDir = join(process.cwd(), '.runtime', 'missing-host-probe-target');
    const missingTool = join(process.cwd(), '.runtime', 'missing-tool');
    const service = new HostService(hostConfig({
      storage: { dataDir: missingDataDir },
      tools: {
        adb: process.execPath,
        scrcpy: missingTool,
        emulator: process.execPath,
      },
    }));

    const report = service.probe();

    expect(report.resources.diskFreeGib).toBeNull();
    expect(report.checks.adb).toEqual(expect.objectContaining({ status: 'pass', observed: 'present' }));
    expect(report.checks.scrcpy).toEqual(expect.objectContaining({ status: 'fail', observed: 'missing_or_not_a_file' }));
    expect(report.checks.emulator).toEqual(expect.objectContaining({ status: 'pass', observed: 'present' }));
    expect(JSON.stringify(report)).not.toContain(missingDataDir);
    expect(JSON.stringify(report)).not.toContain(missingTool);

    const capacities = service.providers().capacity;
    expect(capacities.every((capacity) => capacity.unknownResources.includes('disk_gib'))).toBe(true);
  });

  it('does not fall back to the process working directory when storage is omitted', () => {
    const service = new HostService(hostConfig());

    expect(collectResources().diskFreeGib).toBeNull();
    expect(service.probe().resources.diskFreeGib).toBeNull();
    expect(service.probe().checks.adb.status).toBe('not_checked');
    expect(service.probe().checks.emulator.status).toBe('not_checked');
    expect(service.probe().checks.scrcpy.status).toBe('not_checked');
  });
});

function hostConfig(overrides: {
  storage?: RuntimeConfig['storage'];
  tools?: RuntimeConfig['tools'];
} = {}): RuntimeConfig {
  return {
    schemaVersion: 'runtime-config.v3',
    api: { bindHost: '127.0.0.1', port: 12000, allowedOrigins: ['http://console.example.invalid'] },
    ...(overrides.storage ? { storage: overrides.storage } : {}),
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    limits: {
      maxDevices: 8,
      maxSchedules: 64,
      heartbeatSeconds: 30,
      auditRetentionDays: 7,
      clockToleranceMs: 250,
      websocketMaxClients: 64,
      websocketMaxBufferedBytes: 1_048_576,
      websocketMaxPayloadBytes: 65_536,
      eventReplayBatchSize: 32,
      eventReplayMaxEvents: 256,
      auditMaxRecords: 10_000,
      operationQueueMaxQueued: 100,
    },
    policy: {
      idempotencyTtlSeconds: 600,
      idempotencyMaxEntries: 100,
      confirmationTtlSeconds: 300,
      confirmationMaxEntries: 100,
      eventHistorySize: 1000,
    },
    policyVersion: 'test-policy.v1',
  };
}
