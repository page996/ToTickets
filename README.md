# 人工购票辅助控制台

这是一个从零开始的研究型工程，目标是帮助用户管理自己的 Android 设备/模拟器并在演出开售前后保持人工可控的工作流。系统提供设备生命周期、只读画面、健康状态、倒计时提醒、人工确认和审计，不替用户完成大麦购票。

当前仓库已经包含可运行的 mock-first 基线：NestJS 控制平面、Tauri + React 控制台、本地 mock 适配器、REST/WebSocket 合约、合规门禁和锁文件驱动的 CycloneDX SBOM。它不包含真实平台购票自动化。工程边界与复现方式先阅读：

1. [`docs/00-requirements-and-boundaries.md`](docs/00-requirements-and-boundaries.md)
2. [`docs/01-research-report.md`](docs/01-research-report.md)
3. [`docs/02-architecture.md`](docs/02-architecture.md)
4. [`docs/03-module-specifications.md`](docs/03-module-specifications.md)
5. [`docs/04-interface-contracts.md`](docs/04-interface-contracts.md)
6. [`docs/05-security-and-privacy.md`](docs/05-security-and-privacy.md)
7. [`docs/06-test-and-acceptance-plan.md`](docs/06-test-and-acceptance-plan.md)
8. [`docs/07-implementation-roadmap.md`](docs/07-implementation-roadmap.md)
9. [`docs/08-module-connection-matrix.md`](docs/08-module-connection-matrix.md)
10. [`docs/09-dependency-and-reproducible-build.md`](docs/09-dependency-and-reproducible-build.md)
11. [`docs/dependency-catalog.md`](docs/dependency-catalog.md)
12. [`docs/10-concurrency-and-operability.md`](docs/10-concurrency-and-operability.md)
13. [`docs/11-load-and-fault-baseline.md`](docs/11-load-and-fault-baseline.md)
14. [`docs/12-final-release-audit.md`](docs/12-final-release-audit.md)
15. [`docs/openapi.v1.json`](docs/openapi.v1.json) - OpenAPI 3.1 REST machine contract

技术栈已冻结为 NestJS + TypeScript 后端和 Tauri + React/TypeScript 控制台。第一阶段仍先实现 mock-first 的控制平面和设备适配器契约；依赖、工具链、地址和路径必须按 [`docs/09-dependency-and-reproducible-build.md`](docs/09-dependency-and-reproducible-build.md) 复现。

运行时配置当前为 `runtime-config.v3`。除既有容量字段外，部署环境必须显式提供 `OPERATION_QUEUE_MAX_QUEUED`，用于限制每个本地操作调度器的等待项；达到配额时 API 返回可重试的容量错误，健康诊断只报告非敏感的 active、queued、capacity 和 rejected 计数。

宿主机准备阶段可读取 `GET /api/v1/hosts/probe` 和 `GET /api/v1/hosts/providers`：前者
只做无副作用资源/工具状态检查，后者给出带保留量的 provider 容量估算。估算必须在
目标宿主机 ramp test 后复核，当前接口不会启动 ADB/模拟器、安装 APK 或发送设备输入。
