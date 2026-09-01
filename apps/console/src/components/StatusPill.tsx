import type { DeviceState, ScheduleState } from '../contracts';

type Status = DeviceState | ScheduleState | 'connected' | 'disconnected' | 'stale' | 'running' | 'stopped';

const LABELS: Record<Status, string> = {
  offline: '离线',
  discovering: '发现中',
  booting: '启动中',
  ready: '就绪',
  waiting: '等待人工',
  error: '异常',
  draft: '草稿',
  scheduled: '已排期',
  notified: '已提醒',
  human_confirmed: '人工已确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
  connected: '已连接',
  disconnected: '未连接',
  stale: '数据过期',
  running: '预览中',
  stopped: '未预览',
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`status-pill status-${status}`}>{LABELS[status]}</span>;
}
