import { Inject, Injectable } from '@nestjs/common';
import { statSync, statfsSync } from 'node:fs';
import * as os from 'node:os';
import { providerManifest, PROVIDER_MANIFESTS } from './provider-manifests';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import {
  HostCheck,
  HostProbeReport,
  HostResourceSnapshot,
  ProviderCapacity,
  ProviderManifest,
} from './host.types';

const MEMORY_RESERVE_MIB = 4096;
const CPU_RESERVE_THREADS = 2;
const DISK_RESERVE_GIB = 20;
const STARTUP_CONCURRENCY_MAX = 2;

@Injectable()
export class HostService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  probe(): HostProbeReport {
    const resources = collectResources(this.config.storage?.dataDir);
    return {
      schema: 'host-probe.v1',
      collectedAt: new Date().toISOString(),
      platform: { os: process.platform, arch: process.arch },
      resources,
      checks: {
        cpu: resourceCheck(resources.cpuThreads, 2, 'threads'),
        memory: resourceCheck(resources.availableMemoryMib, MEMORY_RESERVE_MIB, 'MiB'),
        disk: resources.diskFreeGib === null
          ? unknownCheck('disk capacity is unavailable without a platform-specific probe')
          : resourceCheck(resources.diskFreeGib, DISK_RESERVE_GIB, 'GiB'),
        virtualization: unknownCheck('use the host provider probe to verify WHPX/Hyper-V, KVM or HVF'),
        gpu: resources.vramMib === null
          ? unknownCheck('GPU/VRAM is not queried by the side-effect-free Node probe')
          : resourceCheck(resources.vramMib, 512, 'MiB'),
        adb: toolCheck(this.config.tools?.adb, 'tools.adb'),
        emulator: toolCheck(this.config.tools?.emulator, 'tools.emulator'),
        scrcpy: toolCheck(this.config.tools?.scrcpy, 'tools.scrcpy'),
      },
      sideEffects: 'none',
    };
  }

  providers(): {
    manifests: readonly ProviderManifest[];
    capacity: readonly ProviderCapacity[];
    planning: 'estimated_until_ramp_test';
  } {
    const resources = collectResources(this.config.storage?.dataDir);
    return {
      manifests: PROVIDER_MANIFESTS,
      capacity: PROVIDER_MANIFESTS.map((manifest) => calculateProviderCapacity(
        resources,
        manifest,
        this.config.limits.maxDevices,
      )),
      planning: 'estimated_until_ramp_test',
    };
  }
}

export function collectResources(storageDataDir?: string): HostResourceSnapshot {
  let diskFreeGib: number | null = null;
  if (storageDataDir) {
    try {
      const stats = statfsSync(storageDataDir);
      diskFreeGib = round(stats.bavail * stats.bsize / (1024 ** 3));
    } catch {
      // Disk probes are platform-dependent; unknown is safer than a guessed path.
    }
  }
  return {
    cpuThreads: Math.max(1, os.cpus().length),
    memoryMib: round(os.totalmem() / (1024 ** 2)),
    availableMemoryMib: round(os.freemem() / (1024 ** 2)),
    diskFreeGib,
    vramMib: null,
  };
}

export function calculateProviderCapacity(
  resources: HostResourceSnapshot,
  manifest: ProviderManifest,
  controlPlaneLimit = Number.MAX_SAFE_INTEGER,
): ProviderCapacity {
  const limits: Array<{ name: string; value: number | null }> = [
    {
      name: 'cpu_threads',
      value: Math.floor(Math.max(0, resources.cpuThreads - CPU_RESERVE_THREADS) / manifest.instanceProfile.cpuThreads),
    },
    {
      name: 'memory_mib',
      value: Math.floor(Math.max(0, resources.availableMemoryMib - MEMORY_RESERVE_MIB) / manifest.instanceProfile.memoryMib),
    },
    {
      name: 'disk_gib',
      value: resources.diskFreeGib === null
        ? null
        : Math.floor(Math.max(0, resources.diskFreeGib - DISK_RESERVE_GIB) / manifest.instanceProfile.diskGib),
    },
    {
      name: 'vram_mib',
      value: manifest.instanceProfile.vramMib === 0
        ? manifest.maxInstances
        : resources.vramMib === null
          ? null
        : Math.floor(resources.vramMib / manifest.instanceProfile.vramMib),
    },
  ];
  const known = limits.filter((limit): limit is { name: string; value: number } => limit.value !== null);
  const safeInstances = Math.max(0, Math.min(manifest.maxInstances, ...known.map((limit) => limit.value)));
  const boundedControlPlaneLimit = Math.max(0, Math.floor(controlPlaneLimit));
  const effectiveInstances = Math.min(safeInstances, boundedControlPlaneLimit);
  const limitingResources = known
    .filter((limit) => limit.value === safeInstances)
    .map((limit) => limit.name);
  if (boundedControlPlaneLimit < safeInstances) limitingResources.push('control_plane_max_devices');
  const unknownResources = limits.filter((limit) => limit.value === null).map((limit) => limit.name);
  return {
    providerId: manifest.providerId,
    safeInstances,
    controlPlaneLimit: boundedControlPlaneLimit,
    effectiveInstances,
    startupConcurrency: Math.min(effectiveInstances, STARTUP_CONCURRENCY_MAX),
    limitingResources,
    unknownResources,
    confidence: unknownResources.length > 0 ? 'unknown' : 'estimated',
  };
}

function resourceCheck(observed: number, required: number, unit: string): HostCheck {
  return observed >= required
    ? { status: 'pass', observed, required, source: 'node:os' }
    : { status: 'fail', observed, required, remediation: `provide at least ${required} ${unit} after reserve`, source: 'node:os' };
}

function unknownCheck(remediation: string): HostCheck {
  return { status: 'unknown', remediation, source: 'side-effect-free probe' };
}

function toolCheck(candidate: string | undefined, configPath: string): HostCheck {
  if (!candidate) {
    return {
      status: 'not_checked',
      remediation: `select an explicit executable path for ${configPath} before activation`,
      source: 'explicit tool selection',
    };
  }
  try {
    if (statSync(candidate).isFile()) {
      return { status: 'pass', observed: 'present', source: 'explicit tool selection' };
    }
  } catch {
    // Deliberately do not return the selected path or filesystem error.
  }
  return {
    status: 'fail',
    observed: 'missing_or_not_a_file',
    remediation: `choose an existing executable for ${configPath} inside the approved provider root`,
    source: 'explicit tool selection',
  };
}

function round(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

export { providerManifest };
