import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { isActiveSchedule, requiresFreshDeviceConfirmation, selectPreviewDevice } from '../App';
import { ControlPlaneError } from '../api/api-client';
import type { Device, Schedule } from '../contracts';
import { AuditTable } from './AuditTable';
import { ConfirmDialog } from './ConfirmDialog';
import { DeviceGrid, isFreshDeviceHeartbeat } from './DeviceGrid';
import { ReminderPanel } from './ReminderPanel';

describe('console component state guards', () => {
  it('treats failed schedules as terminal and renders no write actions for them', () => {
    const failed = scheduleFixture('failed');
    const markup = renderToStaticMarkup(
      <ReminderPanel
        schedules={[failed]}
        nowMs={Date.parse('2026-09-01T11:00:00.000Z')}
        onAcknowledge={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(isActiveSchedule(failed)).toBe(false);
    expect(markup).toContain('08:00:00');
    expect(markup).not.toContain('确认已看到');
    expect(markup).not.toContain('aria-label="取消提醒"');
  });

  it('offers acknowledgement only after a reminder has been notified', () => {
    const scheduled = { ...scheduleFixture('scheduled'), id: 'scheduled' };
    const notified = { ...scheduleFixture('notified'), id: 'notified' };
    const completed = { ...scheduleFixture('completed'), id: 'completed' };
    const markup = renderToStaticMarkup(
      <ReminderPanel
        schedules={[scheduled, notified, completed]}
        nowMs={Date.parse('2026-09-01T11:00:00.000Z')}
        onAcknowledge={vi.fn()}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(markup.match(/确认已看到/g)).toHaveLength(1);
  });

  it('disables device writes when the snapshot is stale and disables a no-op focus action', () => {
    const focused = deviceFixture('focused', { focused: true });
    const markup = renderToStaticMarkup(
      <DeviceGrid
        devices={[focused]}
        nowMs={Date.parse(focused.lastSeenAt)}
        staleAfterMs={10_000}
        actionsDisabled
        onAction={vi.fn()}
      />,
    );

    expect(markup).toContain('title="当前焦点设备"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ['an invalid heartbeat timestamp', 'not-a-timestamp', 0],
    ['a heartbeat from the future', '2026-09-01T11:00:01.000Z', 1_000],
  ])('fails closed for %s', (_description, lastSeenAt, staleAfterMs) => {
    const nowMs = Date.parse('2026-09-01T11:00:00.000Z');
    const device = deviceFixture('untrusted-heartbeat', { lastSeenAt });
    const markup = renderToStaticMarkup(
      <DeviceGrid
        devices={[device]}
        nowMs={nowMs}
        staleAfterMs={staleAfterMs}
        onAction={vi.fn()}
      />,
    );

    expect(isFreshDeviceHeartbeat(lastSeenAt, nowMs, staleAfterMs)).toBe(false);
    expect(markup).toContain('status-stale');
    expect(markup.match(/disabled=""/g)?.length).toBe(4);
  });

  it('fails closed when the control-plane clock is unavailable', () => {
    const device = deviceFixture('missing-clock');
    const markup = renderToStaticMarkup(
      <DeviceGrid devices={[device]} staleAfterMs={10_000} onAction={vi.fn()} />,
    );

    expect(isFreshDeviceHeartbeat(device.lastSeenAt, undefined, 10_000)).toBe(false);
    expect(markup).toContain('status-stale');
    expect(markup.match(/disabled=""/g)?.length).toBe(4);
  });

  it('selects the active preview independently from the focused device', () => {
    const focused = deviceFixture('focused', { focused: true });
    const preview = deviceFixture('preview', { stream: 'running' });

    expect(selectPreviewDevice([focused, preview])?.id).toBe('preview');
    expect(selectPreviewDevice([focused])?.id).toBe('focused');
    expect(selectPreviewDevice([])).toBeUndefined();
  });

  it('marks cancel, rather than the destructive command, as the initial dialog focus', () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="停止设备？"
        description="Synthetic confirmation"
        confirmLabel="停止设备"
        destructive
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toMatch(/autofocus=""[^>]*>取消<\/button>/);
    expect(markup).not.toMatch(/autofocus=""[^>]*>停止设备<\/button>/);
  });

  it('offers filters for the lifecycle event names emitted by the API', () => {
    const markup = renderToStaticMarkup(
      <AuditTable
        events={[]}
        devices={[]}
        total={0}
        page={1}
        pageSize={25}
        typeFilter=""
        deviceFilter=""
        onTypeFilter={vi.fn()}
        onDeviceFilter={vi.fn()}
        onPage={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(markup).toContain('value="device.lifecycle.started"');
    expect(markup).toContain('value="device.lifecycle.stopped"');
    expect(markup).toContain('value="device.lifecycle.reconnected"');
    expect(markup).not.toContain('value="device.lifecycle.start"');
  });

  it('discards device confirmations that are stale or expired', () => {
    expect(requiresFreshDeviceConfirmation(new ControlPlaneError('command.stale', 'stale', undefined, false, 409))).toBe(true);
    expect(requiresFreshDeviceConfirmation(new ControlPlaneError('command.expired', 'expired', undefined, false, 409))).toBe(true);
    expect(requiresFreshDeviceConfirmation(new ControlPlaneError('transport.unavailable', 'unknown', undefined, true))).toBe(false);
  });
});

function deviceFixture(id: string, overrides: Partial<Device> = {}): Device {
  return {
    id,
    alias: `Device ${id}`,
    provider: 'mock-adapter',
    transport: 'memory',
    state: 'ready',
    stream: 'stopped',
    focused: false,
    capabilities: {
      lifecycle: true,
      health_read: true,
      screen_preview: true,
      user_input: false,
      automation: false,
    },
    lastSeenAt: '2026-09-01T11:00:00.000Z',
    sequence: 1,
    ...overrides,
  };
}

function scheduleFixture(state: Schedule['state']): Schedule {
  return {
    id: 'synthetic-schedule',
    label: 'Synthetic reminder',
    startsAt: '2026-09-01T12:00:00.000Z',
    timezone: 'America/New_York',
    reminders: [{ offsetSeconds: -60, channel: 'desktop' }],
    state,
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
  };
}
