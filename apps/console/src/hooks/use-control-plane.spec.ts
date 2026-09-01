import { describe, expect, it } from 'vitest';
import { ControlPlaneError, type AuditFilters } from '../api/api-client';
import type { ConsoleRuntimeConfig } from '../config/runtime-config';
import {
  controlPlaneAuditRequests,
  controlPlaneEffectDependencies,
  snapshotAfterFailure,
  snapshotIsExpired,
  type ControlPlaneSnapshot,
} from './use-control-plane';

const config: ConsoleRuntimeConfig = {
  schemaVersion: 'console-runtime.v1',
  apiBaseUrl: requiredTestEnvironment('CONSOLE_TEST_API_BASE_URL').replace(/\/$/, ''),
  eventsUrl: requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL').replace(/\/$/, ''),
  operatorId: 'test-operator',
  refreshIntervalMs: 2_000,
  staleAfterMs: 10_000,
};

describe('useControlPlane effect dependencies', () => {
  it('keeps refresh dependencies equal across rerenders with equivalent filter objects', () => {
    const firstRender: AuditFilters = {
      page: 2,
      pageSize: 25,
      type: 'device.registered',
      deviceId: 'synthetic-device',
    };
    const equivalentRerender = { ...firstRender };

    const previous = controlPlaneEffectDependencies(config, firstRender);
    const next = controlPlaneEffectDependencies(config, equivalentRerender);
    expect(dependenciesChanged(previous.refresh, next.refresh)).toBe(false);
    expect(dependenciesChanged(previous.eventStream, next.eventStream)).toBe(false);
  });

  it.each([
    ['page', { page: 3 }],
    ['page size', { pageSize: 50 }],
    ['event type', { type: 'screen.stream.started' }],
    ['device', { deviceId: 'another-synthetic-device' }],
  ])('changes refresh dependencies when the %s filter changes', (_label, change) => {
    const current: AuditFilters = {
      page: 2,
      pageSize: 25,
      type: 'device.registered',
      deviceId: 'synthetic-device',
    };
    const next = { ...current, ...change };

    const previousDependencies = controlPlaneEffectDependencies(config, current);
    const nextDependencies = controlPlaneEffectDependencies(config, next);
    expect(dependenciesChanged(previousDependencies.refresh, nextDependencies.refresh)).toBe(true);
    expect(dependenciesChanged(
      previousDependencies.eventStream,
      nextDependencies.eventStream,
    )).toBe(false);
  });

  it('keeps the overview recent audit request independent from table filters and pagination', () => {
    const [tableRequest, recentRequest] = controlPlaneAuditRequests({
      page: 4,
      pageSize: 25,
      type: 'screen.stream.started',
      deviceId: 'synthetic-device',
    });

    expect(tableRequest).toEqual({
      page: 4,
      pageSize: 25,
      type: 'screen.stream.started',
      deviceId: 'synthetic-device',
    });
    expect(recentRequest).toEqual({ page: 1, pageSize: 5 });
  });

  it('marks both initial and previously loaded snapshots stale after refresh failure', () => {
    const error = new ControlPlaneError('transport.unavailable', 'offline');
    const initialFailure = snapshotAfterFailure(snapshotFixture(false), error);
    const laterFailure = snapshotAfterFailure(snapshotFixture(true), error);

    expect(initialFailure).toEqual(expect.objectContaining({
      hasSnapshot: false,
      loading: false,
      stale: true,
      error,
    }));
    expect(laterFailure).toEqual(expect.objectContaining({
      hasSnapshot: true,
      stale: true,
      devices: [],
      error,
    }));
  });

  it('expires a successful snapshot from monotonic elapsed time', () => {
    const snapshot = { ...snapshotFixture(true), stale: false, lastRefreshAt: 1_000 };
    expect(snapshotIsExpired(snapshot, 10_999, 10_000)).toBe(false);
    expect(snapshotIsExpired(snapshot, 11_001, 10_000)).toBe(true);
    expect(snapshotIsExpired(snapshotFixture(false), 20_000, 10_000)).toBe(false);
  });
});

function snapshotFixture(hasSnapshot: boolean): ControlPlaneSnapshot {
  return {
    devices: [],
    schedules: [],
    auditEvents: [],
    recentAuditEvents: [],
    auditTotal: 0,
    loading: !hasSnapshot,
    refreshing: false,
    hasSnapshot,
    stale: !hasSnapshot,
    eventStream: 'closed',
    ...(hasSnapshot ? { lastRefreshAt: 1_000 } : {}),
  };
}

function dependenciesChanged(
  previous: readonly unknown[],
  next: readonly unknown[],
): boolean {
  return previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));
}

function requiredTestEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be injected for console tests`);
  return value;
}
