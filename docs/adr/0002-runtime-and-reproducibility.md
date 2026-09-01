# ADR-0002：NestJS/Tauri 技术栈与可复现环境

- 状态：已采纳
- 日期：2026-08-25

## 决策

后端统一使用 NestJS + TypeScript，桌面控制台统一使用 Tauri + React/TypeScript。项目不把系统级 Node、Rust、Python 或全局包作为前提；工具链通过项目版本文件、pnpm workspace、锁文件和 Rust toolchain 文件隔离并复现。

所有运行时地址、端口、文件路径、外部工具路径和资源配额从严格配置加载。源码中的协议常量可以固定，环境值不可硬编码。直接/间接依赖都要写入依赖目录、锁文件、许可证记录和 SBOM，并支持源码复现或 Tauri 自包含安装包。

## 背景

原始调研同时比较了 FastAPI、NestJS、浏览器 UI 和 Electron。用户已明确选择 NestJS 与 Tauri + React，并要求迁移到其他机器时可补全依赖或直接安装。因此继续保留多个实现分支会导致部署和审计不确定。

## 后果

- 团队需要维护 Node、pnpm 和 Rust 的版本文件及 CI 环境。
- Tauri 打包需处理 Rust 工具链和平台签名，初始工作量高于纯浏览器 UI。
- Python/pip 不再是正式部署路径；任何辅助脚本必须隔离并独立记录。
- 配置 schema、provider manifest 和依赖 catalog 成为发布门槛，但能避免硬编码路径和“在我机器上能跑”的问题。

