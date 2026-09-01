# 宿主机检查与部署规划

## 1. 目的与边界

本文件定义跨宿主机的资源检查、provider 规划和部署状态控制边界。当前实现包含
无副作用的检查/容量估算，以及一个仅用于 mock 的进程内部署状态 domain 和 REST
controller；两者都不启动 ADB、模拟器、scrcpy、Appium 或第三方应用，也不发送任何设备
输入。mock 记录中的 `ready` 只是状态机观察值，不表示真实宿主机、第三方页面、账号或
购票流程已准备好。

真实第三方应用只允许人工操作。任何自动登录、验证码、OCR、点击、批量输入、选票、
下单、支付、私有接口调用或规避包体/环境检测的实现都不属于本项目。

## 2. 版本化接口

API 提供两个只读端点：

| 方法 | 路径 | 作用 | 副作用 |
| --- | --- | --- | --- |
| GET | `/api/v1/hosts/probe` | 读取 CPU、内存、工作卷磁盘空间、工具选择状态和未探测项 | 无 |
| GET | `/api/v1/hosts/providers` | 返回 provider-manifest.v1 与保守容量估算 | 无 |

响应由现有 API 拦截器转换为 snake_case，并附带 `request_id`。协议定义在
`docs/openapi.v1.json`；不包含部署地址、主机名、绝对路径、环境变量原文、凭据、
设备序列号或屏幕帧。

`host-probe.v1` 的 `side_effects` 固定为 `none`。Node 探针只使用操作系统资源 API
和用户已选择的工具路径做存在性检查；它不通过 PATH、注册表或猜测的用户目录寻找
工具。若未选择工具，状态为 `not_checked`；若选择的文件不存在，状态为 `fail`，
但响应不会回显路径。运行时配置中的 `storage.data_dir` 会作为工作卷的显式
`statfs` 目标，`tools.adb`、`tools.emulator` 和 `tools.scrcpy` 会分别作为显式
可执行文件候选；这些值在加载时规范化。完整配置文件仍要求 `storage.data_dir`、
`storage.log_dir`、`tools.adb` 和 `tools.scrcpy`，而环境模式只在提供对应的
`PROJECT_*`/`ANDROID_*` 变量时检查，未提供时保持 `unknown`/`not_checked`，不会
回退到当前工作目录或 `ANDROID_SDK_ROOT` 推导路径。

## 3. Provider manifest

当前内置 profile 是规划输入，不是实测承诺；wire schema 位于
`config/provider-manifest.schema.json`，TypeScript manifest 常量会在 API 启动时作为
只读规划数据暴露：

规划结果同时返回 `safe_instances`（宿主机/provider 估算）、`control_plane_limit`
（当前 API 的 `max_devices`）和 `effective_instances`（二者较小值），避免把硬件
上限误读成可直接登记的设备数。

| provider | 类型 | 每实例 CPU | 每实例内存 | 每实例磁盘 | 显存 | 流量 | 当前状态 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `mock-adapter` | mock | 1 thread | 256 MiB | 1 GiB | 0 | 0 Mbps | 可用于离线状态控制/测试 |
| `android-emulator-avd` | AVD | 4 threads | 4096 MiB | 16 GiB | 1024 MiB | 6 Mbps | 规划/待实测 |
| `android-physical-usb` | 实体 USB | 1 thread | 512 MiB | 1 GiB | 0 | 8 Mbps | 规划/待人工验收 |
| `android-remote-stream` | 远程串流 | 2 threads | 1024 MiB | 1 GiB | 0 | 12 Mbps | 规划/待供应商审查 |

每个 manifest 都固定声明 `user_input=false`、`automation=false`。远程串流 profile
不包含云项目、令牌或账号字段；供应商配额、费用、网络 RTT、数据流向和 EULA 必须
单独审核。

## 4. 容量公式

实现使用当前可用内存作为准入信号，并保留控制平面/操作系统资源：

```text
C_safe = min(
  provider.max_instances,
  floor(max(0, cpu_threads - 2) / cpu_i),
  floor(max(0, available_memory_mib - 4096) / memory_i),
  floor(max(0, disk_free_gib - 20) / disk_i),
  vram_limit_if_required
)
```

GPU/VRAM 或磁盘无法被无副作用探针确认时，不把容量错误地变成零；结果标记
`unknown`，并要求在目标宿主机用 provider 专用检查和 ramp test 复核。启动并发
额外限制为 `min(C_safe, 2)`，避免多个 AVD 同时冷启动造成瞬时内存、IO 和 GPU
压力。`max_devices` 是控制平面逻辑上限，与宿主机容量分开计算。

验收时按 `1, 2, 4, 8 ...` 递增实例做合成/人工观察 ramp test，记录 p95/p99 延迟、
画面新鲜度、丢帧、CPU/内存/显存/磁盘 IO、温度、崩溃和恢复时间。只有通过测试的
数量才能写入部署配置；当前 profile 的数字不能当作并发或购票成功率保证。

## 5. 部署状态控制（mock-only domain）

当前 `apps/api/src/deployments/`（决策记录见
`docs/adr/0005-mock-deployment-state-boundary.md`）提供进程内 `DeploymentService`、内存
`DeploymentRepository`、严格输入 DTO 和已接入的 `DeploymentController`。REST 控制器只
管理 mock 状态模型，不是 provider host，也不执行外部命令。每条记录固定为
`provider_id=mock-adapter`、
`execution_mode=mock_only`、`planning_only=true`、`side_effects=none`；记录不含可执行路径、
命令参数、凭据或设备输入能力。非 mock provider（包括 AVD、USB 和远程串流）以及 live
execution mode 在公开 REST DTO 层以 `422 schema.invalid` fail fast，不会进入
`DeploymentService`；全局异常过滤器仅记录通用控制平面拒绝审计。领域服务仍会对绕过 DTO 的内部调用执行同样的防御性检查，并以
`policy.denied` 拒绝、记录 `deployment_id=null` 的拒绝审计/事件。所有 mock 写请求还必须显式提交
`operator_confirmed=true`；这只记录人工确认意图，不替代认证或真实设备命令票据。

状态标签按证据区分：

| 结论类别 | 当前结论 |
| --- | --- |
| 已由代码/测试确认 | mock-only 记录、REST 路由/OpenAPI 契约、容量边界、状态迁移、generation/operation_id、幂等、审计和事件均为进程内行为；不会启动外部进程 |
| 工程假设 | 状态图中的异步阶段、provider-host 端口和真实 provider 命令映射可作为二次开发的版本化起点，但尚未形成可部署实现 |
| 待用户/平台确认 | 目标 Android 镜像、虚拟化/GPU、AVD/实体设备或串流供应商、并发 ramp test、真实 APK 兼容性及任何环境监测表现 |

状态机将 `desired_state` 与 `observed_state` 分离，并以 `generation` 和 `operation_id`
关联每次变更：

```text
planned -> validating -> capacity_reserved -> provisioning -> starting -> ready
   |             |              |                  |             |
 failed <--------+--------------+------------------+-------------+--> degraded
   |
stopping -> stopped -> released
```

图中 `validating`、`provisioning` 和 `starting` 是为未来异步 provider host 过程保留的
版本化状态。当前同步 mock `validate` 为了保持无副作用，直接把 `planned`、`failed` 或
`degraded` 推进到 `capacity_reserved`；其余阶段只能通过显式的 domain `transition` 测试
推进，不代表已有外部执行器。

当前 domain 操作及其语义如下：

| 操作 | 当前行为 | 外部副作用 |
| --- | --- | --- |
| `plan` | 仅接受 mock provider、`mock_only` 和 planner 提供的容量快照；创建 `planned` 记录，`generation=1` | 无 |
| `validate` | 校验容量与 `expected_generation`，把 `planned`/`failed`/`degraded` 推进到 `capacity_reserved`；“reserved”只是 domain 事实，不锁定真实资源 | 无 |
| `transition` | 按版本化迁移表推进 `observed_state`；`ready` 仍是模拟观察值 | 无 |
| `setDesiredState` | 独立更新期望状态，保持 observed state 不变，并推进 generation | 无 |

每个操作在同一部署记录上串行执行。当前 REST 写请求必须带 `Idempotency-Key` 和
`operator_confirmed=true`，除 `plan`
外还需携带匹配的 `expected_generation`；显式 `operation_id` 用于重放/冲突判断。成功和
拒绝都会写入脱敏审计；状态变化发布 CloudEvents 风格的
`deployment.state.changed`，拒绝发布 `deployment.operation.rejected`。旧 generation 返回
`command.stale`，容量不足返回可重试的 `device.busy`，未知字段/非法迁移返回
`schema.invalid`，同 operation id 不同指纹返回 `idempotency.replay`。这些错误映射在
公开 wire 合约冻结前仍属于 domain 级约定。

上述 mock 方法不代替未来的人工确认闸门；因为它们没有设备/进程副作用，当前控制器不签发
设备命令票据。任何接入真实 provider 的公开写端点都必须逐实例、幂等、显式人工确认并
审计；未来 provider 只能通过版本化、认证的 provider-host/`DeviceAdapter` 端口，
并由用户选择的 manifest 限定命令 allowlist。失败后重新校验，不重放任何输入。

当前 mock REST 路由已注册并写入 OpenAPI：

- `GET /api/v1/deployments`
- `POST /api/v1/deployments/plan`
- `GET /api/v1/deployments/{deployment_id}`
- `POST /api/v1/deployments/{deployment_id}/validate`
- `POST /api/v1/deployments/{deployment_id}/transition`
- `POST /api/v1/deployments/{deployment_id}/desired-state`

尚未启用的扩展包括 `GET /api/v1/hosts/{host_id}/capabilities` 和任何真实 provider
生命周期端点。真实 provider 端点在认证、TLS、RBAC、CSRF、设备授权、人工确认和远程
agent 合约确定前不得启用。当前 API 继续只绑定 loopback；不得通过修改 `bind_host` 绕过
安全前置条件。mock REST 的请求/响应和错误由 OpenAPI 契约测试覆盖；部署事件 payload
schema 已由 `docs/schemas/deployment-state-changed.v1.json` 与
`docs/schemas/deployment-operation-rejected.v1.json` 固定并由事件契约测试覆盖，真实
provider adapter 和跨进程恢复仍需单独版本化和验收。

监听边界集中在 `apps/api/src/config/exposure-profile.ts`：当前激活 `loopback.v1`，
未来 `authenticated-tls.v1` 只在认证、TLS、RBAC、CSRF 和 WebSocket 握手认证全部
就绪并完成负向测试后才能切换。详见 `docs/adr/0003-exposure-profile-boundary.md`。

## 6. 本轮宿主机证据

证据来自 2026-09-01 的只读检查和用户安装截图，不能外推到其他主机：

- Android Studio Standard 安装完成；SDK、Platform-Tools、Emulator、Build-Tools 36
  和 Android Platform 37 文件存在。
- `adb` 版本为 1.0.41 / 37.0.1；官方 Emulator 版本为 37.1.11.0。
- AVD 列表为空，未发现已创建的 AVD；未发现 `scrcpy`。
- 32 逻辑线程、约 32 GiB 物理内存；检查时可用内存约 14--15 GiB。系统盘和数据
  盘余量分别约 79 GiB 与 262 GiB，仅作本机快照。
- 固件虚拟化、SLAT、DEP 报告可用；Android Emulator hypervisor driver 报告尚未
  安装。Windows 可选功能检查需要管理员权限，本轮不据此声称 Hyper-V/WHPX 已启用。
- 本轮未运行 `adb devices`，也未启动 ADB server；没有启动模拟器或安装 APK。工具状态仅
  由显式选择的工具路径检查和静态版本信息获得。

因此下一步 Gate C 是：用户在目标宿主机选择系统镜像和 AVD，完成虚拟化/GPU 检查，
由人工启动单实例并观察 mock App；通过后再做 2、4 实例 ramp test。真实大麦 APK
兼容性、包体完整性和环境监测只能以用户合法取得的 APK/实机人工验收为准，不能用
静态代码或串流供应商宣传替代。部署 domain 的单元/负向测试
（`apps/api/test/deployment-service.spec.ts`）与 REST/OpenAPI 契约测试
（`apps/api/test/openapi-contract.spec.ts`）只验证上述 mock 状态、容量、generation、幂等、
审计和事件边界；测试通过不等于 Gate C 通过，也不授权启动任何外部实例。
