# 总体架构

## 1. 架构原则

1. 人在回路：真实第三方 App 的关键动作不进入自动化控制面。
2. mock-first：所有自动化状态机和设备编排先在本地 mock App 验证。
3. 最小权限：设备适配器按能力白名单暴露；默认只读。
4. 可替换：模拟器、画面传输和存储都通过端口/适配器隔离。
5. 可审计：每个命令、提醒、人工确认和拒绝都具有关联 ID、操作者和结果。
6. 本地优先：默认绑定由配置指定的本机接口，不上传画面，不依赖云端账号；源码不包含固定地址或端口。

## 2. 逻辑分层

```text
┌──────────────────────────────────────────────────────────────┐
│ Console UI (Tauri + React/TypeScript)                       │
│ 设备网格 / 画面焦点 / 日程提醒 / 人工状态 / 审计查询        │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST + WebSocket (versioned JSON)
┌───────────────────────▼──────────────────────────────────────┐
│ Control Plane API                                            │
│ AuthZ · command gate · schedule · audit · config validation  │
└───────────┬────────────────┬────────────────┬────────────────┘
            │                │                │
  ┌─────────▼──────┐ ┌───────▼────────┐ ┌─────▼─────────────┐
  │ Device Registry │ │ Time/Reminder  │ │ Audit/Security    │
  │ & Lifecycle     │ │ Service        │ │ Service           │
  └─────────┬──────┘ └───────┬────────┘ └─────┬─────────────┘
            │                │                │
  ┌─────────▼────────────────▼────────────────▼─────────────┐
  │ Adapter Ports: DeviceAdapter / ScreenStream / Clock     │
  └─────────┬──────────────────────┬────────────────────────┘
            │                      │
  ┌─────────▼─────────┐  ┌─────────▼────────────────────────┐
  │ MockAdapter        │  │ ReadOnly Android Adapter         │
  │ mock App + fixtures│  │ ADB/AVD + scrcpy diagnostics     │
  └─────────────────────┘  └──────────────────────────────────┘
```

Appium/uiautomator2/Maestro and Playwright belong only below `MockAdapter` or in a test harness. A production adapter must not import a test driver package that can issue arbitrary UI actions.

## 3. 可部署单元

### 3.1 `console-ui`

Displays device cards, a selected screen preview, schedule state, confirmation controls and audit summaries. It never stores secrets in local storage. Every command includes an explicit confirmation dialog and a short-lived idempotency key.

### 3.2 `control-plane`

Owns authorization, validation, state transitions, scheduling and event publication. It is the only component allowed to invoke adapters. The service rejects unknown commands, batch input, purchase-like verbs and commands addressed to more than one device when an input capability is requested.

### 3.3 `device-adapter-host`

Runs provider-specific processes. It exposes discovery, connect, disconnect, health and screenshot/stream metadata. Process arguments are constructed from typed values, not shell strings; executable paths and flags are allowlisted.

### 3.4 `mock-app-harness`

Ships a synthetic Android app with states such as `login_required`, `human_verification`, `ready`, `human_processing`, `success` and `failure`. It contains no real platform branding, account fields or payment screens. Automated tests may drive it.

### 3.5 `storage`

当前可运行基线使用按容量和保留期限制的进程内 repository，便于 mock-first 契约和并发模型验证，进程重启后数据重置。SQLite 是后续单用户持久化适配器的候选：设备、日程和审计已通过独立 repository provider 隔离，替换实现时不得改变 REST/WebSocket 合约。秘密和画面帧在两种实现中都排除在 schema 之外。

## 4. 状态机

### 4.1 设备状态

```text
offline -> discovering -> booting -> ready -> waiting
   ▲          │             │          │       │
   └──────────┴─────────────┴──────────┴───────┘
                   error / stopped
```

Allowed transitions are server-side and monotonic per `sequence`. A stale adapter event cannot move a device backwards. `waiting` means the device is ready for the human operator; it does not mean the third-party page is ready or that a purchase can be made.

### 4.2 人工任务状态

```text
draft -> scheduled -> notified -> human_confirmed ->
  human_processing -> completed | failed | cancelled | expired
```

`human_confirmed` is an acknowledgement that the operator saw a reminder. It is not an authorization for an automated action. The server rejects transitions that attempt to skip directly to `completed` or `human_processing` without an operator event.

## 5. 数据流与边界

1. UI sends a typed command to the control plane over the configured local HTTPS/WebSocket endpoint. The endpoint is loaded from validated configuration, never compiled into the UI.
2. Control plane validates role, target cardinality, capability policy, TTL and idempotency key.
3. Adapter host performs only the allowlisted lifecycle/read-only operation.
4. Adapter emits a versioned event with `device_id`, `sequence`, health fields and redacted error text.
5. Control plane persists the minimum audit record and broadcasts a redacted event to subscribed UI clients.
6. Screen frames are streamed in memory to the focused client; persistence is disabled by default.

No component receives a password, OTP, ID number, payment credential, full cookie, bearer token or unredacted payment QR code.

## 6. 可扩展性与资源上限

所有配额均为必填运行时配置，不存在编译默认值：设备/日程数量、单一预览流、WebSocket 客户端与缓冲、入站帧、replay 批次与窗口、幂等缓存、确认票据、事件历史、审计条数与保留天数。超过限制会拒绝新工作、要求客户端取完整快照、淘汰最旧内存审计，或仅关闭慢连接；不会静默排队任何设备输入。

## 7. 故障策略

| 故障 | 行为 |
| --- | --- |
| Adapter disconnect | mark device `error`, stop stream, notify operator, allow explicit reconnect |
| Clock drift > configured tolerance | mark schedule `clock_uncertain`, suppress “ready” reminder until corrected |
| WebSocket loss | UI shows stale age; server continues audit; reconnect requires resync by sequence |
| Duplicate command | return original result for same idempotency key |
| Unauthorized capability | reject with stable error code and audit `policy.denied` |
| Storage unavailable | fail closed for commands; retain only bounded in-memory diagnostics |
| Process crash | supervisor restarts adapter, never replays input; state returns to `discovering` |

## 8. 关键架构决策

- v1 backend: NestJS + TypeScript（已冻结）；FastAPI/Python 仅为调研对照，不进入运行时。
- v1 desktop: Tauri + React/TypeScript（已冻结）；Electron 不进入实现路线。
- v1 transport: REST + native WebSocket; Socket.IO is deferred until cross-network reconnection requirements justify it.
- v1 observability: structured local logs plus OpenTelemetry-compatible metrics; no third-party cloud exporter by default.

## 9. 配置与路径解析

- `ConfigModule` 负责读取 schema 版本、绑定地址/端口、数据目录、工具目录、资源配额和日志策略。
- 配置只允许项目相对路径或用户显式选择的绝对路径；服务端启动时解析为规范化路径并检查权限，拒绝路径穿越和不存在的可执行文件。
- UI 只接收服务端下发的短期 endpoint/token，不在构建产物中嵌入环境地址。
- Android SDK、ADB、scrcpy 和模拟器路径由 provider manifest 声明；不得假设 Windows 注册表、`PATH` 或固定安装目录。
