import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import type { Device } from '../contracts';
import { StatusPill } from './StatusPill';

export function PreviewPane({
  device,
  focusedDeviceId,
}: {
  device?: Device;
  focusedDeviceId?: string;
}) {
  const showingActivePreview = device?.stream === 'running';
  const showingNonFocusedPreview = showingActivePreview && device.id !== focusedDeviceId;
  return (
    <section className="preview-section" aria-labelledby="preview-heading">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">{showingActivePreview ? '当前预览' : '焦点画面'}</p>
          <h2 id="preview-heading">{device?.alias ?? '未选择设备'}</h2>
        </div>
        {device && <StatusPill status={device.stream} />}
      </div>
      <div className="preview-surface">
        <div className="preview-status">
          {device?.stream === 'running' ? <Eye size={34} aria-hidden="true" /> : <EyeOff size={34} aria-hidden="true" />}
          <strong>{showingActivePreview ? '等待只读视频帧' : '预览未启动'}</strong>
          <span>{device ? `${device.provider} · 序列 #${device.sequence}${showingNonFocusedPreview ? ' · 非焦点设备' : ''}` : '从设备列表选择焦点设备'}</span>
        </div>
        <div className="readonly-badge">
          <LockKeyhole size={14} aria-hidden="true" />
          只读
        </div>
      </div>
    </section>
  );
}
