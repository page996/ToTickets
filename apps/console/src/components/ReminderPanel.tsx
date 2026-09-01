import { Bell, BellRing, CalendarPlus, Check, ExternalLink, Plus, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Schedule } from '../contracts';
import type { NewSchedule } from '../api/api-client';
import { formatCountdown, formatInTimeZone } from '../utils/format';
import { StatusPill } from './StatusPill';

interface ReminderPanelProps {
  schedules: Schedule[];
  nowMs?: number;
  actionsDisabled?: boolean;
  onAcknowledge: (schedule: Schedule) => void;
  onCancel: (schedule: Schedule) => void;
  onCreate: (input: NewSchedule, idempotencyKey: string) => Promise<void>;
}

export function ReminderPanel({
  schedules,
  nowMs,
  actionsDisabled = false,
  onAcknowledge,
  onCancel,
  onCreate,
}: ReminderPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <section aria-labelledby="reminders-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">人工提醒</p>
          <h2 id="reminders-heading">日程与确认</h2>
        </div>
        <button className="button secondary-button" type="button" disabled={actionsDisabled} onClick={() => setFormOpen(true)}>
          <Plus size={17} aria-hidden="true" /> 新建提醒
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="empty-state compact-empty">
          <Bell size={24} aria-hidden="true" />
          <strong>暂无提醒</strong>
        </div>
      ) : (
        <div className="reminder-list">
          {schedules.map((schedule) => (
            <article className="reminder-row" key={schedule.id}>
              <div className="reminder-icon" aria-hidden="true">
                {schedule.state === 'notified' ? <BellRing size={20} /> : <Bell size={20} />}
              </div>
              <div className="reminder-main">
                <div className="reminder-title-row">
                  <h3>{schedule.label}</h3>
                  <StatusPill status={schedule.state} />
                </div>
                <p>{formatInTimeZone(schedule.startsAt, schedule.timezone)} · {schedule.timezone}</p>
                <div className="reminder-channels">
                  {schedule.reminders.map((reminder, index) => (
                    <span key={`${reminder.channel}-${reminder.offsetSeconds}-${index}`}>
                      {reminder.channel === 'sound' ? <Volume2 size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
                      {Math.abs(reminder.offsetSeconds) / 60} 分钟前
                    </span>
                  ))}
                </div>
              </div>
              <div className="countdown-block" aria-label="倒计时">
                <span>倒计时</span>
                <strong>{formatCountdown(schedule.startsAt, nowMs)}</strong>
              </div>
              <div className="row-actions">
                {schedule.publicReference && (
                  <a
                    className="icon-button"
                    href={schedule.publicReference}
                    target="_blank"
                    rel="noreferrer"
                    title="打开公开参考链接"
                    aria-label="打开公开参考链接"
                  >
                    <ExternalLink size={17} aria-hidden="true" />
                  </a>
                )}
                {schedule.state === 'notified' && (
                  <button className="button primary-button compact-button" type="button" disabled={actionsDisabled} onClick={() => onAcknowledge(schedule)}>
                    <Check size={16} aria-hidden="true" /> 确认已看到
                  </button>
                )}
                {!['cancelled', 'expired', 'completed', 'failed'].includes(schedule.state) && (
                  <button className="icon-button danger-icon-button" type="button" disabled={actionsDisabled} title="取消提醒" aria-label="取消提醒" onClick={() => onCancel(schedule)}>
                    <X size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <ScheduleDialog open={formOpen} actionsDisabled={actionsDisabled} onClose={() => setFormOpen(false)} onCreate={onCreate} />
    </section>
  );
}

function ScheduleDialog({
  open,
  actionsDisabled,
  onClose,
  onCreate,
}: {
  open: boolean;
  actionsDisabled: boolean;
  onClose: () => void;
  onCreate: (input: NewSchedule, idempotencyKey: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [timezone, setTimezone] = useState('');
  const [publicReference, setPublicReference] = useState('');
  const [offsetMinutes, setOffsetMinutes] = useState('15');
  const [channel, setChannel] = useState<'desktop' | 'sound'>('desktop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pendingSubmission = useRef<{
    signature: string;
    idempotencyKey: string;
  } | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  }, [open]);

  if (!open) return null;
  const close = () => {
    pendingSubmission.current = undefined;
    onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (actionsDisabled) {
      setError('当前快照已过期，请刷新成功后再创建提醒。');
      return;
    }
    const offset = Number(offsetMinutes);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(startsAt)) {
      setError('开始时间必须包含 UTC 标记或明确的时区偏移。');
      return;
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_080) {
      setError('提醒提前量必须是 0 到 10080 分钟的整数。');
      return;
    }
    setBusy(true);
    setError(undefined);
    const input: NewSchedule = {
      label: label.trim(),
      ...(publicReference.trim() ? { publicReference: publicReference.trim() } : {}),
      startsAt,
      timezone: timezone.trim(),
      reminders: [{ offsetSeconds: -offset * 60, channel }],
    };
    const signature = JSON.stringify(input);
    const idempotencyKey = pendingSubmission.current?.signature === signature
      ? pendingSubmission.current.idempotencyKey
      : crypto.randomUUID();
    pendingSubmission.current = { signature, idempotencyKey };
    try {
      await onCreate(input, idempotencyKey);
      setLabel('');
      setStartsAt('');
      setPublicReference('');
      pendingSubmission.current = undefined;
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提醒创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => !busy && close()}>
      <section className="dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button dialog-close" type="button" onClick={close} disabled={busy} aria-label="关闭">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="dialog-symbol"><CalendarPlus size={22} aria-hidden="true" /></div>
        <h2 id="schedule-dialog-title">新建人工提醒</h2>
        <form className="schedule-form" onSubmit={submit}>
          <label>名称<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={128} required /></label>
          <label>开始时间（RFC 3339）<input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} placeholder="2026-09-01T12:00:00+08:00" required /></label>
          <label>时区<input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" maxLength={64} required /></label>
          <label>公开参考链接<input value={publicReference} onChange={(event) => setPublicReference(event.target.value)} type="url" /></label>
          <div className="form-grid-two">
            <label>提前分钟<input value={offsetMinutes} onChange={(event) => setOffsetMinutes(event.target.value)} type="number" min="0" max="10080" step="1" required /></label>
            <label>提醒渠道<select value={channel} onChange={(event) => setChannel(event.target.value as 'desktop' | 'sound')}><option value="desktop">桌面</option><option value="sound">声音</option></select></label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button secondary-button" type="button" onClick={close} disabled={busy}>取消</button>
            <button className="button primary-button" type="submit" disabled={busy || actionsDisabled}>{busy ? '创建中...' : '创建提醒'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
