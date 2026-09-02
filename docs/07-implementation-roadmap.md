# 实施路线图

## 当前状态（2026-09-02）

已由仓库实现和测试确认：pnpm workspace 与隔离工具链、NestJS mock 控制平面、
Tauri + React 控制台基线、内存 repository、`MockDeviceAdapter`、严格且仅允许
loopback 监听的 `runtime-config.v3` 加载与 schema、REST/WebSocket 基线、当前事件 payload schema
及契约测试、人工确认/幂等/有界并发和健康诊断。新增的部署 domain 也已完成
mock-only 状态控制基线：`desired_state`/`observed_state`、`generation`、`operation_id`、
容量快照、幂等、审计和 CloudEvents 状态通知均在进程内验证；它不启动外部进程，
通过 mock-only `DeploymentController` 暴露有限 REST 路由，并已纳入 OpenAPI 契约测试；
这些路由不启动外部进程。

阶段 1、阶段 2 和阶段 2.5 已有可运行基线；本轮 R1 离线门禁和 R2 loopback
浏览器回归已完成并记录在 `docs/12-final-release-audit.md`。这只证明 mock-first
控制平面的当前验收范围，不等于真实设备或发布级远程部署验收。

恢复接管后于 2026-09-02 重新执行了一轮动态 loopback API/Vite/浏览器回归，结果和清理
证据记录在 `docs/checkpoints/CP-20260902-loopback-browser-regression.md`。该轮为
host-assisted `verified_with_gap`：页面、REST/WS、Origin 拒绝和 API 重启恢复均通过，
但仓库尚未锁定或提供可在干净 checkout 复现的浏览器 test-only harness；这项缺口不改变
当前只允许 loopback 的安全边界。

已完成本轮：OpenAPI v1 请求/响应契约及装饰路由契约测试、离线测试/构建/合规/
SBOM/Rust/Tauri 门禁、桌面与 390px 浏览器回归、合法与非法 Origin 验证、API
重启后的控制台 WebSocket 重连验证、宿主机只读探针与 provider 容量规划接口，以及
首次 Git 基线提交并推送到用户指定的 `page996/ToTickets`。

明确待办：认证/TLS/RBAC/CSRF、持久化 SQLite repository、真实设备的只读 Android
适配器、面向真实 provider host 的认证控制器与跨进程恢复、Tauri 原生窗口人工验收、发布级运行时 SBOM/provenance
和签名安装包。
上述安全控制完成前不得进行非 loopback 部署；真实适配器仍不得包含任何设备输入
或购票自动化能力。

## 阶段 0：批准与基线（已完成）

交付：范围边界、调研报告、架构、模块规格、接口、威胁模型、测试计划、AGENTS.md 和 ADR。

状态：合规边界、架构、测试计划、项目约束和 ADR 已落盘；已建立首次 Git 基线
提交 `6fa3bbd`（`chore: establish recovered project baseline`）。

## 阶段 1：Mock 控制平面（进行中）

已完成或已有基线：

- 建立 NestJS + TypeScript workspace，提供 `/api/v1` 和 WebSocket。
- 实现 `MockDeviceAdapter`、设备状态机、提醒服务、审计和策略拒绝基线。
- 建立严格配置/事件 JSON Schema、契约测试、本地开发脚本、项目本地 Node/pnpm/Rust 工具链和依赖清单；不使用系统运行时作为隐含前提。
- 建立 mock-only `DeploymentService` 与进程内 repository：规划、校验、观察状态迁移和
  desired state 更新均带 `generation`/`operation_id`，使用幂等、串行化、审计和 CloudEvents；
  provider/执行模式固定为 `mock-adapter`/`mock_only`，记录明确标记 `planning_only=true`、
  `side_effects=none`。

待完成：

- 用持久化 SQLite repository 替换当前有界内存 repository（包括部署记录），并完成迁移、恢复和保留策略验证。
- 继续补齐非核心/边缘 REST schema 细节、审计哈希链和发布级验收证据；OpenAPI v1 已覆盖
  当前装饰路由的请求/成功响应/错误 envelope，后续 schema 变更仍须持续契约测试。
- 持续维护部署事件的版本化 REST/WS payload schema，并将当前 mock REST 控制器的错误/审计
  语义纳入持续契约测试；在认证、授权、CSRF、provider host allowlist 和人工确认闸门
  完成前，不把状态控制器接入真实进程。

退出条件：Gate A/B 通过；没有真实平台网络访问和敏感字段。

## 阶段 2：控制台 UI（进行中）

已有 Tauri + React 控制台基线；本轮浏览器视口回归已通过，以下仍作为完整验收范围：

- Tauri + React/TypeScript；不再保留浏览器独立 UI 作为实现分支。
- 设备网格、焦点预览占位、日程时间线、提醒确认、审计查询、急停。
- 严格 IPC/CSP、键盘可达性、错误和 stale 状态显示。

退出条件：本地 mock 浏览器 E2E 与 Tauri 原生窗口人工验收均通过；所有写操作都显示确认和审计结果。

## 阶段 2.5：并发与可运维性加固（基线已完成，持续复验）

在 Mock 控制平面和 Tauri 控制台边界内完成：

- 同设备写操作串行化、全局预览/焦点/急停协调和不可变状态快照；
- 幂等缓存、确认票据、事件历史、WebSocket 连接和审计的有界资源策略；
- live/ready/diagnostics 健康端点和非敏感饱和度指标；
- WebSocket replay 分批、慢客户端降级、客户端 single-flight refresh 和指数退避；
- 同设备/跨设备/重复幂等键/慢连接/重启恢复的负载与故障测试。

退出条件：`docs/10-concurrency-and-operability.md` 中的验收指标持续有可复现实测记录；健康探针在负载期间持续可用；所有新增配置和指标均有 schema、契约测试和依赖记录；未扩大到真实平台或设备输入能力。

当前证据：mock 负载自测和 API 并发/事件流/重启恢复测试已通过；历史完整命令记录见
`docs/12-final-release-audit.md`，恢复后的浏览器故障注入和清理记录见
`docs/checkpoints/CP-20260902-loopback-browser-regression.md`。

## 阶段 2.75：宿主机准备与部署规划（本轮新增，进行中）

已完成：

- `host-probe.v1` 无副作用资源/工具状态检查；不通过 PATH、注册表或猜测路径发现工具。
- `provider-manifest.v1` 与保守容量规划，区分控制平面 `max_devices`、宿主机资源和
  provider 上限；启动并发默认不超过 2。
- `loopback.v1` exposure profile 集中边界；未来认证/TLS profile 仅描述，不可直接启用。
- `GET /api/v1/hosts/probe` 与 `GET /api/v1/hosts/providers` 的 OpenAPI、运行时和
  纯函数测试。
- mock-only deployment state domain（`plan`、`validate`、`transition`、desired-state
  更新）的单元/负向测试：容量快照必须由 planner 提供，过量实例、未知字段、非法状态、
  过期 generation、operation 冲突和非 mock provider 均 fail closed；状态记录不包含路径、
  凭据或命令参数。
- 部署状态边界已记录在 `docs/adr/0005-mock-deployment-state-boundary.md`，明确 DTO
  fail-fast 与 domain 防御检查的分层，以及真实 provider 的后续安全门槛。
- `DeploymentController` 的 mock REST 路由及 OpenAPI 请求/响应契约测试；所有写路由要求
  `Idempotency-Key` 与 `operator_confirmed=true`，状态路由校验 `expected_generation`，
  响应/事件只包含脱敏状态。

待完成：

- 目标宿主机上的虚拟化后端、GPU/VRAM、目标 AVD 数据卷和网络/USB 带宽专用检查。
- `system-helper-manifest.v1` 的实际目标宿主机条目、完整 provenance/hash、撤销记录和
  provider-host activation port；当前仓库只有默认空 allowlist 与纯策略校验。
- 将当前 mock-only 控制器扩展为真实 provider 的公开、版本化部署状态控制器，并补齐
  认证/TLS/RBAC/CSRF、provider 命令 allowlist、设备授权和跨进程 provider host 合约；
  在这些门槛完成前不启动 ADB、模拟器、scrcpy 或任何第三方应用。
- Gate C 单实例人工观察及随后 2/4 实例 ramp test；测试结果才能替换估算 profile。
- 当前仓库尚无可安装 mock APK；首个 Gate C 若先行，只能记录空系统 AVD smoke，不得把
  它写成 mock App 状态机验收。

详细规则见 `docs/13-host-preflight-and-deployment.md`。

## 阶段 3：只读 Android 适配器

交付建议：

- 官方 Android Emulator/AVD 或单台实体设备。
- ADB 发现、启动/停止、健康检查和 scrcpy 只读预览。
- 命令 allowlist、低权限子进程、资源配额和急停。

本轮选型结论（2026-09-01）：以官方 Android Studio Emulator/AVD 作为 Gate C
和 mock 设备的首选 provider，先做单实例只读 PoC；不把第三方闭源模拟器加入核心
依赖。9 月 1 日历史快照曾未发现 AVD；截至 9 月 2 日，当前开发机已发现用户创建的
`ticket_test_1`（Android 37 Google APIs、`x86_64`、4 vCPU、2 GiB RAM、10 GiB data），
但尚未启动。Android Emulator `37.1.11.0` 和 ADB `37.0.1` 可由显式路径读取，未发现
scrcpy。固件虚拟化/SLAT 可用，但 `emulator -accel-check` 仍报告 hypervisor driver
未安装，WHPX/Hyper-V 状态需管理员检查。目标宿主机 GPU、虚拟化和并发实例数仍必须
实测并记录；详见 `docs/checkpoints/CP-20260902-host-preflight.md` 与
`docs/13-host-preflight-and-deployment.md`。

当前仓库没有可安装的 Android mock APK/Gradle mock App。加速驱动满足后，Gate C 首次
验收只能限定为空系统 AVD 的冷启动、健康和只读画面 smoke；要验证 mock App 状态机，
需先建立独立 test-only APK 模块及其模块书/checkpoint，不能把空系统 smoke 记作 mock
App 验收。

退出条件：Gate C 通过；人工验收确认系统不自动操作真实第三方 App。

## 阶段 4：可选供应商适配器

Genymotion Desktop 仅作为第二候选；只有在用户明确批准、供应商 EULA/许可证审核、
数据流（拒绝 Cloud 默认）和安全评审后才评估。BlueStacks、雷电等消费级闭源模拟器
不作为核心 provider，只能用于人工观察试验。每个可选适配器独立包、独立测试、独立
开关；不会增加批量输入或购票接口。

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
