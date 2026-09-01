export function formatUtc(value: string | number | undefined): string {
  if (value === undefined) return '--';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatInTimeZone(
  value: string | number | undefined,
  timeZone: string,
): string {
  if (value === undefined) return '--';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '--';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return '--';
  }
}

export function formatCountdown(target: string, nowMs: number | undefined): string {
  if (nowMs === undefined) return '--:--:--';
  const remaining = Date.parse(target) - nowMs;
  if (!Number.isFinite(remaining)) return '--:--:--';
  if (remaining <= 0) return '已到时间';
  const totalSeconds = Math.ceil(remaining / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}天 ${clock}` : clock;
}

export function formatAge(timestamp: string, nowMs: number | undefined): string {
  if (nowMs === undefined || !Number.isFinite(nowMs)) return '--';
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs) return '--';
  const age = nowMs - timestampMs;
  if (age < 60_000) return `${Math.floor(age / 1_000)} 秒前`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  return `${Math.floor(age / 3_600_000)} 小时前`;
}

export function humanizeEventType(type: string): string {
  const labels: Record<string, string> = {
    'device.registered': '设备已登记',
    'device.lifecycle.started': '设备已启动',
    'device.lifecycle.stopped': '设备已停止',
    'device.lifecycle.reconnected': '设备已重连',
    'device.focus.changed': '焦点已切换',
    'screen.stream.started': '预览已启动',
    'screen.stream.stopped': '预览已停止',
    'schedule.created': '提醒已创建',
    'schedule.updated': '提醒已更新',
    'schedule.cancelled': '提醒已取消',
    'reminder.acknowledged': '提醒已确认',
    'safety.stop_all': '执行急停',
  };
  return labels[type] ?? type;
}
