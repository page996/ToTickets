import { describe, expect, it } from 'vitest';
import { formatAge, formatInTimeZone, humanizeEventType } from './format';

describe('console formatting', () => {
  it('formats a schedule instant in its declared IANA time zone', () => {
    expect(formatInTimeZone('2026-09-01T12:00:00.000Z', 'America/New_York')).toContain(
      '08:00:00',
    );
    expect(formatInTimeZone('2026-09-01T12:00:00.000Z', 'invalid/time-zone')).toBe('--');
  });

  it('uses the emitted lifecycle event names', () => {
    expect(humanizeEventType('device.lifecycle.started')).toBe('设备已启动');
    expect(humanizeEventType('device.lifecycle.stopped')).toBe('设备已停止');
    expect(humanizeEventType('device.lifecycle.reconnected')).toBe('设备已重连');
  });

  it('does not render malformed or future heartbeat timestamps as fresh', () => {
    const nowMs = Date.parse('2026-09-01T11:00:00.000Z');
    expect(formatAge('not-a-timestamp', nowMs)).toBe('--');
    expect(formatAge('2026-09-01T11:00:01.000Z', nowMs)).toBe('--');
  });
});
