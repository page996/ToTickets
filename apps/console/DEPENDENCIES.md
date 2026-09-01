# Console direct dependency record

间接 npm 依赖由根目录 `pnpm-lock.yaml` 锁定并由 SBOM 生成器追踪；间接 Rust 依赖由 `src-tauri/Cargo.lock` 锁定。缺少任一锁文件时不得发布。

| 依赖 | 固定版本 | 来源 | 许可证 | 用途与权限面 | 未采用方案 |
| --- | --- | --- | --- | --- | --- |
| `react` / `react-dom` | 19.1.1 | npm / facebook/react | MIT | 本地 UI 渲染；无原生权限 | 原生 DOM 会增加状态一致性成本 |
| `lucide-react` | 0.468.0 | npm / lucide-icons/lucide | ISC | UI 图标；无运行时网络或设备权限 | 自制 SVG 会造成图标系统重复 |
| `@tauri-apps/api` | 2.8.0 | npm / tauri-apps/tauri | Apache-2.0 OR MIT | 仅调用白名单运行配置命令 | 浏览器全局配置不适合发布壳 |
| `@tauri-apps/cli` | 2.8.4 | npm / tauri-apps/tauri | Apache-2.0 OR MIT | 开发和桌面构建；构建期进程权限 | Electron 被项目技术栈禁止 |
| `vite` / `@vitejs/plugin-react` | 7.1.3 / 5.0.2 | npm / vitejs | MIT | 前端构建及开发期运行配置中间件 | 手工 bundling 不可维护 |
| `typescript` | 5.9.3 | npm / microsoft/TypeScript | Apache-2.0 | 静态类型检查；无运行时权限 | JavaScript 无法提供契约保证 |
| `vitest` | 3.2.4 | npm / vitest-dev/vitest | MIT | 配置与 API client 单元测试 | 独立 Jest 会增加重复工具链 |
| `@types/node` | 24.13.0 | npm / DefinitelyTyped | MIT | Vite 配置的 Node 类型，仅开发期 | 自建声明不完整 |
| `@types/react` / `@types/react-dom` | 19.1.10 / 19.1.7 | npm / DefinitelyTyped | MIT | React 静态类型，仅开发期 | 自建声明不完整 |
| `tauri` | 2.8.5 | crates.io / tauri-apps/tauri | Apache-2.0 OR MIT | 桌面窗口和单个配置 IPC 命令；不授予 shell/文件/设备权限 | Electron 被项目技术栈禁止 |
| `tauri-build` | 2.4.1 | crates.io / tauri-apps/tauri | Apache-2.0 OR MIT | 生成 Tauri 构建上下文，仅构建期 | 手写资源生成不可复现 |
| `serde` | 1.0.219 | crates.io / serde-rs/serde | Apache-2.0 OR MIT | 将非敏感运行配置序列化到前端 | 手写 JSON 易产生字段漂移 |
