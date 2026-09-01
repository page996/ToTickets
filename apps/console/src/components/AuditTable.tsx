import { ChevronLeft, ChevronRight, Download, FileClock } from 'lucide-react';
import type { AuditEvent, Device } from '../contracts';
import { formatUtc, humanizeEventType } from '../utils/format';

interface AuditTableProps {
  events: AuditEvent[];
  devices: Device[];
  total: number;
  page: number;
  pageSize: number;
  typeFilter: string;
  deviceFilter: string;
  onTypeFilter: (value: string) => void;
  onDeviceFilter: (value: string) => void;
  onPage: (page: number) => void;
  onExport: () => void;
}

const EVENT_FILTERS = [
  ['', '全部事件'],
  ['device.registered', '设备登记'],
  ['device.lifecycle.started', '设备启动'],
  ['device.lifecycle.stopped', '设备停止'],
  ['device.lifecycle.reconnected', '设备重连'],
  ['screen.stream.started', '预览启动'],
  ['screen.stream.stopped', '预览停止'],
  ['reminder.acknowledged', '提醒确认'],
  ['safety.stop_all', '急停'],
] as const;

export function AuditTable(props: AuditTableProps) {
  const maxPage = Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <section aria-labelledby="audit-heading">
      <div className="section-heading-row audit-heading-row">
        <div>
          <p className="section-kicker">本地脱敏记录</p>
          <h2 id="audit-heading">审计日志</h2>
        </div>
        <div className="audit-controls">
          <label className="compact-field"><span>事件</span><select value={props.typeFilter} onChange={(event) => props.onTypeFilter(event.target.value)}>{EVENT_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="compact-field"><span>设备</span><select value={props.deviceFilter} onChange={(event) => props.onDeviceFilter(event.target.value)}><option value="">全部设备</option>{props.devices.map((device) => <option key={device.id} value={device.id}>{device.alias}</option>)}</select></label>
          <button className="button secondary-button" type="button" onClick={props.onExport}><Download size={16} aria-hidden="true" /> 导出 JSON</button>
        </div>
      </div>

      {props.events.length === 0 ? (
        <div className="empty-state compact-empty"><FileClock size={24} aria-hidden="true" /><strong>暂无匹配记录</strong></div>
      ) : (
        <div className="table-scroll">
          <table className="audit-table">
            <thead><tr><th>时间</th><th>事件</th><th>对象</th><th>结果</th><th>操作者</th><th>关联 ID</th></tr></thead>
            <tbody>
              {props.events.map((event) => (
                <tr key={event.id}>
                  <td>{formatUtc(event.occurredAt)}</td>
                  <td><strong>{humanizeEventType(event.type)}</strong><span>{event.type}</span></td>
                  <td>{deviceAlias(event.deviceId, props.devices) ?? event.scheduleId?.slice(0, 8) ?? '系统'}</td>
                  <td><span className={`result-label result-${event.result}`}>{event.result === 'accepted' ? '已接受' : '已拒绝'}</span></td>
                  <td>{event.operatorId}</td>
                  <td className="mono-cell" title={event.correlationId}>{event.correlationId.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination" aria-label="审计分页">
        <span>第 {props.page} / {maxPage} 页 · 共 {props.total} 条</span>
        <button className="icon-button" type="button" aria-label="上一页" title="上一页" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        <button className="icon-button" type="button" aria-label="下一页" title="下一页" disabled={props.page >= maxPage} onClick={() => props.onPage(props.page + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
      </div>
    </section>
  );
}

function deviceAlias(id: string | undefined, devices: Device[]): string | undefined {
  return id ? devices.find((device) => device.id === id)?.alias ?? id.slice(0, 8) : undefined;
}
