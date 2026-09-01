# 第三阶段：Mock 控制平面负载与故障基线

## 1. 范围和结论类别

本 harness 仅连接由操作者在本地启动的 NestJS mock 控制平面，只登记 `mock-adapter`/`memory` 设备，并执行已经过服务器确认票据授权的 `device.reconnect` 生命周期操作。它不启动或控制 Android 设备，不连接真实平台，不产生设备输入，不使用账号、验证码、实名或支付数据。

- 已由仓库实现确认：REST 通过幂等键、确认票据、设备串行化和 CloudEvents WebSocket 流提供 mock 控制平面行为。
- 工程假设：压测在隔离的本地 mock 进程上运行，运行期间没有其他写入者；否则 fanout 和游标观察会包含外部事件。
- 待操作者确认：本机资源、隔离的进程配置和本地结果是否适合作为该机器的基线。结果不代表真实平台的速度、成功率或容量承诺。

本文件中的 `/api/v1` 和 `event-stream.sync.v1` 是协议文档常量，不是部署地址或端口默认值。

## 2. 运行前配置

使用项目隔离工具链：`scripts/pnpm.ps1` 会调用仓库的 `.tools` Node 和 pnpm。先由操作者为 mock API 的版本化配置提供所有 `config/config.example.json` 所要求的环境变量，并把 `CONTROL_CONFIG_FILE` 指向该相对配置文件；无须、也不得配置真实 ADB、模拟器或 scrcpy 工具来运行本 harness。

API 配置必须至少满足下列关系。所有具体数值由环境变量注入，不由脚本提供默认值：

| API 配置环境变量 | 约束 |
| --- | --- |
| `MAX_DEVICES` | 不小于 `LOAD_DEVICE_COUNT`，且 API 支持的最大值为 64 |
| `WEBSOCKET_MAX_CLIENTS` | 不小于 `LOAD_WS_CLIENTS` |
| `EVENT_HISTORY_SIZE` | 不小于 `LOAD_WRITE_OPERATIONS`，避免基线运行中历史窗口淘汰 |
| `OPERATION_QUEUE_MAX_QUEUED` | 不小于每个调度器在基线中允许的等待操作数；超限应作为可重试容量拒绝记录 |
| `EVENT_REPLAY_MAX_EVENTS` | 不小于 `LOAD_DEVICE_COUNT`，以允许登记事件的首次 replay |
| `CONFIRMATION_MAX_ENTRIES` | 不小于 `min(LOAD_CONCURRENCY, command_executions)` |
| `CONSOLE_ORIGIN` | 与 `LOAD_ALLOWED_ORIGIN` 完全相同 |

运行器要求以下环境变量，缺少、格式错误或超出范围时立即失败，不会发出网络请求：

| 环境变量 | 含义和限制 |
| --- | --- |
| `LOAD_API_ORIGIN` | 本机回环 API 的完整 `http`/`https` origin，无路径、凭据或默认值 |
| `LOAD_EVENTS_ORIGIN` | 本机回环事件流的完整 `ws`/`wss` origin，无路径、凭据或默认值 |
| `LOAD_ALLOWED_ORIGIN` | WebSocket 握手的 `Origin`，必须与 API allowlist 匹配 |
| `LOAD_DEVICE_COUNT` | 32--64 个 mock 设备 |
| `LOAD_WS_CLIENTS` | 至少 32 个事件客户端 |
| `LOAD_WRITE_OPERATIONS` | 500--1000 个精确 REST 写请求 |
| `LOAD_CONCURRENCY` | REST 任务和连接任务的最大并发数 |
| `LOAD_HEALTH_PROBE_INTERVAL_MS` | 负载期间只读健康探测周期 |
| `LOAD_TIMEOUT_MS` | 单次 HTTP/WS 等待的上限 |
| `LOAD_EVENT_SETTLE_MS` | 等待 live fanout 到达的上限 |

先运行离线配置与统计自测：

```powershell
.\scripts\pnpm.ps1 test:load:mock
```

在单独终端以已经显式配置好的 mock API 启动命令运行服务；确认它只使用 `mock-adapter` 后，执行：

```powershell
.\scripts\pnpm.ps1 load:mock
```

运行器只将 JSON 报告写入标准输出。需要保留报告时，由操作者将标准输出重定向到其选择的项目相对路径；运行器本身不会写入数据库、录屏、日志或任意默认目录。

## 3. 负载和故障场景

写入计划严格等于 `LOAD_WRITE_OPERATIONS`：先登记 `LOAD_DEVICE_COUNT` 个 mock 设备，再按每个安全 `reconnect` 先读取新鲜设备快照，用其 `sequence` 签发确认票据，并在命令中携带相同的 `expected_sequence`。至少一个组会以相同幂等键并发发送两次相同 `reconnect` 请求；该组用三次 REST 请求验证两份响应的设备序列一致，且服务端仅执行一次。

设备目标按轮转分配后先按设备分组：同一设备内的确认/命令对严格顺序执行，避免并发请求使后续票据在执行前失去新鲜度；不同设备组仍按 `LOAD_CONCURRENCY` 并发执行，以覆盖跨设备并行。只有同一幂等键验证组中的两份完全相同命令会并发发送。写入开始前建立 `LOAD_WS_CLIENTS` 个带 allowlisted Origin 的连接，先验证同步帧和登记事件 replay，再验证 live fanout。负载期间持续调用 `/health/live` 和 `/health/ready`，并读取诊断数据作为只读预检和结果统计。

完成写入后，harness 额外建立两条短连接：一条使用超前 cursor，预期获得 `reset_required`；另一条使用相同 `stream_id` 且落后一条事件的 cursor，预期 replay 最后一个事件。这是可重复、无副作用的 cursor 故障/恢复验证。

慢客户端不会在本 harness 中人为制造，因为完整的 TCP 背压行为不适合由本地黑盒负载稳定复现。报告明确标注此覆盖缺口；已有 `apps/api/test/events-gateway.spec.ts` 覆盖慢客户端只关闭自身、1013 状态和其他客户端继续接收事件的单元测试。

## 4. 报告和判定

报告 schema 为 `mock-control-plane-load-report.v1`，包含：

- 写请求总数、成功/失败数、错误率和 p50/p95/p99/max 延迟；
- 健康探测成功/失败数、ready 返回 `degraded` 的观察计数，以及 live、ready、diagnostics 的延迟分位数和最大值；
- WebSocket 连接、同步帧、事件帧、fanout 完整客户端数，以及服务端拒绝/发送/慢连接计数；
- cursor reset 故障与 replay 恢复次数及延迟；
- 同幂等键组、请求总数、健康、fanout、reset、replay 的实测断言结果。

报告不包含 API 地址、Origin、环境变量原文、凭据、屏幕内容或固定性能门槛。`health/ready` 的 `degraded` 是资源配额观测，不等同于探测不可响应，会单独计数。`status: "passed"` 只表示协议与完整性断言通过；任何实际延迟均保留为当次测量值。配置不足、服务不可达、连接关闭、HTTP 错误或观察断言失败都会生成 `status: "failed"` 的 JSON 并返回非零退出码。

## 5. 最后一次实测记录

以下结果来自源码重新构建后的 `runtime-config.v3` 临时 mock 进程；端口由本机运行时动态分配，报告本身不保存地址。测试时间为 `2026-08-25T14:57:47Z`，配置为 32 台设备、32 个 WebSocket 客户端、500 个 REST 写请求、并发度 32。

| 指标 | 实测结果 |
| --- | ---: |
| REST 请求成功/失败 | 500 / 0 |
| REST 错误率 | 0 |
| REST p50 / p95 / p99 | 27.323 / 40.281 / 43.767 ms |
| REST 最大延迟 | 62.748 ms |
| 健康探针失败 | 0 |
| 健康最大延迟（live/ready/diagnostics 合并） | 43.03 ms |
| WebSocket 完整 fanout 客户端 | 32 / 32 |
| 每客户端期望/最少/最多事件 | 265 / 265 / 265 |
| 逐设备序列与最终快照通过 | 32 / 32 |
| 同幂等键组执行一次 | 2 / 2 |
| cursor reset / replay 恢复 | 1 / 1 |
| delivery / rejected / slow / send errors | 0 / 0 / 0 / 0 |

本次报告 `status` 为 `passed`，持续健康探针共 13 次；慢客户端仍由 `EventsGateway` 单测覆盖，而不是该黑盒基线的性能结论。
