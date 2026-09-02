# 设备适配器模块开发书

**module_id**：`M7-adapter-layer`
**版本**：`device-adapter.v1`
**状态**：`active`（仅 Mock；真实设备适配器 `planned`）
**治理**：`partial`（本书补齐首版边界；provider-host、正式 test-only port 和递归子模块仍待完成）
**负责人边界**：设备能力抽象与生命周期状态 owner；不拥有 API/Console 数据库或系统 helper

## 1. 职责与非职责

本模块把设备/模拟器能力抽象为版本稳定的 `DeviceAdapter` 端口，供 `DeviceService` 管理
生命周期、健康状态和只读预览。当前实现为进程内 `MockDeviceAdapter`，只用于合成测试与
控制面验收。

本模块不负责登录、验证码、OCR、坐标点击、批量输入、票档选择、订单、支付、私有接口、
风控规避或真实平台网络；真实 ADB/Emulator/scrcpy 接入必须经过独立的 provider-host、
system-helper manifest、人工确认和资源/权限门槛。模块不直接启动外部进程，也不把设备
序列号、路径或屏幕帧写入默认配置/日志。

## 2. 状态、变量与所有权

`MockDeviceAdapter` 只拥有进程内两个 Map：

| 变量 | 类型/取值 | owner 与生命周期 |
| --- | --- | --- |
| `states` | `Map<string, DeviceState>` | 适配器实例；测试/进程结束时释放，不持久化 |
| `streams` | `Map<string, StreamState>` | 适配器实例；测试/进程结束时释放，不持久化 |

设备状态由共享 repository 类型约束为 `offline/discovering/booting/ready/waiting/error` 等有限值；
预览状态为 `stopped/running/error`。当前 Mock 的不变量是：`stop()` 将设备置为
`offline` 并停止其预览；其他操作只改变自身设备/流条目，不访问其他模块的内部表。

真实实现还必须说明 serial、进程、端口、帧缓存和资源配额的 owner；这些字段不能从 Mock
推断，也不能由 Console 直接写入。

## 3. 对外函数与端口

当前 TypeScript 端口（`apps/api/src/devices/device-adapter.ts`）为：

| 入口 | 输入/前置条件 | 输出/后置条件 | 错误、超时、幂等 |
| --- | --- | --- | --- |
| `start(deviceId, requestId)` | 非空合成或已授权 device id；仅 Mock | `DeviceState=ready` | 当前同步、无外部副作用；重复调用幂等 |
| `stop(deviceId, requestId)` | 非空 device id | `DeviceState=offline`，预览停止 | 当前同步、无外部副作用；重复调用幂等 |
| `reconnect(deviceId, requestId)` | 非空 device id | `DeviceState=ready` | 当前同步；真实实现必须有取消/超时 |
| `health(deviceId)` | device id | `{state, heartbeatAgeMs}` | 只读；当前 heartbeat 为合成值 0 |
| `startReadonlyPreview(deviceId, requestId)` | 设备已被人工确认；Mock fixture | `StreamState=running` | 当前同步；真实实现必须限制为只读帧 |
| `stopReadonlyPreview(deviceId, requestId)` | device id | `StreamState=stopped` | 当前同步、幂等 |

`requestId` 只用于上层审计关联，适配器不得把它当凭据。未来跨进程端口必须冻结 schema
版本、超时、取消、重试、背压和进程退出语义，并通过版本化 REST/WebSocket/CloudEvents
合同连接，不共享数据库表或内部类。

## 4. 通信与共享资源

| 方向 | 当前合同 | 副作用 | 连接门槛 |
| --- | --- | --- | --- |
| `DeviceService` -> `DeviceAdapter` | in-process TypeScript port | Mock 无外部副作用 | 单元/契约测试通过 |
| API -> Console | `/api/v1/devices*` 与 `device.*` CloudEvents | 脱敏状态/审计 | OpenAPI/事件契约、loopback 配置 |
| 未来 provider-host -> adapter | 待定义 `device-adapter.v2` | 可能启动受限 helper | manifest、认证、人工确认、资源隔离 |

设备状态与审计事件由上层 `DeviceService`/repository 拥有；适配器不得直接写库。帧数据如
未来出现，只能按明确 retention policy 在本地内存或受控临时目录中保存，禁止云端上传和
敏感信息落盘。

## 5. 专用测试入口与负向断言

当前 test-only 入口是 `apps/api/test/device-adapter.spec.ts` 的 `MockDeviceAdapter`
fixture，以及 `device-service.spec.ts` 的注入 adapter fixture。测试必须使用合成 device
id、request id 和状态，不调用生产外部设备端口。

必须保留的断言包括：

- 生命周期、健康、只读预览状态转换和重复调用可重复；
- adapter 对象不存在 `click`、`tap`、`input`、`purchase`、`captcha`、`pay` 等能力；
- 真实/未知 provider、未授权设备、越界资源、断连/超时/重放和敏感字段均 fail closed；
- 测试日志不包含真实 serial、账号、手机号、身份证、验证码、订单或屏幕内容；
- Mock 的自动化行为不得迁移到真实平台适配器。

## 6. 递归子模块与完成门槛

| 子模块 | 边界 | 当前状态 | 下一门槛 |
| --- | --- | --- | --- |
| `M7-C1-port` | `DeviceAdapter` 抽象接口 | active | versioned cross-process contract |
| `M7-C2-mock` | `MockDeviceAdapter` 状态 Map | verified (unit) | formal fixture package |
| `M7-C3-health-preview` | health/readonly preview | active | frame/retention contract |
| `M7-C4-real-readonly` | ADB/Emulator/scrcpy 只读实现 | planned | helper manifest、人工验收、目标 host preflight |
| `M7-C5-test-harness` | device adapter test fixtures | partial | 独立 `device-adapter.test.v1` port |

Gate C 的 Android Studio AVD 观察记录（包括 `ticket_test_1/2`）是宿主机事实和人工验收
输入，不是本模块已激活的真实 adapter；详见对应 checkpoint。当前 profile 的双实例窗口
也不等于 `safe_instances` 或 provider 授权。

## 7. Checkpoint、风险与回滚

关联 checkpoint：`CP-20260902-module-governance-baseline`、
`CP-20260902-gate-c-empty-avd-smoke`、`CP-20260902-gate-c-ramp-2-4`、
`CP-20260903-gate-c-multi-followup`、`CP-20260903-gate-c-baseline-15m`、
`CP-20260903-release-handoff`。

主要风险是静态 AVD RAM/GPU 声明与运行时有效配置不一致、真实 provider 的权限/资源边界
尚未验证，以及把人工观察误读成自动化能力。回滚文档只需在新 checkpoint 追加更正并恢复
到最近验证提交；不得删除历史证据、终止用户实例或扩大 loopback exposure。

## 8. 结论分类

- **已由代码/测试确认**：Mock 生命周期、健康和只读预览端口；禁止购买/输入能力的负向断言。
- **工程假设**：未来只读 ADB/Emulator adapter 可通过 provider-host 端口接入。
- **待用户/平台确认**：目标宿主机 profile、GPU/虚拟化、并发开销、APK 兼容性及任何供应商
  EULA/数据流；真实大麦动作始终人工完成。
