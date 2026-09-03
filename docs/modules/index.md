# 模块登记索引

**索引版本**：`module-registry.v1`
**更新时间**：2026-09-03
**证据基线**：`bdf9a3f`（本阶段开始）；本阶段 checkpoint：
`docs/checkpoints/CP-20260902-module-governance-baseline.md`

本索引把 `docs/03-module-specifications.md` 的高层 M1-M11 映射到源码、契约、测试和
连接门槛。索引不是模块开发书的替代物。表中的 canonical ID 是稳定的治理标识；历史
文档中的别名只能作为迁移提示，不能用于连接模块。`implementation` 描述代码/测试事实，
`governance` 描述模块书、test-only port 和递归登记是否达到治理门槛。

每个表项都必须有 `checkpoint` 映射。值 `CP-20260902-module-governance-baseline :: <ID>`
表示本阶段完成了该 ID 的边界登记和证据挂接，不表示生产模块已经独立化或获得设备执行
授权；后续实现、helper、provider、协议或数据保留变更必须建立新的 checkpoint。

原始规格只定义 M1-M11。`M12-deployment-state` 是恢复接管后登记的后续扩展模块，单独列在
“后续扩展模块”中，不能被误读为原始规格的一部分或当前真实部署授权。

## 逻辑生产模块（原始 M1-M11）

`implementation` 与 `governance` 列的首个状态词使用治理枚举 `planned|active|verified|deprecated`；
括号内只补充成熟度/范围，不构成新的状态值。

| canonical ID | 源码边界/入口 | implementation | governance | checkpoint | 对外契约 | 测试证据 | 下一门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `M1-device-registry` | `apps/api/src/devices`（registry/lifecycle service、DTO、controller、adapter port） | active，mock 已验证 | partial | `CP-20260902-module-governance-baseline :: M1` | `/api/v1/devices*`、`device.*` CloudEvents | `device-service.spec.ts`、`device-adapter.spec.ts`、`api.e2e.spec.ts` | 独立 port、真实只读 adapter Gate C |
| `M2-screen-preview` | `apps/api/src/devices/device.service.ts` 的 preview/focus 子职责（当前与 M1 共用实现） | active，mock 已验证 | partial | `CP-20260902-module-governance-baseline :: M2` | `/api/v1/devices/{id}/preview/*`、`/focus`、`screen.*` | `device-service.spec.ts`、Console component/API specs | 子模块书和独立 owner；Tauri 人工验收 |
| `M3-schedule-reminder` | `apps/api/src/schedules` + `common/storage/schedule.repository.ts` + `common/time` | active，mock 已验证 | partial | `CP-20260902-module-governance-baseline :: M3` | `/api/v1/schedules*`、`schedule.*`/`reminder.*` | `schedule-reminder-audit.spec.ts`、`api.e2e.spec.ts` | SQLite adapter、系统通知策略评估 |
| `M4-human-confirmation` | `apps/api/src/safety` + `common/confirmation` | active，脱机确认边界已验证 | partial | `CP-20260902-module-governance-baseline :: M4` | `/api/v1/safety/*`、confirmation ticket | `confirmation.spec.ts`、`api.e2e.spec.ts` | 认证/RBAC/CSRF |
| `M5-alias-task-registry` | 目前只有 device alias/group、schedule label 字段，无独立目录 | planned | partial | `CP-20260902-module-governance-baseline :: M5` | 尚无独立契约 | 无独立模块测试 | 明确数据模型和持久化 owner |
| `M6-audit-security` | `apps/api/src/audit` + `common/audit/policy/http` | active，脱敏/拒绝路径已验证 | partial | `CP-20260902-module-governance-baseline :: M6` | `/api/v1/audit*`、审计事件 | `api-exception-filter.spec.ts`、`api.e2e.spec.ts` | 认证/RBAC、哈希链、SQLite 保留策略 |
| `M7-adapter-layer` | [`device-adapter.md`](device-adapter.md)、`apps/api/src/devices/device-adapter.ts` 及 provider 边界 | active，仅 Mock；真实 adapter planned | partial | `CP-20260902-module-governance-baseline :: M7`；`CP-20260902-gate-c-empty-avd-smoke :: M7`；`CP-20260902-gate-c-ramp-2-4 :: M7`；`CP-20260903-gate-c-multi-followup :: M7`；`CP-20260903-gate-c-baseline-15m :: M7` | `DeviceAdapter` in-process port | `device-adapter.spec.ts` | versioned provider-host port、helper 白名单、Gate C |
| `M8-mock-app-harness` | `apps/api/test` fixtures/`MockDeviceAdapter`；无独立 mock-app 包 | active | partial | `CP-20260902-module-governance-baseline :: M8` | test-only fixture/adapter port | API/Console 单元与契约测试 | 建立 `local.mock.ticketing` harness 包和登记 |
| `M9-console-contract-ui` | `apps/console/src` + `src-tauri` | active，loopback 浏览器受控复验通过（host-assisted） | partial | `CP-20260902-module-governance-baseline :: M9`；`CP-20260902-loopback-browser-regression` | REST/WS client、Tauri IPC runtime config | Console 9 files/81 tests；R2 `verified_with_gap` 证据 | 锁定/项目内 test-only 浏览器入口；Tauri 原生窗口人工验收；host/deployment UI |
| `M10-config-supply-chain` | `apps/api/src/config`、`scripts`、manifest/SBOM docs | active，基础门禁有历史证据 | partial | `CP-20260902-module-governance-baseline :: M10` | `runtime-config.v3`、toolchain/config schemas | `config.spec.ts`、compliance/SBOM tests | 统一内部入口、provenance、phantom dependency |
| `M11-host-readiness` | `apps/api/src/hosts`；详见 [`api-host-readiness.md`](api-host-readiness.md) | active，只读 planning 已由代码/测试确认 | partial | `CP-20260902-module-governance-baseline :: M11`；`CP-20260902-gate-c-empty-avd-smoke :: M11`；`CP-20260902-gate-c-ramp-2-4 :: M11`；`CP-20260903-gate-c-multi-followup :: M11`；`CP-20260903-gate-c-baseline-15m :: M11` | `/api/v1/hosts/probe`、`/api/v1/hosts/providers`；`host-probe.v1`/`provider-manifest.v1` | `host-service.spec.ts`、`openapi-contract.spec.ts`、`api.e2e.spec.ts`、`config.spec.ts`、`exposure-profile.spec.ts` | HostPlannerPort、目标宿主机 probe、AVD Gate C |

## 后续扩展模块（不属于原始 M1-M11）

| canonical ID | 源码边界/入口 | implementation | governance | checkpoint | 对外契约 | 测试证据 | 下一门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `M12-deployment-state` | `apps/api/src/deployments` | active（仅 mock-only 实现；真实执行未启用） | partial | `CP-20260902-module-governance-baseline :: M12-extension` | `/api/v1/deployments*`、deployment state/events（版本化） | `deployment-service.spec.ts`、`deployment-api.spec.ts`、OpenAPI contract | 独立 provider-host、认证/TLS/RBAC；不得把本行视为真实部署授权 |
| `M13-system-helper-policy` | `apps/api/src/helpers`、`config/system-helper-manifest*.json` | active（策略/校验；无 helper 启用） | partial | `CP-20260902-host-preflight :: M13`；`CP-20260902-gate-c-ramp-2-4 :: M13`；`CP-20260903-gate-c-multi-followup :: M13`；`CP-20260903-gate-c-baseline-15m :: M13` | `system-helper-manifest.v1`（版本化配置；当前空 allowlist） | `helper-manifest.spec.ts` | 目标宿主机 provenance/hash、R2 批准、provider-host 生命周期与资源隔离 |

## 已登记的示范模块书

| canonical ID | 文件 | 覆盖范围 | 当前结论 | checkpoint |
| --- | --- | --- | --- | --- |
| `M11-host-readiness` | [`api-host-readiness.md`](api-host-readiness.md) | Host probe、内置 provider registry、容量规划、REST 边界及递归子模块清单 | implementation active；governance partial | `CP-20260902-module-governance-baseline :: M11`；`CP-20260902-gate-c-empty-avd-smoke :: M11`；`CP-20260902-gate-c-ramp-2-4 :: M11`；`CP-20260903-gate-c-multi-followup :: M11`；`CP-20260903-gate-c-baseline-15m :: M11` |
| `M7-adapter-layer` | [`device-adapter.md`](device-adapter.md) | DeviceAdapter port、Mock lifecycle、只读 preview 和真实 adapter 门槛 | implementation active；governance partial | `CP-20260902-module-governance-baseline :: M7`；`CP-20260903-release-handoff :: M7` |
| `CON-C3-control-plane-client` | [`console-control-plane-client.md`](console-control-plane-client.md) | Console REST transport、事件流、runtime boundary、refresh 协调及其子模块清单 | implementation active；governance partial | `CP-20260902-module-governance-baseline :: CON-C3` |
| `M13-system-helper-policy` | [`system-helper-manifest.md`](system-helper-manifest.md) | 版本化 helper provenance/能力/路径/资源策略与默认拒绝校验 | implementation active；governance partial | `CP-20260902-host-preflight :: M13`；`CP-20260902-gate-c-ramp-2-4 :: M13`；`CP-20260903-gate-c-multi-followup :: M13`；`CP-20260903-gate-c-baseline-15m :: M13` |

其余模块尚未拥有独立书页。此状态是治理缺口，不是实现失败；在逐模块书和 test-only
harness 建立前，不能把索引中的 `active` 解读为“模块独立化已完成”。

## API Common 递归子模块

以下条目严格限定为 `apps/api/src/common` 内的逻辑边界。`CommonModule` 是当前的全局
容器组合 owner，但不因此取得各子模块的内部状态所有权；每项后续必须有自己的书页和
明确 port。特别地，`API-C3-common-events` 只拥有进程内事件总线，不拥有顶层 WebSocket
传输；两者的边界见下一节。

| ID | 源码边界 | 主要状态 owner | 主要测试/契约 | checkpoint | 当前缺口 |
| --- | --- | --- | --- | --- | --- |
| `API-C1-storage` | `apps/api/src/common/storage/*` repositories | 各 repository 的 bounded in-memory state | `concurrency.spec.ts`、service specs | `CP-20260902-module-governance-baseline :: API-C1` | repository port、SQLite owner |
| `API-C2-audit` | `apps/api/src/common/audit/*` | `AuditRepository.records` | audit/API e2e | `CP-20260902-module-governance-baseline :: API-C2` | 独立 provider token、哈希链 |
| `API-C3-common-events`（旧别名 `API-C3-events`） | `apps/api/src/common/events/*` (`EventBusService`) | event history/listeners/sequence | `events.spec.ts`、`event-contracts.spec.ts` | `CP-20260902-module-governance-baseline :: API-C3-common-events` | versioned event-bus port、跨进程恢复 |
| `API-C4-policy-http` | `apps/api/src/common/policy/*`、`common/http/*` | policy version、request context | policy/config/exception specs | `CP-20260902-module-governance-baseline :: API-C4` | auth/RBAC boundary |
| `API-C5-confirmation` | `apps/api/src/common/confirmation/*` | confirmation tickets | `confirmation.spec.ts` | `CP-20260902-module-governance-baseline :: API-C5` | durable ticket/identity owner |
| `API-C6-time` | `apps/api/src/common/time/*` | UTC/monotonic clock | config/schedule specs | `CP-20260902-module-governance-baseline :: API-C6` | clock source contract |
| `API-C7-idempotency` | `apps/api/src/common/idempotency/*` | bounded entries/in-flight | `idempotency.spec.ts` | `CP-20260902-module-governance-baseline :: API-C7` | persistent/restart semantics |
| `API-C8-concurrency` | `apps/api/src/common/concurrency/*` | keyed/global queues | `concurrency.spec.ts` | `CP-20260902-module-governance-baseline :: API-C8` | explicit port and metrics contract |
| `API-C9-errors` | `apps/api/src/common/errors/*` | `ApiError` and exception mapping | `api-exception-filter.spec.ts`、`api.e2e.spec.ts` | `CP-20260902-module-governance-baseline :: API-C9` | independent error port and schema owner |

## API 顶层支撑与组合边界

这些条目不属于 `common`。它们分别拥有稳定的 owner/module ID，避免把健康检查、事件
WebSocket、Nest 组合和进程启动混成一个模块：

- `API-C10-health` 负责健康 REST 与诊断响应，只读取 Common 和事件网关的统计 port；它
  不拥有事件历史、WebSocket 连接或 repository 状态。
- `API-C11-events-gateway` 负责顶层 `apps/api/src/events/*` 的 WebSocket transport；它
  消费 `API-C3-common-events`，但不拥有 EventBus 的 sequence/history。
- `API-C12-app-composition` 负责 `apps/api/src/app.module.ts` 的 Nest 模块图、全局
  provider/middleware/guard/filter/interceptor 组合；旧别名 `API-C12-composition` 仅作迁移提示。
- `API-C13-runtime-bootstrap` 负责 `apps/api/src/main.ts` 的进程启动、版本化配置读取、
  全局前缀/CORS/validation/WS adapter 装配和监听；它不拥有业务模块状态，也不决定部署地址。

| ID | 源码边界 | owner / 状态 | 对外/共享契约 | 主要测试/契约 | checkpoint | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-C10-health` | `apps/api/src/health/*` | `HealthModule`/`HealthService`；active | `/api/v1/health/live`、`/ready`、`/diagnostics`；`health.*.v1` | `api.e2e.spec.ts`、`openapi-contract.spec.ts` | `CP-20260902-module-governance-baseline :: API-C10-health` | 独立 health port/book；诊断依赖只读 stats 接口 |
| `API-C11-events-gateway` | `apps/api/src/events/*` (`EventsModule`、`EventsGateway`、`ConfiguredWsAdapter`) | `EventsGateway`；active | `/api/v1/events?since=&stream_id=`；`event-stream.sync.v1` + CloudEvents frames | `events-gateway.spec.ts`、`event-contracts.spec.ts` | `CP-20260902-module-governance-baseline :: API-C11-events-gateway` | transport owner、跨进程恢复、握手认证 |
| `API-C12-app-composition`（旧别名 `API-C12-composition`） | `apps/api/src/app.module.ts` | `AppModule` composition root；active | Nest module graph、全局 middleware/guard/filter/interceptor（in-process） | `api.e2e.spec.ts`、`openapi-contract.spec.ts`、`deployment-api.spec.ts` | `CP-20260902-module-governance-baseline :: API-C12-app-composition` | 依赖图/启动顺序检查、独立 composition book |
| `API-C13-runtime-bootstrap` | `apps/api/src/main.ts` | `bootstrap()` process entry；active（间接验证） | `runtime-config.v3` → validation/CORS/WS adapter/listen lifecycle | `config.spec.ts`、`exposure-profile.spec.ts`、API load/bootstrap evidence | `CP-20260902-module-governance-baseline :: API-C13-runtime-bootstrap` | 专用 bootstrap test-only harness、停止/错误恢复证据 |

## Console 子模块

`CON-C3-control-plane-client` 是本阶段的聚合示范书，不替代下列递归书页；各子模块 ID
已固定，后续可以拆成同名文件而不改变连接契约。

| ID | 源码边界 | 当前状态 | 对外/共享契约 | 测试证据 | checkpoint | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| `CON-C1-contracts` | `apps/console/src/contracts.ts` | active | OpenAPI/event schema 映射 | `api-client.spec.ts`、component specs | `CP-20260902-module-governance-baseline :: CON-C1` | 生成/漂移检查 owner、独立书页 |
| `CON-C2-runtime-config` | `apps/console/src/config/runtime-config.ts`、`apps/console/vite.config.ts`、Tauri config overlay/IPC | active | `console-runtime.v1`、loopback URL policy | `runtime-config.spec.ts`、vite boundary spec | `CP-20260902-module-governance-baseline :: CON-C2` | Tauri/开发入口 provenance、独立书页 |
| `CON-C3-rest-transport` | `apps/console/src/api/api-client.ts` | active | versioned REST | `api-client.spec.ts` | `CP-20260902-module-governance-baseline :: CON-C3-rest` | formal test-only harness、host/deployment consumer |
| `CON-C4-event-stream` | `apps/console/src/api/event-stream.ts` | active | `event-stream.sync.v1`、CloudEvents | `event-stream.spec.ts`、loopback Origin/重连回归 | `CP-20260902-module-governance-baseline :: CON-C4`；`CP-20260902-loopback-browser-regression` | formal fake port、可复现浏览器入口、跨进程恢复证据 |
| `CON-C5-refresh-orchestration` | `apps/console/src/api/single-flight-refresh.ts`、`apps/console/src/hooks/use-control-plane.ts` | active | single-flight/retry behavior | `single-flight-refresh.spec.ts`、hook specs | `CP-20260902-module-governance-baseline :: CON-C5` | formal test-only port、abort/slow-path coverage |
| `CON-C6-ui-features` | `apps/console/src/App.tsx`、`components/*`、`styles.css` | active，受控浏览器回归通过（证据有 harness gap） | UI state/actions | component specs、R2 browser evidence | `CP-20260902-module-governance-baseline :: CON-C6`；`CP-20260902-loopback-browser-regression` | 项目内/锁定浏览器入口；App 根状态递归拆分；Tauri 人工验收 |

## 连接与所有权规则

1. 逻辑模块可以暂时位于同一个 Nest/React 进程，但必须通过明确 port/token 或版本化
   REST/WebSocket/事件契约连接；不得共享另一模块的数据库表或隐式可变状态。
2. 每个表项都必须有本索引中的 checkpoint 映射；后续模块书还必须登记变量/不变量、函数
   前后置条件、共享资源 owner、test-only 入口、负向测试和审计断言。
3. `API-C3-common-events` 产生 CloudEvents envelope、sequence 和 replay window；
   `API-C11-events-gateway` 只负责 Origin/capacity/buffer/WS framing；`API-C10-health`
   只消费这些模块的只读统计。三者不得互相接管状态。
4. `API-C12-app-composition` 只组合模块和全局 Nest 横切能力；`API-C13-runtime-bootstrap`
   只执行进程装配和生命周期。配置监听值仍必须来自严格配置层，不得在 `main.ts` 硬编码。
5. `M11` 的 capacity snapshot 是 Host Planner 产生、M12 扩展消费的只读契约；当前
   controller 仍注入具体 `HostService`，这是待独立化的设计缺口，不是跨进程实现。
6. `M13-system-helper-policy` 只产生不可执行的 activation plan；它不拥有进程、设备或
   数据库状态。任何 provider host 连接仍需通过 M13 白名单和独立 R2 闸门。
7. Host/Deployment 契约未接入 Console UI；索引中的“契约”不等于“consumer 已实现”。
8. 所有真实设备和系统 helper 连接都必须经过独立 R2 checkpoint、白名单和人工确认；本
   索引不授权启动任何外部进程。

## 本阶段结果

本阶段已完成模块索引边界修正和三个示范模块书的第一版登记：原始 M1-M11、后续扩展
M12/M13、API Common/顶层支撑边界及 Console 递归边界均有 canonical ID 与 checkpoint
映射。M13 的默认拒绝 parser/负向测试已验证，但仍保留递归书页、正式 HostPlannerPort、
目标宿主机 preflight runner、provider-host 和 phantom dependency 等治理缺口。
checkpoint 的关闭只表示策略/文档登记完成，不表示真实 provider 部署完成；下一 gate 仍须
另建 R2 记录处理设备、helper、依赖或外部网络动作。

## 2026-09-03 entity5 证据索引追加

以下是对既有模块表的追加索引，不覆盖表中历史 checkpoint 或改变模块实现状态：

| 模块 | 新增 checkpoint | 本次证据 | 下一门槛 |
| --- | --- | --- | --- |
| `M11-host-readiness` | `CP-20260903-low-resource-entity5` | `ticket_test_5` 低资源单实例 300 秒/30 样本；Free RAM 最低 `11.359 GiB`、commit `87.126--87.730%`、QEMU Private `3.615--3.758 GiB`；仅作 planner 输入 | 低资源双实例固定窗口、受保护 `1 -> 2 -> 4` ramp、GPU/I/O/温度及目标宿主机 preflight；不更新 `safe_instances` |
| `M7-adapter-layer` | `CP-20260903-low-resource-entity5` | operator-run ADB/Emulator 健康和 Settings 只读 smoke；仅启动 Settings，未发送触摸、文本或购票流程输入，未激活真实 adapter/helper | 独立只读 provider-host/DeviceAdapter 端口、helper 白名单和人工验收；不把单实例观察写成 provider 授权 |

entity5 观察的原始命令、PID、effective 配置哈希、截图和精确停止结果只保存在该
checkpoint 与被忽略的 `.runtime/r2-avd-entity5-20260903/`；本索引不授权启动外部进程，
也不改变现行 loopback 边界。

## 2026-09-03 Tauri release 证据索引追加

以下追加项只更新证据索引，不覆盖 `M9`/Console 子模块表中的历史状态或人工验收门槛：

| 模块 | 新增 checkpoint/证据 | 本次程序化结果 | 仍待完成 |
| --- | --- | --- | --- |
| `M9-console-contract-ui` / `CON-C3-control-plane-client` | `CP-20260903-console-tauri-acceptance`；`.runtime/r2-console-tauri-release-20260903/browser-evidence.json` | release binary hash `22F50D6BAC64C029E904B5BA56157CC83CBFA457443EB11C17C379B9051F2358`；动态 loopback `59701`、CDP `50131`；1 设备/1 提醒/2 审计，REST 5 URL、WS sync+2 事件帧、errors=0；优雅关闭后目标进程/监听清空 | 用户人工 Tauri 签收、真实 APK/只读 provider 兼容性及正式 test-only harness |

本次 CSP 中的 `http://ipc.localhost` 仍是 Tauri 固定内部 IPC origin；API/WS loopback
只属于运行时注入证据，不构成远程 exposure。下一门槛为 `entity3 + entity5` 低资源双
实例固定窗口及受保护 ramp；索引不授权启动 `entity4` 或激活 helper/provider。
