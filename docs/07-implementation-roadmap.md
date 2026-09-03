# 实施路线图

## 当前状态（截至 2026-09-03；历史段落按各自时间标注）

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
  在这些门槛完成前不得由项目 helper/provider 自动启动 ADB、模拟器、scrcpy 或任何
  第三方应用；经用户单独批准并绑定 checkpoint 的 operator-run 观察不等同于项目接入。
- Gate C 单实例人工观察及随后 2/4 实例 ramp test；当前已完成空系统 smoke、双实例窗口和
  第三实例保护探测，但仍不能用结果替换估算 profile 或宣称安全容量；后续只在低资源
  profile/更大宿主机决策后继续扩展。
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
依赖。9 月 1 日历史快照曾未发现 AVD；9 月 2 日预检快照显示开发机已发现用户创建的
`ticket_test_1`（Android 37 Google APIs、`x86_64`、4 vCPU、2 GiB RAM、10 GiB data），
当时尚未启动（该句为预检时点事实）。Android Emulator `37.1.11.0` 和 ADB `37.0.1` 可由显式路径读取，未发现
scrcpy。固件虚拟化/SLAT 可用，但预检时点的 `emulator -accel-check` 仍报告 hypervisor
driver 未安装，WHPX/Hyper-V 状态需管理员检查；后续 operator-run 运行日志另有 WHPX
operational 证据，二者不能混作同一时点。目标宿主机 GPU、虚拟化和并发实例数仍必须
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

## 2026-09-03 Gate C 进度补充

用户已完成 `ticket_test_1` 空系统 AVD 的首次人工 smoke：冷启动到 Android 页面约 90
秒，可到达 Google 加载页和 Android 桌面，画面可持续刷新并支持人工手机式操作；用户
报告可持续操作且画面正常（未定义时长）。详情和只读交叉核对见
`docs/checkpoints/CP-20260902-gate-c-empty-avd-smoke.md`。

该结果只关闭“单实例空系统启动/人工观察”的子项，Gate C 总体仍为
`verified_with_gap`。双实例约 15 分钟量级资源窗口已补齐，但真正挂起/恢复、单实例重复
与定时 soak、低资源 profile 下的 `1 -> 2 -> 4` ramp、目标宿主机复测、mock APK test-only
harness、helper manifest/provider-host 和真实平台人工验收仍未完成。旧的 2026-09-01 发布审计段落
保留其历史时间点，不因本补充而改写；当前部署仍只允许 loopback。

同一阶段（旧 ramp run）已在保留 `ticket_test_1` 的前提下完成两个独立 writable clone 的 operator-run
并行观察：`ticket_test_2`/`entity2` 与 `ticket_test_3`/`entity3` 均 boot 成功，三台 qemu
工作集合计约 13.93 GiB、私有内存约 13.41 GiB，宿主 commit 约 96.5%；第 4 台按停止
门槛未启动，新增实例随后已精确退出。静态 2 GiB/GPU off 被运行时覆盖为 4096 MiB/GPU
host；该结果只更新 Gate C 的压力证据，不更新 `safe_instances` 或部署默认值。详见
`docs/checkpoints/CP-20260902-gate-c-ramp-2-4.md`。

### 2026-09-03 多实例 follow-up 门槛

用户批准继续增加实例后，已完成双实例固定窗口、第三实例带保护启动探测和回收后稳定
窗口；详细证据见 `docs/checkpoints/CP-20260903-gate-c-multi-followup.md`。当前有效结论
是：现有 profile 本轮可验证的短时观察上限为 2 台；第三台在 Android boot 前使 commit
达约 95.98%，因此安全扩展门槛被触发；第 4 台未启动（`entity4` 仅配置文件）。这不更新 provider 的
`safe_instances`/API `max_devices`，也不表示真实 APK 或串流并发能力。

下一阶段依赖重大决策：选用真正生效的低 RAM/图形 profile，或改用更大提交内存的宿主机；
在该决策前只做单实例 repeat/soak、15 分钟资源与 I/O/GPU 观测，不继续当前 profile 的
第 4 台压力试验。

2026-09-03 追加的双实例延长基线已覆盖约 15 分钟量级资源窗口（实际采样 914.2 秒，
含明确记录的分段间隔）；两台健康、commit `81.446--83.260%`。这只关闭了当前 profile
的一项短时资源观察，不改变低资源 profile、GPU/I/O 归因、目标宿主机复测、mock APK
和真实 provider 的未完成状态。

### 2026-09-03 文档状态更正

前述路线图中的 OpenAPI “待完成”描述只适用于当时的未覆盖范围。当前
`docs/openapi.v1.json` 已覆盖现有装饰路由的请求、成功响应和错误 envelope，且
`apps/api/test/openapi-contract.spec.ts` 已纳入每个路由的契约检查；因此 OpenAPI v1
基础契约状态为“已由代码/测试确认”，后续只需随 schema 变更持续维护。完整发布仍不等于
OpenAPI 完成：认证/TLS/RBAC/CSRF、SQLite、真实只读 adapter、Tauri 原生验收和正式
provider-host 仍按本路线图的未完成门槛执行。

同理，双实例约 15 分钟量级观察已经有独立 checkpoint；当前 profile 的下一步不是重复
该窗口，而是先选择并验证真正生效的低 RAM/低图形 profile，或改用更大提交内存宿主机，
然后再做固定时长 repeat/soak 与受保护 ramp。

### 当前门槛索引（2026-09-03）

- 已由代码/测试确认：API/Console 契约、隔离门禁、OpenAPI v1 基础覆盖和 mock 控制平面。
- 已由人工/运行证据确认：空系统 AVD 单实例 smoke，以及当前有效 profile 的双实例约 15
  分钟量级观察；第三实例保护停止规则已实际触发。
- 待用户/平台确认：真正生效的低资源 profile 或更大宿主机、目标宿主机专用 preflight、
  固定时长 repeat/soak、按进程 GPU/I/O 归因、mock APK test-only 模块和真实只读 provider。

在上述选择完成前，不启动 `entity4`，不把双实例观察写成 `safe_instances=2`，也不激活
真实 helper/provider。人工验收完成后仍按既定顺序进入 SQLite；系统通知策略最后单独讨论。

GPU follow-up 已在 `docs/checkpoints/CP-20260903-gpu-renderer.md` 登记：`host` 可选中
宿主 NVIDIA GPU，`swiftshader_indirect` 可选中内置 SwiftShader；两者只作为低资源 profile
候选输入。缺失 `opengl32sw.dll` 的 legacy software 路径仍是风险，不改变 provider、
`safe_instances`、`max_devices` 或部署默认值。

### 2026-09-03 低资源 profile 评估结果

用户已选择低资源优先。对独立 `entity3` 完成两种 operator-run 候选观察：单独传入
`-memory 2048 -gpu off` 的候选被 Emulator 日志提升为 `4096MB`，不接受；加入
`-lowram -cores 2 -memory 2048 -gpu software` 后，effective 配置为 2 核/2 GiB/heap
512，QEMU Private 约 3.55 GiB，5 分钟窗口 commit `84.30--84.80%`，可作为下一轮
ramp 的候选输入。GPU software 因本机 `opengl32sw` 缺失回落 `lavapipe`，图形后端仍是
独立风险。

该结果只是“现有 baseline 实例 + 一个低资源候选”的混合观察，不构成两台低资源实例的
容量证明，也不更新 `provider-manifest.v1`、`safe_instances` 或 API `max_devices`。下一门槛
是独立第二个低资源 writable clone 的固定窗口和受保护 `1 -> 2 -> 4` ramp；在此之前不启动
`entity4`，不改变生产默认值。详细报告见
`docs/checkpoints/CP-20260903-low-resource-profile.md`。

### 2026-09-03 entity5 低资源单实例观察

用户批准建立的 `ticket_test_5`/`entity5` 已完成一次独立低资源候选观察：Android 37
Google APIs `x86_64`，运行时参数为 `-lowram -cores 2 -memory 2048 -gpu host`，effective
配置为 2 核、2048 MiB、heap 512；5 分钟 30 样本窗口全程 ADB/boot/进程健康，Free RAM
最低 `11.359 GiB`，commit `87.126--87.730%`，QEMU Private `3.615--3.758 GiB`。
原始启动命令、PID、effective 配置哈希、Settings smoke 和停止证据见
`docs/checkpoints/CP-20260903-low-resource-entity5.md`。

该结果是用户批准的 operator-run 单实例事实，不是 M11 planner、helper 或 provider
激活；commit 高于 `<=85%` 启动规划线，不能把它解释为安全容量，也不更新
`safe_instances`、`max_devices` 或部署默认值。它补齐了第二个低资源候选的单实例输入，
但尚未证明两个低资源实例并行稳定。下一门槛为低资源双实例固定窗口和受保护
`1 -> 2 -> 4` ramp，并分别收集 GPU/I/O、温度、磁盘写入及目标宿主机 preflight；在此
之前不启动 `entity4`，不改变真实 adapter/helper 边界。

### 2026-09-03 Tauri release runtime smoke

在重新构建 release 二进制后，使用动态 loopback API `59701`、WebView2 CDP `50131` 启动
`human-assist-console.exe`，release SHA-256 为
`22F50D6BAC64C029E904B5BA56157CC83CBFA457443EB11C17C379B9051F2358`。程序化证据记录
在 `.runtime/r2-console-tauri-release-20260903/browser-evidence.json` 及同目录
`runtime-before-stop.json`/`runtime-after-stop.json`：1 个合成设备、1 条提醒、2 条审计，
5 个 REST URL、WebSocket sync+2 事件帧，console/page errors 为 0；release 窗口关闭和
目标监听均已确认清理。

该结果只关闭 release runtime/IPC/WS 的程序化 smoke 子项，不等同于用户人工 Tauri
签收，也不覆盖真实 APK/真实平台兼容性。此前 dev/旧二进制证据保留为历史时点；阶段 2
的人工验收门槛仍在。下一门槛改为先对 `entity3 + entity5` 做低资源双实例固定窗口，
再按保护规则执行 `1 -> 2 -> 4` ramp，并补齐 GPU/I/O、温度、磁盘写入和目标宿主机
preflight；不启动 `entity4`，不改变 helper/provider 默认值。
