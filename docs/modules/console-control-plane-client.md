# Console 子模块开发书：Control Plane Client

**module_id**：`CON-C3-control-plane-client`（canonical；旧别名 `console.control-plane-client` 仅用于迁移）
**版本**：`console-control-plane-client.v1`
**implementation**：`active`（loopback 浏览器受控复验通过；正式项目内浏览器入口仍有 gap）
**governance**：`partial`（本书聚合多个递归边界，正式 test-only harness 和独立书页尚未闭合）
**负责人边界**：Console transport/config owner；`CON-C6-ui-features` 只消费本模块端口，不拥有 transport 状态
**父模块**：M9-console-contract-ui
**源码边界**：`apps/console/src/api/*`、`apps/console/src/config/runtime-config.ts`、
`apps/console/src/contracts.ts`、`apps/console/src/hooks/use-control-plane.ts`、
`apps/console/vite.config.ts`、`apps/console/scripts/tauri-config-overlay.mjs`、
`apps/console/scripts/run-tauri-with-config.mjs`、`apps/console/src-tauri/src/lib.rs`

## 1. 职责与非职责

职责是读取经校验的运行时 endpoint，通过版本化 REST/WebSocket 合约获取控制面快照、事件
和错误，并把 wire payload 映射为 Console 类型；负责单飞刷新、重连退避、序列同步和
stale 快照状态。

本模块不直接访问 ADB、模拟器、系统 helper、数据库或真实平台；不决定票档、不输入文本、
不识别画面、不执行交易动作。Console 永远不能调用 shell/ADB/scrcpy；未来只能消费经白名单
和人工确认保护的 provider-host/REST 合约。设备/安全命令需要服务端确认票据；日程写操作
遵循其业务规则并携带幂等键，不套用设备序列票据。

## 2. 状态、变量与 owner

### 2.1 ApiClient transport

`ApiClient` 是无持久化状态的 transport/validation 对象，唯一外部依赖是构造器注入的
`ConsoleRuntimeConfig` 和可替换 `fetcher`。请求路径只使用协议相对路径；endpoint、operator
ID、响应字段和枚举在边界处严格校验。`write()` 在调用方未提供 key 时生成
`crypto.randomUUID()`；需要重试/重放一致性时由调用方提供稳定 key。

共享 owner：

| 资源 | owner | 生命周期/保留 |
| --- | --- | --- |
| endpoint、operator ID、刷新/过期阈值 | `parseRuntimeConfig` 返回的冻结 config | 页面/窗口生命周期；不写回源码 |
| fetcher、AbortController | ApiClient/`useControlPlane` 调用方 | 单请求；取消后释放 |
| request/response 映射 | `api-client.ts` 与 `contracts.ts` | 代码版本；不共享 API 内部类 |
| confirmation/幂等键 | 服务端确认/幂等模块；Console 只传递 | 短期服务端 TTL；Console 不落盘 |
| audit/设备/日程快照 | API；hook 持有内存副本 | 页面生命周期；不保存秘密或帧 |

### 2.2 EventStream 与 React orchestration

`ControlPlaneEventStream` 持有 `socket`、`lastSequence`、`streamId`、replay target/gap、
重连计数和 `synchronized`。它只发出 `onEvent`、`onSyncRequired`、`onState` 回调；gap/reset
后的 REST refresh 由 `useControlPlane` 负责。

`useControlPlane` 持有 snapshot、UTC clock anchor、AbortController、单飞协调器、刷新/重连
定时器和 event stream；`App.tsx`/组件只拥有视图、过滤器、pending action 和通知呈现。任何
卸载、Abort、socket close 都不得执行设备动作。

不变量：

- config 不接受凭据、query、fragment 或非 loopback endpoint；未知 wire 字段、非法 UUID/日期/枚举和秘密字段 fail closed；
- 连接前附带 `since`，有 stream ID 时附带 `stream_id`；旧事件丢弃；序列缺口、reset、stream 变化或历史过期触发一次 refresh；
- 同一时刻最多一个 snapshot refresh；错误保留 code/status/retryable/request_id，但不把响应原文秘密写入 UI 日志；
- 设备命令须匹配 confirmation、`expected_sequence` 和可选稳定幂等键；schedule create/cancel/acknowledge 只传业务 DTO 和幂等键；`safety.stop-all` 使用独立 confirmation/command 两个 key 且没有设备序列。

## 3. 函数与端口

当前 REST fetch 没有内建 wall-clock timeout，只有调用方可传 `AbortSignal`；表中“取消”不
应误读为自动超时。服务端错误 code/status 由 `ControlPlaneError` 保留。

| 入口 | 前置条件 | 后置/错误语义 | 超时、幂等 |
| --- | --- | --- | --- |
| `parseRuntimeConfig(candidate)` | 任意未知 JSON | 返回冻结 `console-runtime.v1`，非法 schema/URL/键抛错 | 纯函数；无副作用 |
| `loadRuntimeConfig()` | window/Tauri/dev endpoint 提供 candidate | 先读取 candidate，再必须经过 TS `parseRuntimeConfig`；IPC 本身不是安全批准 | fetch 可 Abort 由调用方控制；无幂等 |
| `ApiClient.listDevices/getDevice` | config 已校验；可选 `AbortSignal` | 严格 Device DTO；transport/error envelope 转 `ControlPlaneError` | GET；重复读取安全 |
| `listSchedules/listAudit/getClock/exportAudit` | config 已校验；audit filters 合法 | 严格分页、日期和字段；拒绝未知字段 | GET；重复读取安全 |
| `deviceCommand/previewCommand/focusDevice` | 允许 intent、confirmation、设备序列；key 可选 | 只发送设备/预览/focus 语义；服务端拒绝保留 `command.stale`、`policy.denied` 等 code | POST；未传 key 自动 UUID，重试应由调用方复用 key |
| `createSchedule/cancelSchedule/acknowledgeSchedule` | schedule DTO/业务状态合法 | 不发送设备 confirmation；服务端按日程规则和人工提醒状态拒绝 | POST/PATCH；未传 key 自动 UUID |
| `issueConfirmation(intent, deviceId?, expectedSequence?, key?)` | intent 属于安全集合；设备 intent 需 ID/序列，stop-all 不得有序列 | 返回短期 ticket；响应 intent/序列不一致视为 `response.invalid` | POST；自动或调用方提供幂等 key |
| `stopAll(keys?)` | 生成/提供 stop-all confirmation；无设备序列 | 返回 stopped/failed；`failed != 0` 视为无效响应 | 两个可复用 key（confirmation、command） |
| `ControlPlaneEventStream.connect/close` | events URL 已校验 | 仅接收 `event-stream.sync.v1`/CloudEvents；重连不回放输入 | 浏览器 socket 生命周期；无自动命令 |
| `nextReconnectDelay/resetReconnectBackoff` | retry policy 已规范化 | 有界指数退避和 jitter；非法 policy 构造时抛错 | 纯内存计数 |
| `SingleFlightRefresh.request/clearPending` | refresh callback 已注入 | 同一时刻最多一个刷新，共享结果 | 内存协调，无外部副作用 |
| `useControlPlane(client, config, filters)` | client/config 已构造 | 维护 snapshot/stale/reconnect；卸载取消请求和 socket | interval/Abort 生命周期由 hook owner 管理 |

## 4. REST/WS 与共享契约 owner

| 方向 | 合约/来源 | 具体语义 | 副作用 |
| --- | --- | --- | --- |
| Console → API | `docs/openapi.v1.json` 的 `/api/v1/devices*`、`/schedules*`、`/audit*`、`/clock`、`/safety/*` | REST JSON、snake_case、`X-Operator-Id`/`Idempotency-Key`；设备安全命令另需 confirmation | 网络请求和服务端审计；UI 不直接操作设备 |
| API → Console | `cloud-event-envelope.v1`、`event-stream.sync.v1` 及各事件 schema | CloudEvents `data.sequence` 单调；sync frame 含 `since`/`stream_id`/reset 信息 | 内存接收；帧不落盘 |
| Console → API WS | `GET /api/v1/events?since=<sequence>&stream_id=<id>` | `ControlPlaneEventStream` 生成查询；server origin/capacity close policy 由 API exposure owner 定义 | 建立/关闭 socket |
| Tauri/dev server → Console | `console-runtime.v1` candidate | Tauri `get_console_runtime_config` 只读取环境候选；TS 必须再次做 schema/loopback 校验；Tauri CSP 另允许固定内部 `http://ipc.localhost` bridge origin，不作为 API/部署 endpoint | 只读取配置 |

`ControlPlaneError` 只保留结构化 `code`、`message`、`request_id`、`retryable`、HTTP status
和脱敏 details；不会把 token、Cookie、绝对路径或屏幕帧写入 UI。schema 漂移由 OpenAPI/事件
契约测试发现，Console `contracts.ts` 不得被 Nest 内部类导入。

## 5. 递归子模块登记

本书覆盖下列边界，但它们尚未全部拥有独立书页，因此 governance 为 `partial`：

| 子模块 ID | 源码边界 | implementation | 连接门槛 |
| --- | --- | --- | --- |
| `CON-C3a-runtime-config` | `apps/console/src/config/runtime-config.ts`、Vite/Tauri config bridge | active | candidate provenance、loopback/未知键负向测试 |
| `CON-C3b-rest-transport` | `apps/console/src/api/api-client.ts` | active | formal test-only fetch port、OpenAPI drift |
| `CON-C3c-event-stream` | `apps/console/src/api/event-stream.ts` | active | formal fake socket port、gap/reset/close evidence |
| `CON-C3d-refresh-orchestration` | `single-flight-refresh.ts`、`use-control-plane.ts` | active | formal clock/Abort harness、restart recovery |
| `CON-C3e-wire-contracts` | `apps/console/src/contracts.ts` | active | generated/checked schema owner |
| `CON-C3f-tauri-bridge` | `apps/console/src-tauri/src/lib.rs`、`apps/console/scripts/*` | active | project toolchain/provenance、native window acceptance |
| `CON-C3g-test-harness` | Console specs and synthetic fixtures | planned | `console.control-plane-client.test.v1` formal harness |

`CON-C6-ui-features` 是本书的消费者，不因 App 组件存在而归入 transport owner。

## 6. 专用测试入口与证据

已有可注入 seams，但尚未统一登记为正式 `console.control-plane-client.test.v1` port：

- `ApiClient` 的 `fetcher` 注入用于 `apps/console/src/api/api-client.spec.ts`；
- `ControlPlaneEventStream` 的 fake `WebSocket`、retry policy/random 注入用于 `event-stream.spec.ts`；
- `parseRuntimeConfig`、`isLoopbackHostname` 和依赖计算函数用于 `runtime-config.spec.ts`/`vite-boundary.spec.ts`；
- hook/component specs 使用合成 API 响应、时钟和 UI 事件，不连接真实账号或设备。

历史验证证据（2026-09-01，旧阶段）：

- `docs/12-final-release-audit.md` 记录 2026-09-01 历史阶段的 API 18 suites/183 tests、Console 9 files/81 tests、typecheck/build、load self-test、合规/SBOM/Rust/Tauri 和 loopback 浏览器回归；本阶段新增 M13 后 API 当前为 19 suites/203 tests（详见 host-preflight checkpoint），Console 仍为 9 files/81 tests。Console 的 9 个文件包括 `apps/console/scripts/tauri-config-overlay.spec.mjs`，不应误写成全部位于 `src`；
- 当前可见的 Console `src` 测试由 `api-client.spec.ts`、`event-stream.spec.ts`、`runtime-config.spec.ts`、`single-flight-refresh.spec.ts`、hook/component specs 等组成；overlay spec 由脚本测试入口单独执行；
- 旧阶段只读校验命令为 `git diff --check` 与模块文档字段/路径扫描，未启动 API/Vite/Tauri/AVD/ADB，也未执行外部网络动作。

本轮 R2 受控复验（2026-09-02）见 [`CP-20260902-loopback-browser-regression`](../checkpoints/CP-20260902-loopback-browser-regression.md)：
API `59235`、Vite `59236` 使用动态 loopback 端口，1440px/390px 四视图、合法/非法
Origin、停机/重启恢复均通过，截图和日志保存在被忽略的 `.runtime` 目录。浏览器 runner
来自显式注入的 Codex 隔离 Playwright runtime 与宿主机 Edge，未进入项目 manifest/lock/SBOM；
因此这是一份 `verified_with_gap` 的 host-assisted 证据，不能替代干净 checkout 的正式
test-only 入口。

持续负向测试和审计断言必须覆盖：非法/非 loopback endpoint、凭据/query/fragment、未知 wire
字段、错误 envelope、序列回退/缺口、慢连接/Abort、重复刷新和服务重启后的重新同步；当前
慢连接、真实 Abort、正式浏览器入口和跨进程恢复仍是治理缺口，不能仅从 host-assisted
浏览器回归推断已完成。

## 7. Helper 边界、连接门槛与人工验收

Console 不拥有或启动 `system-helper-manifest.v1` 条目，也不能直接调用 shell、ADB、
emulator、scrcpy 或 provider binary。未来 helper/provider 只能由 API/Provider Host 按白名单
路径、版本、hash、许可证、参数/环境、资源/数据流、停止/审计/回滚规则提供版本化结果；
Console 只消费 schema，并在 endpoint/config 校验失败时 fail closed。

连接 API 前必须通过 `console-runtime.v1` 校验并由 Tauri/开发服务器提供运行时 candidate；
URL 和端口不能编译进资源。浏览器回归只证明 loopback mock 控制面，不能证明 AVD、helper 或
真实平台兼容。Tauri 原生窗口人工验收、host readiness 展示和 deployment 状态 UI 是后续
独立 gate；真实大麦登录、验证码、选票、下单和支付始终由用户人工完成。

## 8. 结论分类与 checkpoint

| 类别 | 本模块结论 |
| --- | --- |
| 已由代码/测试确认 | endpoint loopback/字段校验、REST/WS wire mapping、单飞刷新、序列同步/重连退避、设备命令 confirmation 传递和 schedule 幂等写边界；历史全量证据见 `docs/12-final-release-audit.md` |
| 工程假设 | formal test harness、host/provider/deployment consumer、跨进程恢复和 authenticated-TLS exposure 可按当前端口扩展，但尚未实现 |
| 待用户/平台确认 | Console 受控测试环境的具体部署、Tauri 原生窗口验收、目标宿主机 provider、真实 APK 兼容性及任何供应商/EULA |

首次登记关联 `CP-20260902-module-governance-baseline`；本书不授权放宽 loopback 或启动
外部进程。ApiClient、事件协议、runtime config 或 hook 状态语义变更时，必须更新 schema、
契约测试和新的 checkpoint；回滚恢复到最近已验证 checkpoint，不删除证据。

待办：建立 `console.control-plane-client.test.v1` harness；为递归子模块建立独立书页；
补 host/provider/deployment consumer 的明确接线决策；补慢连接/Abort/跨进程恢复负向证据；
完成 Tauri 原生窗口人工验收，并在未来 exposure 变更前完成认证/TLS/RBAC/CSRF/WS 握手认证。

## 9. 2026-09-03 release runtime/IPC/WS smoke

本次程序化 release 运行证据追加在 [`CP-20260903-console-tauri-acceptance.md`](../checkpoints/CP-20260903-console-tauri-acceptance.md)
和 `.runtime/r2-console-tauri-release-20260903/`。release binary
`apps/console/src-tauri/target/release/human-assist-console.exe` 在显式 loopback API
端口 `59701` 下启动，WebView2 CDP 使用 `50131`，SHA-256 为
`22F50D6BAC64C029E904B5BA56157CC83CBFA457443EB11C17C379B9051F2358`。生成的 CSP 只
允许固定内部 `http://ipc.localhost` 与本次注入的 API/WS loopback origin；不增加外部
host、通配符或 API CORS 来源。

`browser-evidence.json` 显示 1 个合成设备、1 条提醒和 2 条审计；5 个 REST URL、一个
sync 帧和 2 个 CloudEvent 帧均被观察，console/page errors 为 0。release 窗口关闭后，
`runtime-after-stop.json` 记录 `closeMainWindow=true`、release/API 目标进程和监听均已
消失，仅保留用户 `entity1`/ADB。该结果属于程序化 runtime/IPC/WS smoke，不是用户
人工签收；此前 dev/旧 release 运行记录只作为历史证据保留。Tauri 用户人工验收、真实
APK 和真实只读 provider 仍是待确认门槛。

与本模块相关的下一项跨模块门槛是 `entity3 + entity5` 低资源双实例固定窗口；完成前
不启动 `entity4`，不激活 helper/provider，也不改变 loopback exposure 或部署默认值。
