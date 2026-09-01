import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle } from 'lucide-react';
import { App } from './App';
import { loadRuntimeConfig } from './config/runtime-config';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('console root element is missing');
const root = createRoot(rootElement);

void loadRuntimeConfig()
  .then((config) => {
    root.render(<StrictMode><App config={config} /></StrictMode>);
  })
  .catch((error: unknown) => {
    root.render(
      <StrictMode>
        <main className="fatal-screen">
          <div className="fatal-symbol"><AlertTriangle size={26} aria-hidden="true" /></div>
          <h1>运行配置无效</h1>
          <p>{error instanceof Error ? error.message : '无法读取控制台运行配置'}</p>
          <span>控制台已停止加载，未连接任何设备或服务。</span>
        </main>
      </StrictMode>,
    );
  });
