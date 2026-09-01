# 实施路线图

## 当前状态（2026-08-31）

已由仓库实现和测试确认：pnpm workspace 与隔离工具链、NestJS mock 控制平面、
Tauri + React 控制台基线、内存 repository、`MockDeviceAdapter`、严格且仅允许
loopback 监听的 `runtime-config.v3` 加载与 schema、REST/WebSocket 基线、当前事件 payload schema
及契约测试、人工确认/幂等/有界并发和健康诊断。

部分完成：阶段 1 和阶段 2 已有可运行基线，但完整验收与发布证据仍未闭合；阶段
2.5 的并发与故障基线仍需按 `docs/10-concurrency-and-operability.md` 和
`docs/11-load-and-fault-baseline.md` 持续复验。

明确待办：OpenAPI 请求/响应文档、认证/TLS/RBAC/CSRF、持久化 SQLite repository、
真实设备的只读 Android 适配器、完整 Playwright/Tauri 验收和发布级运行时 SBOM/
provenance。上述安全控制完成前不得进行非 loopback 部署；真实适配器仍不得包含
任何设备输入或购票自动化能力。

## 阶段 0：批准与基线（已完成）

交付：范围边界、调研报告、架构、模块规格、接口、威胁模型、测试计划、AGENTS.md 和 ADR。

状态：合规边界、架构、测试计划、项目约束和 ADR 已落盘。是否初始化 Git 属于工作区交付决策，不再作为描述当前代码阶段的条件。

## 阶段 1：Mock 控制平面（进行中）

已完成或已有基线：

- 建立 NestJS + TypeScript workspace，提供 `/api/v1` 和 WebSocket。
- 实现 `MockDeviceAdapter`、设备状态机、提醒服务、审计和策略拒绝基线。
- 建立严格配置/事件 JSON Schema、契约测试、本地开发脚本、项目本地 Node/pnpm/Rust 工具链和依赖清单；不使用系统运行时作为隐含前提。

待完成：

- 用持久化 SQLite repository 替换当前有界内存 repository，并完成迁移、恢复和保留策略验证。
- 建立完整 OpenAPI 请求/响应契约；继续补齐 REST schema、审计哈希链和验收证据。

退出条件：Gate A/B 通过；没有真实平台网络访问和敏感字段。

## 阶段 2：控制台 UI（进行中）

已有 Tauri + React 控制台基线；以下仍作为完整验收范围：

- Tauri + React/TypeScript；不再保留浏览器独立 UI 作为实现分支。
- 设备网格、焦点预览占位、日程时间线、提醒确认、审计查询、急停。
- 严格 IPC/CSP、键盘可达性、错误和 stale 状态显示。

退出条件：Playwright 本地 mock E2E 通过；所有写操作都显示确认和审计结果。

## 阶段 2.5：并发与可运维性加固（当前迭代）

在 Mock 控制平面和 Tauri 控制台边界内完成：

- 同设备写操作串行化、全局预览/焦点/急停协调和不可变状态快照；
- 幂等缓存、确认票据、事件历史、WebSocket 连接和审计的有界资源策略；
- live/ready/diagnostics 健康端点和非敏感饱和度指标；
- WebSocket replay 分批、慢客户端降级、客户端 single-flight refresh 和指数退避；
- 同设备/跨设备/重复幂等键/慢连接/重启恢复的负载与故障测试。

退出条件：`docs/10-concurrency-and-operability.md` 中的验收指标有可复现实测记录；健康探针在负载期间持续可用；所有新增配置和指标均有 schema、契约测试和依赖记录；未扩大到真实平台或设备输入能力。

## 阶段 3：只读 Android 适配器

交付建议：

- 官方 Android Emulator/AVD 或单台实体设备。
- ADB 发现、启动/停止、健康检查和 scrcpy 只读预览。
- 命令 allowlist、低权限子进程、资源配额和急停。

退出条件：Gate C 通过；人工验收确认系统不自动操作真实第三方 App。

## 阶段 4：可选供应商适配器

只有在用户明确批准、供应商 EULA/许可证审核和安全评审后，才评估 Genymotion 或其他模拟器。每个适配器独立包、独立测试、独立开关；不会增加批量输入或购票接口。

## 阶段 5：发布与运维

- 生成 SBOM、签名安装包、升级/回滚说明和数据删除工具。
- 生成 Tauri 自包含安装包；同时保留 `pnpm install --frozen-lockfile` 的源码部署路径。
- 增加本地备份加密、审计导出、故障演练和安全响应 runbook。
- 首个发布只支持显式 loopback 配置；若要局域网访问，另行完成认证、TLS、RBAC、CSRF、网络隔离和隐私评估。

## 每阶段审批模板

在开始下一阶段前提交：

1. 变更目标和不变边界。
2. 具体文件/依赖/进程/设备范围。
3. 预期产物和验收命令。
4. 新增风险、许可证和数据处理变化。
5. 可逆性、回滚方式和用户需要确认的点。

## 暂不安排的工作

自动登录/验证码、自动抢票、批量同步点击、私有接口、号池概率优化、自动下单/支付、真实订单压测和风控规避均不进入路线图。若需求再次提出，必须先说明拒绝原因，并不会通过改名或拆模块绕过边界。
