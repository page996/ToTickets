# 实施路线图

## 当前状态（2026-09-01）

已由仓库实现和测试确认：pnpm workspace 与隔离工具链、NestJS mock 控制平面、
Tauri + React 控制台基线、内存 repository、`MockDeviceAdapter`、严格且仅允许
loopback 监听的 `runtime-config.v3` 加载与 schema、REST/WebSocket 基线、当前事件 payload schema
及契约测试、人工确认/幂等/有界并发和健康诊断。

阶段 1、阶段 2 和阶段 2.5 已有可运行基线；本轮 R1 离线门禁和 R2 loopback
浏览器回归已完成并记录在 `docs/12-final-release-audit.md`。这只证明 mock-first
控制平面的当前验收范围，不等于真实设备或发布级远程部署验收。

已完成本轮：OpenAPI v1 请求/响应契约及装饰路由契约测试、离线测试/构建/合规/
SBOM/Rust/Tauri 门禁、桌面与 390px 浏览器回归、合法与非法 Origin 验证、API
重启后的控制台 WebSocket 重连验证、宿主机只读探针与 provider 容量规划接口，以及
首次 Git 基线提交并推送到用户指定的 `page996/ToTickets`。

明确待办：认证/TLS/RBAC/CSRF、持久化 SQLite repository、真实设备的只读 Android
适配器、部署状态控制器、Tauri 原生窗口人工验收、发布级运行时 SBOM/provenance
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

待完成：

- 用持久化 SQLite repository 替换当前有界内存 repository，并完成迁移、恢复和保留策略验证。
- 继续补齐 REST schema 细节、审计哈希链和发布级验收证据。

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

当前证据：mock 负载自测和 API 并发/事件流/重启恢复测试已通过；本轮完整命令、计数和
浏览器故障注入结果见 `docs/12-final-release-audit.md`。

## 阶段 2.75：宿主机准备与部署规划（本轮新增，进行中）

已完成：

- `host-probe.v1` 无副作用资源/工具状态检查；不通过 PATH、注册表或猜测路径发现工具。
- `provider-manifest.v1` 与保守容量规划，区分控制平面 `max_devices`、宿主机资源和
  provider 上限；启动并发默认不超过 2。
- `loopback.v1` exposure profile 集中边界；未来认证/TLS profile 仅描述，不可直接启用。
- `GET /api/v1/hosts/probe` 与 `GET /api/v1/hosts/providers` 的 OpenAPI、运行时和
  纯函数测试。

待完成：

- 目标宿主机上的虚拟化后端、GPU/VRAM、目标 AVD 数据卷和网络/USB 带宽专用检查。
- desired/observed deployment state、generation、operation_id 和审计控制器；在
  认证/TLS/RBAC/CSRF 与 provider 命令 allowlist 完成前不启动外部实例。
- Gate C 单实例人工观察及随后 2/4 实例 ramp test；测试结果才能替换估算 profile。

详细规则见 `docs/13-host-preflight-and-deployment.md`。

## 阶段 3：只读 Android 适配器

交付建议：

- 官方 Android Emulator/AVD 或单台实体设备。
- ADB 发现、启动/停止、健康检查和 scrcpy 只读预览。
- 命令 allowlist、低权限子进程、资源配额和急停。

本轮选型结论（2026-09-01）：以官方 Android Studio Emulator/AVD 作为 Gate C
和 mock 设备的首选 provider，先做单实例只读 PoC；不把第三方闭源模拟器加入核心
依赖。当前开发机已发现 Android Studio、SDK、ADB 和官方 Emulator，尚未创建 AVD，
也未发现 scrcpy 或在线设备；虚拟化固件/SLAT 可用，但 Emulator hypervisor driver
尚未安装。目标 Android API/系统镜像、宿主机虚拟化/GPU 和并发实例数仍需在目标
环境实测并记录。宿主机检查与 profile 规则见 `docs/13-host-preflight-and-deployment.md`。

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
