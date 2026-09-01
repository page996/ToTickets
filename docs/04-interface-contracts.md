# 接口与事件契约

## 1. 通用约定

- API 前缀：`/api/v1`
- API 前缀是协议常量；服务绑定地址和端口由配置提供，不能在客户端或服务端源码中硬编码。
- 媒体类型：`application/json; charset=utf-8`
- 时间：RFC 3339 UTC，例如 `2026-08-25T08:00:00Z`
- ID：UUID v4；设备供应商 ID 作为不透明字符串保存
- 所有写命令都要求 `Idempotency-Key`，有效期由配置限定为 30-600 秒
- 所有响应都含 `request_id`；错误含稳定 `code`、可读 `message` 和可选 `retryable`
- 不传输秘密字段；服务端遇到未知字段默认拒绝（strict schema）
- JSON wire 字段统一使用 `snake_case`；控制台如使用 `camelCase` domain model，必须只在 API client 边界显式转换。
- 设备和日程列表使用 `{"request_id":"...","items":[]}` collection envelope；审计分页额外包含 `page`、`page_size` 和 `total`。单资源响应在资源字段同层包含 `request_id`。
- 幂等键按“认证操作者主体 + 端点操作作用域 + 规范化请求载荷”计算指纹；同键同指纹的并发请求只执行一次，同键跨主体、跨作用域或载荷不一致返回 `idempotency.replay`。

## 2. 资源模型

### 2.1 Device

```json
{
  "id": "4e9d7f6f-2ec7-43ad-9f1e-4b24e2bcb1e5",
  "alias": "主设备-01",
  "provider": "android-emulator",
  "transport": "adb",
  "state": "ready",
  "capabilities": {
    "lifecycle": true,
    "health_read": true,
    "screen_preview": true,
    "user_input": false,
    "automation": false
  },
  "last_seen_at": "2026-08-25T08:00:00Z",
  "sequence": 42
}
```

`user_input` 和 `automation` 必须由服务端策略生成，客户端不能自行设为 `true`。生产适配器的 `automation` 永远为 `false`。

`last_seen_at` 来自控制平面按配置周期读取的 `DeviceAdapter.health()`，使用单调时钟锚定的时间计算。健康快照的状态未变化时可以更新该时间，但不能改变设备 `sequence` 或发布伪造的“状态变化”事件；状态实际转换时才同时推进 `sequence`、发布 `device.health.changed` 并写入审计。事件中的 `heartbeat_age_ms` 必须来自经过范围校验的适配器结果或控制平面基于最后成功观测计算的有界值，不能硬编码为零。

### 2.2 Schedule

```json
{
  "id": "c94e1f66-94b5-4d65-a3a4-4fb0e31dfcab",
  "label": "演出准备提醒",
  "public_reference": "https://example.invalid/event/fixture",
  "starts_at": "2026-09-01T12:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "reminders": [
    {"offset_seconds": -900, "channel": "desktop"},
    {"offset_seconds": -60, "channel": "sound"}
  ],
  "state": "scheduled"
}
```

`public_reference` 只接受用户提供的公开 URL，并在存储时进行协议/域名策略校验；不抓取其内容。

### 2.3 AuditEvent

```json
{
  "id": "b2ef1aa9-dc52-4f3e-91cf-2a71a7b6f62a",
  "type": "device.lifecycle.started",
  "occurred_at": "2026-08-25T08:00:01Z",
  "operator_id": "local-user",
  "device_id": "4e9d7f6f-2ec7-43ad-9f1e-4b24e2bcb1e5",
  "correlation_id": "9fb70dcb-5a72-4cd2-b45c-0ee560ecf4df",
  "policy_version": "2026-08-25.1",
  "result": "accepted",
  "metadata": {"source": "console-ui"}
}
```

`metadata` 只能使用白名单字段；拒绝审计可包含 `error_code`、`confirmation_id` 和 `intent` 以便关联原始请求；禁止原始命令、屏幕 OCR、URL 查询参数中的 token 或异常堆栈中的秘密。

## 3. REST 端点

### 3.1 设备

| 方法 | 路径 | 说明 | 备注 |
| --- | --- | --- | --- |
| GET | `/devices` | 列出设备快照 | 支持 `state`/`group` 过滤 |
| POST | `/devices` | 注册设备 | 不接受密码、token 或任意 shell 参数 |
| GET | `/devices/{id}` | 读取设备 | 返回能力和序列号 |
| POST | `/devices/{id}/commands/start` | 启动 | 需操作者确认和幂等键 |
| POST | `/devices/{id}/commands/stop` | 停止 | 可急停，不重放输入 |
| POST | `/devices/{id}/commands/reconnect` | 重连 | 仅生命周期操作 |
| POST | `/devices/{id}/preview/start` | 开始只读预览 | 同时最多一个焦点流 |
| POST | `/devices/{id}/preview/stop` | 停止预览 | 立即释放帧缓冲 |
| POST | `/devices/{id}/focus` | 设为焦点 | 不产生设备输入 |

服务端必须拒绝不存在的路径，例如 `/click`、`/input`、`/purchase`、`/captcha`、`/pay`、`/broadcast`、`/batch-input`。

### 3.2 日程与提醒

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/schedules` | 列出日程 |
| POST | `/schedules` | 创建日程 |
| PATCH | `/schedules/{id}` | 修改日程（开始后只允许取消） |
| POST | `/schedules/{id}/acknowledge` | 记录人工看到提醒 |
| GET | `/clock` | 返回服务器时钟、偏差和可信度 |

提醒确认不会触发设备命令；其唯一副作用是审计和 UI 状态变化。创建或修改提醒时，每个 `starts_at + offset_seconds` 目标都必须严格晚于当前控制平面时间；已经错过的提醒窗口以 `422 schema.invalid` 拒绝，不会立即补发或静默改变日程状态。日程进入 `completed`、`failed`、`expired` 或 `cancelled` 后不可再修改；取消请求只能包含 `{ "state": "cancelled" }`。

### 3.3 审计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/audit` | 分页查询脱敏事件 |
| GET | `/audit/export` | 导出脱敏 JSON |
| POST | `/safety/stop-all` | 停止所有适配器进程 | 不发送任何输入；管理员权限 |

### 3.4 健康与诊断

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health/live` | 进程和事件循环存活；不访问设备或外部工具 |
| GET | `/health/ready` | 核心配置、repository 与事件总线就绪 |
| GET | `/health/diagnostics` | 非敏感容量、队列、拒绝、淘汰和单调 uptime |

诊断响应不得包含绑定地址、端点、路径、环境变量、凭据、设备画面或命令载荷。容量达到上限时 `ready.status` 可以为 `degraded`，但端点仍返回 HTTP 200，确保操作者能够读取原因并恢复。

### 3.5 宿主机检查与 provider 规划

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/hosts/probe` | 无副作用读取宿主机资源、虚拟化/GPU 未探测项和显式工具选择状态 |
| GET | `/hosts/providers` | 返回 `provider-manifest.v1` 规划 profile、资源保留后的估算容量和启动并发上限 |

`/hosts/probe` 的响应 schema 为 `host-probe.v1`，固定包含 `side_effects: "none"`。
探针不得启动 ADB、模拟器、scrcpy 或其他外部进程；未选择的工具报告
`not_checked`，不存在的显式工具报告 `fail`，且不回显绝对路径。GPU、虚拟化后端或
目标数据卷无法从无副作用 API 确认时必须标记 `unknown`，不能猜测通过或把容量强制
置零。

`/hosts/providers` 只返回规划数据，不代表 provider 已部署；`safe_instances` 是宿主机
与 provider 的估算，`control_plane_limit` 是当前 API 的 `max_devices`，
`effective_instances` 是二者较小值。所有 manifest 都必须
声明 `user_input=false` 和 `automation=false`。容量估算使用宿主机当前可用资源、
固定保留量和 provider 的每实例 profile；实际并发数只有在目标宿主机 ramp test
和人工验收后才能确认。远程 provider 不得在响应或日志中出现云凭据、项目令牌或
真实账号信息。

### 3.6 人工确认票据

设备生命周期、只读预览、焦点切换和急停均使用服务端签发的一次性票据。控制台显示确认对话框后，先提交：

```json
{
  "operator_id": "local-user",
  "device_id": "4e9d7f6f-2ec7-43ad-9f1e-4b24e2bcb1e5",
  "intent": "device.start",
  "confirmed": true,
  "expected_sequence": 42
}
```

至 `POST /safety/confirmations`。设备级 intent 必须绑定单一设备，并把最近一次
REST 设备快照的 `sequence` 作为 `expected_sequence`；服务端签发票据前会再次读取
当前设备序列。`safety.stop-all` 不接受 `device_id` 或 `expected_sequence`。响应为：

```json
{
  "request_id": "f75ddafb-98e4-4b19-a6fe-78c690627219",
  "confirmation_id": "c959f443-f823-4f48-9073-ef0ea277511d",
  "intent": "device.start",
  "expires_at": "2026-08-25T08:01:00Z",
  "expected_sequence": 42
}
```

设备命令随后提交 `operator_id`、`confirmation_id`、匹配的 `intent`，以及响应中
回显的同一 `expected_sequence`。执行前服务端再次核对票据序列、请求序列和当前
设备序列；设备在确认后发生任何状态变化时返回 `409 command.stale`，作废该票据，
客户端必须刷新 REST 快照并重新请求人工确认，不能自动重试旧命令。`expires_at` 由
服务端判定，客户端不得自行生成票据或过期时间。票据仅可消费一次，并同时绑定
操作者、intent、设备和设备序列。`safety.stop-all` 的确认和命令均省略
`expected_sequence`；日程 `/acknowledge` 只记录“人工已看到”，不使用危险命令票据。

## 4. WebSocket

首次连接：`GET /api/v1/events?since=<sequence>`。收到首次同步控制帧后，重连请求同时携带服务实例游标：`GET /api/v1/events?since=<sequence>&stream_id=<stream-id>`。

每次连接先收到协议控制帧，再收到可回放的 CloudEvents：

```json
{
  "protocol": "event-stream.sync.v1",
  "stream_id": "cc5325aa-d397-47ad-a7dd-3e2c81349f63",
  "current_sequence": 43,
  "oldest_available_sequence": 12,
  "reset_required": false
}
```

该控制帧不是业务事件，其版本化 schema 位于 `docs/schemas/event-stream-sync.v1.json`。`reset_required=true` 表示服务进程已更换、客户端游标超前，或游标早于保留窗口；此时服务端不回放局部历史，客户端把游标更新为 `current_sequence` 并重新请求完整 REST 快照。

事件 envelope：

```json
{
  "specversion": "1.0",
  "type": "device.health.changed",
  "source": "control-plane",
  "id": "5e3dc9d6-bc75-4fb9-bb93-07ec54228c1a",
  "time": "2026-08-25T08:00:03Z",
  "subject": "device/4e9d7f6f-2ec7-43ad-9f1e-4b24e2bcb1e5",
  "datacontenttype": "application/json",
  "schema": "https://example.invalid/schemas/device-health-changed.v1.json",
  "data": {
    "sequence": 43,
    "device_id": "4e9d7f6f-2ec7-43ad-9f1e-4b24e2bcb1e5",
    "state": "ready",
    "heartbeat_age_ms": 120,
    "stream": "stopped",
    "device_sequence": 42
  }
}
```

envelope 由 `docs/schemas/cloud-event-envelope.v1.json` 约束；业务 payload 的
schema 文件名由事件 `type` 将非字母数字字符替换为 `-` 后追加 `.v1.json`。
当前实现发布的事件与 schema 映射如下：

| event type | payload schema |
| --- | --- |
| `device.health.changed` | `docs/schemas/device-health-changed.v1.json` |
| `screen.stream.started` | `docs/schemas/screen-stream-started.v1.json` |
| `screen.stream.stopped` | `docs/schemas/screen-stream-stopped.v1.json` |
| `device.focus.changed` | `docs/schemas/device-focus-changed.v1.json` |
| `schedule.created` | `docs/schemas/schedule-created.v1.json` |
| `schedule.updated` | `docs/schemas/schedule-updated.v1.json` |
| `reminder.acknowledged` | `docs/schemas/reminder-acknowledged.v1.json` |
| `clock.uncertain` | `docs/schemas/clock-uncertain.v1.json` |
| `reminder.fired` | `docs/schemas/reminder-fired.v1.json` |
| `reminder.dispatch.failed` | `docs/schemas/reminder-dispatch-failed.v1.json` |

上述 payload schema 均为严格对象 schema，要求 `sequence` 事件游标并拒绝未知字段。

客户端必须按当前 `stream_id` 内的 `sequence` 去重，并在事件间隙或 `reset_required=true` 时请求 REST 快照；不能依据过期事件执行命令。

服务端按配置批次发送 replay 并在批次间让出事件循环。连接数达到配额时新连接以 1013 关闭；单客户端待发字节或底层发送缓冲达到上限时仅以 1013 关闭该慢客户端。replay 数量超过单连接预算时发送 `reset_required=true`，不创建大队列。客户端快照刷新使用 single-flight 加至多一次 trailing refresh，重连采用有界指数退避和抖动。

## 5. 错误码

| code | HTTP | 含义 | retryable |
| --- | --- | --- | --- |
| `policy.denied` | 403 | 能力或动作被策略禁止 | false |
| `operator.confirmation_required` | 428 | 缺少人工确认 | false |
| `command.expired` | 409 | 命令票据过期 | false |
| `command.stale` | 409 | 人工确认后设备序列已变化 | false |
| `idempotency.replay` | 原响应/409 | 同指纹重放原响应，或拒绝不一致复用 | false |
| `device.not_found` | 404 | 设备不存在 | false |
| `device.busy` | 409/503 | 409 表示业务互斥或登记容量冲突；503 表示操作队列、确认票据或幂等缓存等有界基础设施饱和 | true |
| `adapter.unavailable` | 503 | 适配器不可用 | true |
| `clock.uncertain` | 409 | 时钟不可信，暂不提醒 | true |
| `schedule.not_found` | 404 | 日程不存在 | false |
| `schedule.not_notified` | 409 | 日程尚未进入可人工确认的已提醒状态 | false |
| `schedule.started` | 409 | 日程已开始，只允许取消而不能继续修改 | false |
| `schema.invalid` | 422 | 请求字段不符合契约 | false |
| `request.invalid` | 4xx | 非 schema 类的无效 HTTP 请求或路由 | false |
| `request.internal` | 500 | 未预期的内部失败；响应不暴露内部异常消息或堆栈 | true |

## 6. 适配器端口（伪代码）

```text
interface DeviceAdapter:
  discover() -> List<DeviceDescriptor>
  start(device_id, request_id) -> OperationResult
  stop(device_id, request_id) -> OperationResult
  reconnect(device_id, request_id) -> OperationResult
  health(device_id) -> HealthSnapshot
  start_readonly_preview(device_id) -> PreviewHandle
  stop_readonly_preview(device_id, handle_id) -> OperationResult
```

故意没有 `click`、`tap`、`type`、`purchase`、`captcha` 或 `pay` 方法。任何供应商 SDK 都必须包在此端口之后，并由编译/静态检查确保多余能力不可达。
适配器返回值仍需在运行时校验：生命周期状态必须属于版本化枚举，停止必须得到
`offline`，预览开始/停止必须分别得到 `running`/`stopped`。类型声明不能替代该边界
校验；非法或矛盾结果按适配器故障处理，不能写入资源快照或伪报操作成功。

## 7. 版本策略

向后兼容字段只能新增可选字段；删除或改变语义必须升 major 版本。事件 schema 与 API 版本独立发布。每次 schema 变更都要更新 mock fixture、契约测试和变更日志。
