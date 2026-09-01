import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, type AuditFilters, ControlPlaneError } from '../api/api-client';
import {
  ControlPlaneEventStream,
  type EventStreamState,
} from '../api/event-stream';
import { SingleFlightRefresh } from '../api/single-flight-refresh';
import type { AuditEvent, ClockSnapshot, Device, Schedule } from '../contracts';
import type { ConsoleRuntimeConfig } from '../config/runtime-config';

export interface ControlPlaneSnapshot {
  devices: Device[];
  schedules: Schedule[];
  auditEvents: AuditEvent[];
  recentAuditEvents: AuditEvent[];
  auditTotal: number;
  clock?: ClockSnapshot;
  loading: boolean;
  refreshing: boolean;
  hasSnapshot: boolean;
  stale: boolean;
  error?: ControlPlaneError;
  eventStream: EventStreamState;
  lastRefreshAt?: number;
}

interface ClockAnchor {
  serverUtcMs: number;
  monotonicMs: number;
}

const INITIAL_STATE: ControlPlaneSnapshot = {
  devices: [],
  schedules: [],
  auditEvents: [],
  recentAuditEvents: [],
  auditTotal: 0,
  loading: true,
  refreshing: false,
  hasSnapshot: false,
  stale: true,
  eventStream: 'closed',
};

export function useControlPlane(
  client: ApiClient,
  config: ConsoleRuntimeConfig,
  auditFilters: AuditFilters,
) {
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot>(INITIAL_STATE);
  const [nowMs, setNowMs] = useState<number>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const refreshOperation = useRef<() => Promise<void>>(async () => undefined);
  const refreshCoordinator = useRef<SingleFlightRefresh | undefined>(undefined);
  if (!refreshCoordinator.current) {
    refreshCoordinator.current = new SingleFlightRefresh(() => refreshOperation.current());
  }
  const clockAnchor = useRef<ClockAnchor | undefined>(undefined);
  const dependencies = controlPlaneEffectDependencies(config, auditFilters);
  const [auditPage, auditPageSize, auditType, auditDeviceId] = dependencies.refresh;
  const [eventsUrl, reconnectIntervalMs] = dependencies.eventStream;

  refreshOperation.current = async () => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setSnapshot((current) => ({ ...current, refreshing: !current.loading }));
    try {
      const [auditRequest, recentAuditRequest] = controlPlaneAuditRequests({
        page: auditPage,
        pageSize: auditPageSize,
        ...(auditType ? { type: auditType } : {}),
        ...(auditDeviceId ? { deviceId: auditDeviceId } : {}),
      });
      const [devices, schedules, audit, recentAudit, clock] = await Promise.all([
        client.listDevices(controller.signal),
        client.listSchedules(controller.signal),
        client.listAudit(auditRequest, controller.signal),
        client.listAudit(recentAuditRequest, controller.signal),
        client.getClock(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const serverUtcMs = Date.parse(clock.server_time);
      if (Number.isFinite(serverUtcMs)) {
        clockAnchor.current = { serverUtcMs, monotonicMs: performance.now() };
        setNowMs(serverUtcMs);
      }
      setSnapshot((current) => ({
        ...current,
        devices: devices.items,
        schedules: schedules.items,
        auditEvents: audit.items,
        recentAuditEvents: recentAudit.items,
        auditTotal: audit.total,
        clock,
        loading: false,
        refreshing: false,
        hasSnapshot: true,
        stale: false,
        error: undefined,
        lastRefreshAt: performance.now(),
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setSnapshot((current) => snapshotAfterFailure(current, error));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined;
    }
  };

  const refresh = useCallback(
    () => refreshCoordinator.current?.request() ?? Promise.resolve(),
    [],
  );

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    activeRequest.current?.abort();
    refreshCoordinator.current?.clearPending();
    void refresh();
    const poll = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = window.setInterval(poll, reconnectIntervalMs);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      activeRequest.current?.abort();
      refreshCoordinator.current?.clearPending();
    };
  }, [auditDeviceId, auditPage, auditPageSize, auditType, client, reconnectIntervalMs, refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const anchor = clockAnchor.current;
      const monotonicNow = performance.now();
      if (anchor) setNowMs(anchor.serverUtcMs + monotonicNow - anchor.monotonicMs);
      setSnapshot((current) => (
        snapshotIsExpired(current, monotonicNow, config.staleAfterMs)
          ? { ...current, stale: true }
          : current
      ));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [config.staleAfterMs]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        stream.connect();
      }, stream.nextReconnectDelay());
    };
    const stream = new ControlPlaneEventStream(eventsUrl, {
      onEvent: (_event, _hasSequenceGap) => void refreshRef.current(),
      onSyncRequired: () => void refreshRef.current(),
      onState: (eventStream) => {
        if (disposed) return;
        setSnapshot((current) => ({ ...current, eventStream }));
        if (eventStream === 'open' && reconnectTimer !== undefined) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        if (eventStream === 'closed' || eventStream === 'error') {
          scheduleReconnect();
        }
      },
    });
    stream.connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      stream.close();
    };
  }, [eventsUrl]);

  const serverNowMs = useMemo(() => nowMs, [nowMs]);
  return { snapshot, serverNowMs, refresh };
}

export function controlPlaneEffectDependencies(
  config: ConsoleRuntimeConfig,
  filters: AuditFilters,
): {
  refresh: readonly [number, number, string | undefined, string | undefined];
  eventStream: readonly [string, number];
} {
  return {
    refresh: [filters.page, filters.pageSize, filters.type, filters.deviceId],
    eventStream: [config.eventsUrl, config.refreshIntervalMs],
  };
}

export function controlPlaneAuditRequests(
  filters: AuditFilters,
): readonly [AuditFilters, AuditFilters] {
  return [
    { ...filters },
    { page: 1, pageSize: 5 },
  ];
}

export function snapshotAfterFailure(
  current: ControlPlaneSnapshot,
  error: unknown,
): ControlPlaneSnapshot {
  return {
    ...current,
    loading: false,
    refreshing: false,
    stale: true,
    error:
      error instanceof ControlPlaneError
        ? error
        : new ControlPlaneError('request.failed', '控制平面快照加载失败'),
  };
}

export function snapshotIsExpired(
  snapshot: ControlPlaneSnapshot,
  monotonicNow: number,
  staleAfterMs: number,
): boolean {
  return snapshot.hasSnapshot &&
    snapshot.lastRefreshAt !== undefined &&
    monotonicNow - snapshot.lastRefreshAt > staleAfterMs;
}
