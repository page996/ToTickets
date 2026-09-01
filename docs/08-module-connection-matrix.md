# 模块连接矩阵与时序

## 1. 依赖方向

| 生产者 | 消费者 | 协议/数据 | 允许的副作用 |
| --- | --- | --- | --- |
| Console UI | Control Plane | REST commands | 请求配置、生命周期、预览和提醒确认 |
| Control Plane | Console UI | WebSocket events | 推送脱敏状态；不推送秘密 |
| Control Plane | Device Registry | 内部端口 | 读写设备元数据和状态 |
| Device Registry | Adapter Host | `DeviceAdapter` | 生命周期、健康、只读预览 |
| Adapter Host | Control Plane | CloudEvents | 上报状态/错误；不执行输入 |
| Schedule Service | Control Plane | `ReminderEvent` | 产生提醒；不调用设备命令 |
| Human Confirmation Gateway | Control Plane | `ConfirmationTicket` | 授权单个允许命令，短期有效 |
| Control Plane | Audit Service | `AuditEvent` | append-only 审计 |
| Mock Harness | Contract Tests | fixture/adapter port | 仅测试环境可自动化 |
| Host Probe/Planner | Console/Operator | `host-probe.v1` / `provider-manifest.v1` over REST | 只读资源检查与容量估算 |
| Deployment Controller (mock-only) | Control Plane / Provider Host (future) | versioned deployment state/events | 当前只改进程内 mock 状态；真实 provider 逐实例、幂等、需人工确认且未启用 |

任何模块不得绕过 Control Plane 直接调用 Adapter Host。UI 也不能直接调用 ADB、scrcpy 或模拟器 CLI。

Host Probe 只使用操作系统资源 API 和用户明确选择的工具路径；它不通过 PATH、注册表
或猜测目录发现工具，不启动外部进程。容量规划结果不能直接触发部署。当前 mock-only
Deployment Controller 负责进程内 desired/observed state、generation、operation_id 和
脱敏事件；未来真实控制器才可通过认证的 provider host 合约执行生命周期操作，并在
认证/TLS/RBAC/CSRF 完成前保持关闭。

## 2. 准备流程时序

```text
Operator -> UI: register alias/device
UI -> Control Plane: POST /devices
Control Plane -> Adapter Host: discover (allowlisted)
Adapter Host -> Control Plane: device.state.changed
Control Plane -> Audit: device.registered
Control Plane -> UI: snapshot + event
```

## 3. 提醒流程时序

```text
Operator -> UI: create schedule
UI -> Control Plane: POST /schedules
Control Plane -> Clock: validate timezone/drift
Clock --> Control Plane: trusted / uncertain
Control Plane -> Reminder Service: arm reminder
Reminder Service -> UI: reminder.fired
Operator -> UI: acknowledge
UI -> Control Plane: POST /schedules/{id}/acknowledge
Control Plane -> Audit: reminder.acknowledged
Control Plane -> UI: ReadyForHuman (no device input)
```

时钟不可信时，`Reminder Service` 只能发出 `clock.uncertain`，不能自行校准或转换为设备命令；它会按配置的 heartbeat 有界重新评估时钟，日程取消时必须取消尚未完成的重新评估。

## 4. 预览流程时序

```text
Operator -> UI: choose one focus device
UI -> Control Plane: GET /devices/{id} (snapshot sequence=N)
Operator -> UI: confirm the single allowed action
UI -> Control Plane: POST /safety/confirmations (operator + device + intent + expected_sequence=N)
Control Plane --> UI: one-time scoped confirmation ticket + expected_sequence=N
UI -> Control Plane: POST /devices/{id}/focus (ticket + expected_sequence=N + idempotency key)
Control Plane --> UI: device.focus.changed
Operator -> UI: request read-only preview and confirm
UI -> Control Plane: GET /devices/{id} (fresh snapshot sequence=M)
UI -> Control Plane: POST /safety/confirmations (preview.start + expected_sequence=M)
Control Plane --> UI: one-time scoped confirmation ticket + expected_sequence=M
UI -> Control Plane: POST /devices/{id}/preview/start (ticket + expected_sequence=M + idempotency key)
Control Plane -> Adapter Host: start_readonly_preview
Adapter Host --> Control Plane: stream handle + metadata
Control Plane -> UI: screen.stream.started
Adapter Host -> UI: in-memory frame metadata/stream
Operator -> UI: stop preview
UI -> Control Plane: POST /devices/{id}/preview/stop
Control Plane -> Adapter Host: stop_readonly_preview
Adapter Host -> Control Plane: screen.stream.stopped
```

任一设备级命令发现当前序列与确认时序列不同，必须返回 `409 command.stale`；UI
刷新快照并重新显示人工确认，不复用旧票据。全局 `safety.stop-all` 不绑定设备序列，
其确认和命令均禁止 `expected_sequence`。

帧数据不经过数据库或审计服务；审计只记录流的开始/停止、设备和操作者。

## 5. 失败与恢复流程

```text
Adapter -> Control Plane: adapter.unavailable
Control Plane -> Audit: adapter.failure
Control Plane -> UI: device.state=error
Operator -> UI: reconnect confirmation
UI -> Control Plane: reconnect + idempotency key
Control Plane -> Adapter: reconnect
Adapter -> Control Plane: new sequence snapshot
Control Plane -> UI: event-stream.sync.v1 (stream id + retained cursor window)
UI -> Control Plane: GET REST snapshots when reset_required or a sequence gap is observed
```

恢复逻辑不得回放先前的输入或自动重新打开购买页面；只恢复设备连接和观察能力。

## 6. 批量操作边界

批量 API 只允许无输入的管理动作，例如查询、分组、启动/停止多个 mock 或设备实例（每个目标仍独立审计）。一旦请求包含预览输入、文本、坐标、点击、订单、验证码或支付语义，服务端必须拒绝整个请求，而不是部分执行。

## 7. 接口变更检查清单

- 是否新增了真实平台或秘密字段？若是，拒绝或新建安全评审。
- 是否让 UI 绕过 Control Plane？若是，拒绝。
- 是否改变事件 sequence 或幂等语义？同步更新 schema 和契约测试。
- 是否改变设备能力集合？更新策略版本、负向测试和 ADR。
- 是否引入新供应商依赖？记录许可证、来源、权限和回滚方式。
