import {
  Crosshair,
  MonitorPlay,
  MonitorStop,
  Power,
  RefreshCw,
  Square,
} from 'lucide-react';
import type { Device } from '../contracts';
import { formatAge } from '../utils/format';
import { StatusPill } from './StatusPill';

export type DeviceActionIntent =
  | 'device.start'
  | 'device.stop'
  | 'device.reconnect'
  | 'device.focus'
  | 'preview.start'
  | 'preview.stop';

/**
 * A device write is safe only when the snapshot has a usable clock and a
 * heartbeat that is neither malformed nor from the future. Unknown freshness
 * therefore fails closed instead of silently enabling the action buttons.
 */
export function isFreshDeviceHeartbeat(
  lastSeenAt: string,
  nowMs: number | undefined,
  staleAfterMs: number,
): boolean {
  const lastSeenMs = Date.parse(lastSeenAt);
  if (
    !Number.isFinite(lastSeenMs) ||
    typeof nowMs !== 'number' ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(staleAfterMs)
  ) {
    return false;
  }
  const ageMs = nowMs - lastSeenMs;
  return ageMs >= 0 && ageMs <= staleAfterMs;
}

interface DeviceGridProps {
  devices: Device[];
  nowMs?: number;
  staleAfterMs: number;
  actionsDisabled?: boolean;
  onAction: (device: Device, intent: DeviceActionIntent) => void;
}

export function DeviceGrid({
  devices,
  nowMs,
  staleAfterMs,
  actionsDisabled = false,
  onAction,
}: DeviceGridProps) {
  if (devices.length === 0) {
    return (
      <div className="empty-state">
        <MonitorStop size={26} aria-hidden="true" />
        <strong>暂无设备</strong>
        <span>控制平面尚未登记 mock 设备。</span>
      </div>
    );
  }

  return (
    <div className="device-grid">
      {devices.map((device) => {
        const stale = !isFreshDeviceHeartbeat(device.lastSeenAt, nowMs, staleAfterMs);
        const deviceActionsDisabled = actionsDisabled || stale;
        const anotherPreviewIsRunning = devices.some(
          (candidate) => candidate.id !== device.id && candidate.stream === 'running',
        );
        return (
          <article className={`device-card ${device.focused ? 'device-focused' : ''}`} key={device.id}>
            <div className="device-card-head">
              <div className="device-title">
                <span className={`device-indicator state-dot-${device.state}`} aria-hidden="true" />
                <div>
                  <h3>{device.alias}</h3>
                  <p>{device.provider} · {device.transport}</p>
                </div>
              </div>
              <StatusPill status={stale ? 'stale' : device.state} />
            </div>

            <dl className="device-facts">
              <div><dt>分组</dt><dd>{device.group ?? '未分组'}</dd></div>
              <div><dt>最后心跳</dt><dd>{formatAge(device.lastSeenAt, nowMs)}</dd></div>
              <div><dt>预览</dt><dd><StatusPill status={device.stream} /></dd></div>
              <div><dt>序列</dt><dd>#{device.sequence}</dd></div>
            </dl>

            <div className="device-card-actions" aria-label={`${device.alias} 操作`}>
              {device.state === 'offline' ? (
                <ActionButton title="启动设备" disabled={deviceActionsDisabled} onClick={() => onAction(device, 'device.start')}>
                  <Power size={17} aria-hidden="true" />
                </ActionButton>
              ) : (
                <ActionButton title="停止设备" disabled={deviceActionsDisabled} onClick={() => onAction(device, 'device.stop')} danger>
                  <Square size={16} aria-hidden="true" />
                </ActionButton>
              )}
              <ActionButton title="重新连接" disabled={deviceActionsDisabled} onClick={() => onAction(device, 'device.reconnect')}>
                <RefreshCw size={17} aria-hidden="true" />
              </ActionButton>
              {device.stream === 'running' ? (
                <ActionButton title="停止只读预览" disabled={deviceActionsDisabled} onClick={() => onAction(device, 'preview.stop')}>
                  <MonitorStop size={18} aria-hidden="true" />
                </ActionButton>
              ) : (
                <ActionButton
                  title="启动只读预览"
                  onClick={() => onAction(device, 'preview.start')}
                  disabled={deviceActionsDisabled || device.state === 'offline' || anotherPreviewIsRunning}
                >
                  <MonitorPlay size={18} aria-hidden="true" />
                </ActionButton>
              )}
              <ActionButton
                title={device.focused ? '当前焦点设备' : '设为焦点设备'}
                onClick={() => onAction(device, 'device.focus')}
                pressed={device.focused}
                disabled={deviceActionsDisabled || device.focused}
              >
                <Crosshair size={18} aria-hidden="true" />
              </ActionButton>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ActionButton({
  title,
  children,
  onClick,
  danger = false,
  disabled = false,
  pressed,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      className={`icon-button ${danger ? 'danger-icon-button' : ''} ${pressed ? 'active-icon-button' : ''}`}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
