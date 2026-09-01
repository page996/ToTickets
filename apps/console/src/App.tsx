import {
  Activity,
  Bell,
  Clock3,
  FileClock,
  LayoutDashboard,
  Monitor,
  PowerOff,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiClient, ControlPlaneError, type AuditFilters, type NewSchedule } from './api/api-client';
import { AuditTable } from './components/AuditTable';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DeviceGrid, type DeviceActionIntent } from './components/DeviceGrid';
import { PreviewPane } from './components/PreviewPane';
import { ReminderPanel } from './components/ReminderPanel';
import { StatusPill } from './components/StatusPill';
import type { Device, Schedule } from './contracts';
import type { ConsoleRuntimeConfig } from './config/runtime-config';
import { useControlPlane } from './hooks/use-control-plane';
import { formatCountdown, formatUtc, humanizeEventType } from './utils/format';

type View = 'overview' | 'devices' | 'reminders' | 'audit';

type PendingAction =
  | { kind: 'device'; device: Device; intent: DeviceActionIntent; keys: ConfirmationCommandKeys }
  | { kind: 'acknowledge'; schedule: Schedule; commandKey: string }
  | { kind: 'cancel-schedule'; schedule: Schedule; commandKey: string }
  | { kind: 'stop-all'; keys: ConfirmationCommandKeys };

interface ConfirmationCommandKeys {
  confirmation: string;
  command: string;
}

const VIEW_TITLES: Record<View, string> = {
  overview: '运行总览',
  devices: '设备管理',
  reminders: '日程提醒',
  audit: '审计记录',
};

export function App({ config }: { config: ConsoleRuntimeConfig }) {
  const client = useMemo(() => new ApiClient(config), [config]);
  const [view, setView] = useState<View>('overview');
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({ page: 1, pageSize: 25 });
  const { snapshot, serverNowMs, refresh } = useControlPlane(client, config, auditFilters);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string }>();

  const focusedDevice = snapshot.devices.find((device) => device.focused);
  const previewDevice = selectPreviewDevice(snapshot.devices);
  const writesDisabled = !snapshot.hasSnapshot || snapshot.stale;
  const readyDevices = snapshot.devices.filter((device) => ['ready', 'waiting'].includes(device.state)).length;
  const activeSchedules = snapshot.schedules.filter(isActiveSchedule);
  const nextSchedule = activeSchedules
    .filter((schedule) => Date.parse(schedule.startsAt) >= (serverNowMs ?? 0))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];

  const requestDeviceAction = (device: Device, intent: DeviceActionIntent) => {
    if (writesDisabled) return;
    setPendingAction({ kind: 'device', device, intent, keys: newConfirmationCommandKeys() });
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;
    if (writesDisabled) {
      setNotice({ tone: 'error', message: '当前快照已过期，请刷新成功后再执行写操作。' });
      return;
    }
    const action = pendingAction;
    let succeeded = false;
    setActionBusy(true);
    setNotice(undefined);
    try {
      if (action.kind === 'device') {
        const confirmation = await client.issueConfirmation(
          action.intent,
          action.device.id,
          action.device.sequence,
          action.keys.confirmation,
        );
        if (action.intent.startsWith('device.') && action.intent !== 'device.focus') {
          const operation = action.intent.slice('device.'.length) as 'start' | 'stop' | 'reconnect';
          await client.deviceCommand(action.device.id, operation, confirmation, action.keys.command);
        } else if (action.intent.startsWith('preview.')) {
          const operation = action.intent.slice('preview.'.length) as 'start' | 'stop';
          await client.previewCommand(action.device.id, operation, confirmation, action.keys.command);
        } else {
          await client.focusDevice(action.device.id, confirmation, action.keys.command);
        }
      } else if (action.kind === 'acknowledge') {
        await client.acknowledgeSchedule(action.schedule.id, action.commandKey);
      } else if (action.kind === 'cancel-schedule') {
        await client.cancelSchedule(action.schedule.id, action.commandKey);
      } else {
        const result = await client.stopAll(action.keys);
        setNotice({ tone: 'success', message: `急停完成，已停止 ${result.stopped} 个设备进程${result.failed ? `，${result.failed} 个设备未完成` : ''}。` });
      }
      if (action.kind !== 'stop-all') {
        setNotice({ tone: 'success', message: actionSuccessMessage(action) });
      }
      succeeded = true;
    } catch (error) {
      if (action.kind === 'device' && requiresFreshDeviceConfirmation(error)) {
        setPendingAction(undefined);
        setNotice({
          tone: 'error',
          message: error.code === 'command.expired'
            ? '设备确认已过期，旧确认已作废。控制台正在重新同步快照，请重新打开确认。'
            : '设备状态已变化，旧确认已作废。控制台正在重新同步快照，请从最新状态重新打开确认。',
        });
      } else {
        setNotice({ tone: 'error', message: readableError(error) });
      }
    } finally {
      await refresh();
      if (succeeded) setPendingAction(undefined);
      setActionBusy(false);
    }
  };

  const createSchedule = async (input: NewSchedule, idempotencyKey: string) => {
    if (writesDisabled) throw new Error('当前快照已过期，请刷新成功后再创建提醒。');
    try {
      await client.createSchedule(input, idempotencyKey);
      setNotice({ tone: 'success', message: '提醒已创建。' });
    } catch (error) {
      throw new Error(readableError(error));
    } finally {
      await refresh();
    }
  };

  const exportAudit = async () => {
    try {
      const exported = await client.exportAudit();
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `audit-${exported.exported_at.replace(/[^0-9TZ]/g, '')}.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setNotice({ tone: 'success', message: `已导出 ${exported.items.length} 条脱敏记录。` });
    } catch (error) {
      setNotice({ tone: 'error', message: readableError(error) });
    }
  };

  const connection = connectionState(snapshot.eventStream, snapshot.error, snapshot.stale);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><ShieldCheck size={22} aria-hidden="true" /></div>
          <div><strong>人工辅助台</strong><span>LOCAL CONTROL</span></div>
        </div>
        <nav aria-label="主导航">
          <NavButton icon={<LayoutDashboard size={19} />} label="总览" active={view === 'overview'} onClick={() => setView('overview')} />
          <NavButton icon={<Monitor size={19} />} label="设备" active={view === 'devices'} onClick={() => setView('devices')} count={snapshot.devices.length} />
          <NavButton icon={<Bell size={19} />} label="提醒" active={view === 'reminders'} onClick={() => setView('reminders')} count={activeSchedules.length} />
          <NavButton icon={<FileClock size={19} />} label="审计" active={view === 'audit'} onClick={() => setView('audit')} />
        </nav>
        <div className="sidebar-policy">
          <ShieldCheck size={17} aria-hidden="true" />
          <div><strong>人工在环</strong><span>输入与自动化能力关闭</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="breadcrumb">控制台 / {VIEW_TITLES[view]}</p>
            <h1>{VIEW_TITLES[view]}</h1>
          </div>
          <div className="topbar-actions">
            <div className="connection-chip" title={snapshot.error?.message}>
              <span className={`connection-dot connection-${connection}`} aria-hidden="true" />
              {connection === 'connected' ? '控制平面在线' : connection === 'connecting' ? '正在连接' : '连接异常'}
            </div>
            <button className="icon-button" title="刷新快照" aria-label="刷新快照" type="button" disabled={snapshot.refreshing} onClick={() => void refresh()}>
              <RefreshCw size={18} className={snapshot.refreshing ? 'spinning' : ''} aria-hidden="true" />
            </button>
            <button className="button danger-outline-button" type="button" disabled={writesDisabled || actionBusy} onClick={() => setPendingAction({ kind: 'stop-all', keys: newConfirmationCommandKeys() })}>
              <PowerOff size={17} aria-hidden="true" /> 急停
            </button>
          </div>
        </header>

        {notice && (
          <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.tone === 'error' ? <TriangleAlert size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
            <span>{notice.message}</span>
            <button type="button" onClick={() => setNotice(undefined)} aria-label="关闭通知">关闭</button>
          </div>
        )}

        {snapshot.hasSnapshot && snapshot.stale && (
          <div className="notice notice-warning" role="alert">
            <TriangleAlert size={17} aria-hidden="true" />
            <span>控制平面快照已过期，设备和提醒写操作已禁用；刷新成功后自动恢复。</span>
          </div>
        )}

        {snapshot.loading && !snapshot.hasSnapshot ? (
          <LoadingState />
        ) : !snapshot.hasSnapshot ? (
          <SnapshotErrorState error={snapshot.error} refreshing={snapshot.refreshing} onRefresh={() => void refresh()} />
        ) : (
          <div className="page-content">
            {view === 'overview' && (
              <>
                <section className="metric-strip" aria-label="运行指标">
                  <Metric icon={<Server size={19} />} label="设备总数" value={String(snapshot.devices.length)} detail={`${readyDevices} 个就绪`} />
                  <Metric icon={<Activity size={19} />} label="只读预览" value={String(snapshot.devices.filter((device) => device.stream === 'running').length)} detail="最多单路" />
                  <Metric icon={<Bell size={19} />} label="待处理提醒" value={String(activeSchedules.length)} detail={nextSchedule ? formatCountdown(nextSchedule.startsAt, serverNowMs) : '无待处理'} />
                  <Metric icon={<Clock3 size={19} />} label="控制平面时间" value={serverNowMs ? formatTimeOnly(serverNowMs) : '--:--:--'} detail={snapshot.clock?.confidence ?? '未校准'} />
                </section>
                <div className="overview-grid">
                  <PreviewPane device={previewDevice} focusedDeviceId={focusedDevice?.id} />
                  <UpcomingPanel schedules={activeSchedules} nowMs={serverNowMs} />
                </div>
                <section className="overview-devices" aria-labelledby="overview-devices-heading">
                  <div className="section-heading-row"><div><p className="section-kicker">设备状态</p><h2 id="overview-devices-heading">全部设备</h2></div><button className="text-button" type="button" onClick={() => setView('devices')}>查看管理</button></div>
                  <DeviceGrid devices={snapshot.devices} nowMs={serverNowMs} staleAfterMs={config.staleAfterMs} actionsDisabled={writesDisabled} onAction={requestDeviceAction} />
                </section>
                <RecentActivity events={snapshot.recentAuditEvents} />
              </>
            )}

            {view === 'devices' && (
              <div className="devices-view">
                <PreviewPane device={previewDevice} focusedDeviceId={focusedDevice?.id} />
                <section aria-labelledby="device-list-heading">
                  <div className="section-heading-row"><div><p className="section-kicker">生命周期与观察</p><h2 id="device-list-heading">设备列表</h2></div><span className="section-meta">{snapshot.devices.length} 个设备</span></div>
                  <DeviceGrid devices={snapshot.devices} nowMs={serverNowMs} staleAfterMs={config.staleAfterMs} actionsDisabled={writesDisabled} onAction={requestDeviceAction} />
                </section>
              </div>
            )}

            {view === 'reminders' && (
              <ReminderPanel
                schedules={snapshot.schedules}
                nowMs={serverNowMs}
                actionsDisabled={writesDisabled}
                onAcknowledge={(schedule) => setPendingAction({ kind: 'acknowledge', schedule, commandKey: crypto.randomUUID() })}
                onCancel={(schedule) => setPendingAction({ kind: 'cancel-schedule', schedule, commandKey: crypto.randomUUID() })}
                onCreate={createSchedule}
              />
            )}

            {view === 'audit' && (
              <AuditTable
                events={snapshot.auditEvents}
                devices={snapshot.devices}
                total={snapshot.auditTotal}
                page={auditFilters.page}
                pageSize={auditFilters.pageSize}
                typeFilter={auditFilters.type ?? ''}
                deviceFilter={auditFilters.deviceId ?? ''}
                onTypeFilter={(type) => setAuditFilters((current) => ({ ...current, page: 1, type: type || undefined }))}
                onDeviceFilter={(deviceId) => setAuditFilters((current) => ({ ...current, page: 1, deviceId: deviceId || undefined }))}
                onPage={(page) => setAuditFilters((current) => ({ ...current, page }))}
                onExport={() => void exportAudit()}
              />
            )}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={pendingAction !== undefined}
        {...dialogCopy(pendingAction)}
        busy={actionBusy}
        confirmDisabled={writesDisabled}
        onCancel={() => !actionBusy && setPendingAction(undefined)}
        onConfirm={() => void executePendingAction()}
      />
    </div>
  );
}

function dialogCopy(action: PendingAction | undefined) {
  if (!action) return { title: '', description: '', confirmLabel: '' };
  if (action.kind === 'stop-all') return { title: '停止所有设备进程？', description: '这会停止全部适配器和只读预览，不会发送设备输入。', confirmLabel: '执行急停', destructive: true };
  if (action.kind === 'acknowledge') return { title: '确认已看到提醒？', description: `将记录“${action.schedule.label}”的人工确认与审计事件，不会触发设备操作。`, confirmLabel: '确认已看到' };
  if (action.kind === 'cancel-schedule') return { title: '取消此提醒？', description: `“${action.schedule.label}”取消后不会再次触发提醒。`, confirmLabel: '取消提醒', destructive: true };
  const labels: Record<DeviceActionIntent, [string, string, boolean?]> = {
    'device.start': ['启动设备？', `将启动“${action.device.alias}”的适配器进程。`, false],
    'device.stop': ['停止设备？', `将停止“${action.device.alias}”及其只读预览。`, true],
    'device.reconnect': ['重新连接设备？', `将重建“${action.device.alias}”的适配器连接。`, false],
    'device.focus': ['切换焦点设备？', `将“${action.device.alias}”设为唯一焦点，不会发送设备输入。`, false],
    'preview.start': ['启动只读预览？', `将打开“${action.device.alias}”的只读画面流。`, false],
    'preview.stop': ['停止只读预览？', `将立即释放“${action.device.alias}”的画面帧缓冲。`, true],
  };
  const [title, description, destructive] = labels[action.intent];
  return { title, description, confirmLabel: title.replace('？', ''), destructive };
}

function actionSuccessMessage(action: Exclude<PendingAction, { kind: 'stop-all' }>): string {
  if (action.kind === 'acknowledge') return '人工确认已记录。';
  if (action.kind === 'cancel-schedule') return '提醒已取消。';
  return '设备操作已由控制平面接受。';
}

function readableError(error: unknown): string {
  if (error instanceof ControlPlaneError) {
    const stopped = numericDetail(error.details, 'stopped');
    const failed = numericDetail(error.details, 'failed');
    const partial = stopped !== undefined || failed !== undefined
      ? `（已停止 ${stopped ?? 0} 个，${failed ?? 0} 个未完成）`
      : '';
    const ambiguous = ['transport.unavailable', 'response.invalid'].includes(error.code)
      ? ' 请求结果可能已生效，控制台将重新同步。'
      : '';
    return `${error.message}${partial}${error.requestId ? `（请求 ${error.requestId.slice(0, 8)}）` : ''}${ambiguous}`;
  }
  return error instanceof Error ? error.message : '操作失败';
}

function numericDetail(details: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = details?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function requiresFreshDeviceConfirmation(error: unknown): error is ControlPlaneError {
  return error instanceof ControlPlaneError && ['command.stale', 'command.expired'].includes(error.code);
}

function connectionState(stream: string, error?: Error, stale = false): 'connected' | 'connecting' | 'disconnected' {
  if (error || stale) return 'disconnected';
  if (stream === 'open') return 'connected';
  if (stream === 'connecting') return 'connecting';
  return 'disconnected';
}

export function isActiveSchedule(schedule: Schedule): boolean {
  return !['cancelled', 'expired', 'completed', 'failed'].includes(schedule.state);
}

export function selectPreviewDevice(devices: Device[]): Device | undefined {
  return devices.find((device) => device.stream === 'running') ??
    devices.find((device) => device.focused);
}

function newConfirmationCommandKeys(): ConfirmationCommandKeys {
  return { confirmation: crypto.randomUUID(), command: crypto.randomUUID() };
}

function formatTimeOnly(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}

function NavButton({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  return <button type="button" className={`nav-button ${active ? 'nav-active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <b>{count}</b>}</button>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function UpcomingPanel({ schedules, nowMs }: { schedules: Schedule[]; nowMs?: number }) {
  const upcoming = schedules.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, 4);
  return <section className="upcoming-panel" aria-labelledby="upcoming-heading"><div className="section-heading-row"><div><p className="section-kicker">时间线</p><h2 id="upcoming-heading">近期提醒</h2></div></div>{upcoming.length === 0 ? <div className="empty-state compact-empty"><Bell size={23} /><strong>无近期提醒</strong></div> : <div className="timeline">{upcoming.map((schedule) => <div className="timeline-item" key={schedule.id}><span className="timeline-mark" /><div><strong>{schedule.label}</strong><span>{formatUtc(schedule.startsAt)}</span></div><b>{formatCountdown(schedule.startsAt, nowMs)}</b></div>)}</div>}</section>;
}

function RecentActivity({ events }: { events: Array<{ id: string; type: string; occurredAt: string; result: string }> }) {
  return <section className="activity-section" aria-labelledby="activity-heading"><div className="section-heading-row"><div><p className="section-kicker">最近变化</p><h2 id="activity-heading">活动记录</h2></div></div><div className="activity-list">{events.length === 0 ? <span className="muted-text">暂无审计事件</span> : events.map((event) => <div className="activity-item" key={event.id}><span className={`activity-mark ${event.result === 'rejected' ? 'activity-rejected' : ''}`} /><strong>{humanizeEventType(event.type)}</strong><time>{formatUtc(event.occurredAt)}</time></div>)}</div></section>;
}

function LoadingState() {
  return <div className="loading-state" role="status"><RefreshCw className="spinning" size={24} aria-hidden="true" /><strong>正在读取控制平面快照</strong><span>设备、提醒与审计数据正在同步</span></div>;
}

function SnapshotErrorState({ error, refreshing, onRefresh }: { error?: Error; refreshing: boolean; onRefresh: () => void }) {
  return <div className="loading-state snapshot-error-state" role="alert"><TriangleAlert size={24} aria-hidden="true" /><strong>控制平面快照不可用</strong><span>{error?.message ?? '设备、提醒与审计数据尚未成功同步。'}</span><button className="button secondary-button" type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? '刷新中...' : '重新刷新'}</button></div>;
}
