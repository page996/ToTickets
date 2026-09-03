# API 模块开发书：Host Readiness & Planning

**module_id**：`M11-host-readiness`（canonical；旧别名 `api.host-readiness` 仅用于迁移）
**版本**：`host-readiness.v1`
**implementation**：`active`（只读 planning 已由代码/测试确认）
**governance**：`partial`（本书是第一版示范，HostPlannerPort、专用 preflight runner 和递归书页尚未闭合；helper policy 已独立登记）
**负责人边界**：API Host Planning owner（当前由 `apps/api/src/hosts` 负责；未指定个人责任人）
**父模块**：M11-host-readiness
**源码边界**：`apps/api/src/hosts/*`、`apps/api/src/config/*` 的配置消费边界、
`config/provider-manifest.schema.json`（协议/静态校验来源）以及 OpenAPI 契约中的 host/provider 部分

## 1. 职责与非职责

职责是读取显式选择的工作卷和工具文件状态，生成 `host-probe.v1`，从编译期冻结的
`PROVIDER_MANIFESTS` registry 提供 `provider-manifest.v1` 规划数据，并计算带保留量的容量
规划。`config/provider-manifest.schema.json` 是 wire/schema 校验来源；当前 service 不在
每次请求时读取或重新验证该文件，这属于后续 provenance gate。

本模块不启动 ADB、模拟器、scrcpy、helper 或第三方应用，不安装 APK，不发送设备输入，也
不把容量结果当成部署授权。真实 provider 的执行必须通过另一个版本化 provider-host/
`DeviceAdapter` 端口和人工确认闸门。

## 2. 状态、变量与不变量

### 2.1 服务调用状态

`HostService` 无持久化可变状态。一次请求的逻辑状态为
`not_invoked -> collecting -> derived -> reported`；异常或不可探测值在 `derived` 阶段
转为 `unknown`/`not_checked`，不会启动补偿进程。该状态机是模块边界记录，不是当前代码中
可恢复的运行状态。

共享 owner：

| 资源 | owner | 生命周期/保留 |
| --- | --- | --- |
| runtime config（`storage.data_dir`、`tools.*`、`limits.max_devices`） | `RuntimeConfigModule`/配置校验层 | 进程生命周期；不由 HostService 写回 |
| OS 资源快照 | `collectResources` 的本次调用 | 内存临时值；不落盘、不跨请求共享 |
| provider manifest registry | `provider-manifests.ts` 的冻结常量 | 版本发布时更新；请求只读 |
| 容量/检查结果 | HostService 响应 | 不持久化；不作为部署锁或队列 |
| 审计记录 | API audit 模块 | HostService 不直接拥有或写入 |

### 2.2 HostResourceSnapshot 与 HostCheck

`HostResourceSnapshot` 的 TS 字段为 `cpuThreads`、`memoryMib`、`availableMemoryMib`、
`diskFreeGib`、`vramMib`，wire 字段由响应转换为 `cpu_threads`、`memory_mib`、
`available_memory_mib`、`disk_free_gib`、`vram_mib`。磁盘/GPU 未知使用 `null`，不得猜测为零。
`HostCheck` 的字段为 `status`（`pass|warn|fail|unknown|not_checked`）、可选
`observed`/`required`/`remediation` 和 `source`。

当前保留常量（源码 `host.service.ts`）：

| 常量 | 值 | 语义 |
| --- | ---: | --- |
| `CPU_RESERVE_THREADS` | 2 | 从 CPU 规划中预留控制平面/系统线程 |
| `MEMORY_RESERVE_MIB` | 4096 | 从可用内存中预留 |
| `DISK_RESERVE_GIB` | 20 | 从显式工作卷余量中预留 |
| `STARTUP_CONCURRENCY_MAX` | 2 | 单次容量规划允许的最大启动并发 |

### 2.3 ProviderManifest 与 ProviderCapacity

`ProviderManifest` 的 owner 是冻结 registry；字段包括 `schemaVersion`、`providerId`、
`kind`、`planningOnly`、`capabilities`、`requirements`、`instanceProfile`、
`maxInstances`、`notes`。所有内置能力固定 `userInput=false`、`automation=false`。
`ProviderCapacity` 是调用时派生值，不持久化，字段包括 `safeInstances`、
`controlPlaneLimit`、`effectiveInstances`、`startupConcurrency`、`limitingResources`、
`unknownResources`、`confidence`。

不变量：`effectiveInstances <= safeInstances` 且不超过控制面上限；启动并发不超过 2；未知
GPU/磁盘使 `confidence=unknown`，不伪造 `measured`。当前 `calculateProviderCapacity` 只
使用 `instanceProfile`、保留量和控制面上限计算，尚未用 `requirements` 做单独准入判断；
这必须在未来 planner port 中明确。

## 3. 函数与端口

当前函数是进程内实现，不应被当作远程合同。超时列为“未定义”表示代码尚未提供独立
timeout；未来 provider-host 端口必须另行冻结 timeout/cancellation。

| 入口 | 类型/前置条件 | 后置条件与错误 | 超时/幂等 |
| --- | --- | --- | --- |
| `HostController.probe()` → `GET /api/v1/hosts/probe` | API 配置已通过 `runtime-config.v3` | 200 `HostProbeResponse`；统一异常过滤器映射 500 `InternalError`；响应附 `request_id` | 当前同步调用，无显式 timeout；只读、重复调用无状态副作用 |
| `HostController.providers()` → `GET /api/v1/hosts/providers` | `limits.max_devices` 已校验，registry 已导入 | 200 `HostProvidersResponse`；500 `InternalError`；`planning=estimated_until_ramp_test` | 当前同步调用，无显式 timeout；只读、重复调用无状态副作用 |
| `collectResources(dataDir?: string)` | `dataDir` 为空或来自用户显式选择的配置 | 返回快照；`statfs` 失败令 `diskFreeGib=null`；不抛出路径 | 纯函数/OS 查询；无幂等键 |
| `calculateProviderCapacity(resources, manifest, controlPlaneLimit=Number.MAX_SAFE_INTEGER)` | 数值为有限非负资源；manifest profile 已由 registry 提供 | 返回保守容量；未知资源保留 `null`/`unknown`；当前未单独校验 `requirements` | 纯函数；相同输入相同结果 |
| `providerManifest(providerId: string)` | provider ID 为字符串 | 返回只读 manifest 或 `undefined` | 纯查找；无副作用 |
| `loadRuntimeConfig()`/配置校验 | 配置文件或允许的环境变量候选 | schema/地址/路径非法时进程不启动；不向 HostService 提供未校验值 | 启动期一次；配置不持久化 |

请求路径和 schema 的真源是 `docs/openapi.v1.json`：成功响应分别引用
`#/components/responses/HostProbe`、`HostProviders`，响应 schema 是
`HostProbeResponse`/`HostProvidersResponse`；字段使用 snake_case，错误 envelope 保留
`code`、`message`、`request_id`、`retryable` 和可选脱敏 `details`。Host 模块没有当前
WebSocket、CloudEvents、进程或设备通信端口；未来 provider-host 才可增加单独版本合同。

## 4. REST、事件与共享资源

| 方向 | 合约 | 副作用 | owner |
| --- | --- | --- | --- |
| Console/Operator → API | `GET /api/v1/hosts/probe` + `RequestIdHeader` | 无 | HostController/HostService |
| Console/Operator → API | `GET /api/v1/hosts/providers` + `RequestIdHeader` | 无 | HostController/HostService + frozen manifest registry |
| Host Planner → Deployment domain | capacity snapshot（当前 controller 内部传值） | 仅进程内计算；不锁定资源 | 当前 DeploymentController；待 `HostPlannerPort` 独立化 |
| API → Console | `HostProbeResponse`/`HostProvidersResponse` | 无 | `docs/openapi.v1.json` |

当前没有 CORS/WS 特有副作用；API 的 loopback/exposure policy 和请求 ID 由共享 API 层
负责。HostService 不拥有设备、部署记录、Console 状态或审计保留策略。

## 5. 递归子模块登记

以下边界已识别但尚未各自建立书页，因此本模块 governance 仍为 `partial`：

| 子模块 ID | 源码边界 | implementation | 连接门槛 |
| --- | --- | --- | --- |
| `M11-C1-types` | `apps/api/src/hosts/host.types.ts` | active | schema 漂移测试、owner 明确 |
| `M11-C2-resource-probe` | `collectResources`、`HostCheck` helpers | active | test-only probe port、平台特定权限审查 |
| `M11-C3-manifest-registry` | `provider-manifests.ts` + JSON schema | active | provenance/hash、requirements 准入规则；当前仅 planning |
| `M11-C4-capacity-planner` | `calculateProviderCapacity` | active | `HostPlannerPort`、ramp-test 输入/输出；当前仅 planning |
| `M11-C5-rest-transport` | `host.controller.ts` + OpenAPI exposure | active | DTO/response contract、auth/RBAC |
| `M11-C6-config-boundary` | `apps/api/src/config/runtime-config.ts` 的 tools/storage/limits 消费 | active | 显式路径、loopback、配置审计 |
| `M11-C7-test-harness` | `apps/api/test/host-service.spec.ts` fixtures | planned | `host-readiness.test.v1` formal test-only harness |

## 6. 专用测试入口与证据

当前可复用入口是 `collectResources`、`calculateProviderCapacity` 和 `HostService` 的构造器
fixture；它们直接 import 生产函数，尚未封装为正式版本化 `test-only` port。测试仅使用
合成资源、项目相对的缺失路径和当前进程 executable 作为存在性 fixture，不连接设备或真实平台。

历史验证证据（2026-09-01，未在本 checkpoint 重新运行）：

- `apps/api/test/host-service.spec.ts`：保留量、上限、未知资源、启动并发、显式路径和无回退路径；
- `apps/api/test/openapi-contract.spec.ts`：装饰路由、成功/500 schema、snake_case 和引用解析；
- `apps/api/test/api.e2e.spec.ts`、`config.spec.ts`、`exposure-profile.spec.ts`：运行时暴露、配置
  和 loopback 边界；
- `docs/12-final-release-audit.md`：项目隔离 wrapper 下的全量测试/构建/合规和历史 loopback 证据。

必须持续保留的负向测试/审计断言：

- 未选择工具时不通过 PATH、注册表、`ANDROID_SDK_ROOT` 或用户目录猜测；
- 磁盘/GPU/虚拟化未知时不伪造容量或 `measured` 结论；
- provider 上限、控制面上限和保留量不能被客户端 DTO 覆盖；
- probe/providers 不启动外部进程、不安装 APK、不回显路径、主机名或秘密；
- 非 mock provider 的 deployment REST 请求在 DTO 层 fail closed，并产生通用拒绝审计；
- 测试 fixture 不得把真实账号、APK、设备序列号或屏幕帧写入日志/快照。

验证命令必须经项目 wrapper（例如 `scripts/pnpm.ps1 test`）；本轮文档校验使用
`git diff --check` 和窄范围文本/字段扫描，未启动 API/Vite/Tauri/AVD，也未执行外部网络动作。
历史动态服务和浏览器的精确清理记录见 `docs/12-final-release-audit.md`；本轮只读扫描进程
已按精确命令核对并退出。

## 7. Helper、连接门槛与人工验收

仓库现已登记 `system-helper-manifest.v1` 的严格 schema 和默认空 allowlist；当前没有任何
可执行 helper 条目。`toolCheck` 仍仅做 `statSync().isFile()` 存在性检查，不验证可执行权限、
版本、hash、许可证、参数/环境或资源上限，因此它不能替代
`M13-system-helper-policy` 的 parser。任何 ADB、emulator、scrcpy 或其他 helper 连接都
必须先通过独立 helper manifest checkpoint；未登记、路径/版本/hash 不匹配时 fail closed，
并记录启动、健康、停止、崩溃恢复、审计和回滚方式。HostService 本身不得绕过该门槛。

进入真实 AVD/USB/远程串流前必须依次通过：

1. 项目内部工具链和显式 helper/provider manifest 校验；
2. 目标宿主机 CPU、内存、工作卷、虚拟化、GPU、SDK/ADB 路径的专用 probe；
3. 单实例人工观察和审计；
4. 按 `1 → 2 → 4` 递增的 ramp test，只有实测结果才能替换规划 profile。

当前用户提供的 `ticket_test_1`/AVD 资料及 2026-09-02 预检属于宿主机输入快照，不是本
模块部署授权或兼容性结论。当前仓库没有 mock APK，因此首个 Gate C 只能是空系统 AVD
smoke；真实大麦操作始终由用户人工完成，不进行包体/环境检测规避或私有接口调用。

## 8. 结论分类与 checkpoint

| 类别 | 本模块结论 |
| --- | --- |
| 已由代码/测试确认 | loopback API 只读路由、snake_case OpenAPI 响应、资源保留/上限公式、未知值 fail-safe、内置能力无输入/自动化；历史全量验证见 `docs/12-final-release-audit.md` |
| 工程假设 | `HostPlannerPort`、provider-host REST/WS、递归 test harness 和 ramp-test profile 可作为二次开发起点，但尚未实现 |
| 待用户/平台确认 | 目标宿主机 GPU/虚拟化、AVD/实体设备/串流供应商、并发开销、EULA/费用、真实 APK 兼容性和平台环境监测表现 |

首次登记关联 `CP-20260902-module-governance-baseline`；本书不覆盖旧证据、不授权设备操作。
后续任何 helper、provider、容量公式或 schema 改动必须创建新的 checkpoint，记录输入快照、
证据和回滚方式。回滚是恢复到最近已验证 checkpoint 的文档/提交状态，不删除测试证据。

## 9. 2026-09-02 宿主机快照

当前只读快照登记在 `docs/checkpoints/CP-20260902-host-preflight.md`：发现
`ticket_test_1`（Android 37 Google APIs、`x86_64`，4 vCPU、2 GiB RAM、10 GiB data，GPU
关闭），主机 32 线程/约 31.22 GiB RAM/E 盘约 261 GiB 可用；固件虚拟化和 SLAT 可用，
但 hypervisor driver 检查失败且 Windows 可选功能需管理员权限。该快照不构成容量或
兼容性承诺，也不授权启动 AVD。仓库当前没有 mock APK，Gate C 的首个 smoke 范围需另行
记录。

待办：建立 `HostPlannerPort` 和版本化输入 DTO；实现目标宿主机 GPU/虚拟化 preflight
runner；为纯函数和 service 建立正式 test-only port；为递归子模块建立书页；在不覆盖
`docs/12`/`docs/13` 历史内容的前提下持续追加 host snapshot。helper manifest 的策略和
负向测试已由 `docs/modules/system-helper-manifest.md` 与
`apps/api/test/helper-manifest.spec.ts` 登记，实际 helper 条目仍待 R2 批准。

## 10. 2026-09-03 Gate C 空系统 smoke 补充

新的人工/只读证据见
`docs/checkpoints/CP-20260902-gate-c-empty-avd-smoke.md`。用户已在
`ticket_test_1`（Android 37、Google APIs、`x86_64`、4 vCPU、2 GiB RAM、10 GiB data、
GPU disabled）完成一次空系统观察：冷启动约 90 秒，可进入 Google 加载页和 Android
界面，画面持续刷新并可进行人工手机式操作；用户报告可持续操作且画面正常（未定义时长）。该结果只
把“单实例启动/人工观察”标为 `passed (manual)`，把稳定性标为未定时的
`partial_observation`，不把 AVD 注册为项目 helper 或 provider。

本模块整体仍为 `partial`/`verified_with_gap`：资源快照、真实挂起/恢复语义、固定时长
重复与 soak、`1 -> 2 -> 4` ramp、目标宿主机复测和 mock APK 尚未闭合。一次只读采样显示
qemu 宿主工作集约 5.2 GiB、私有内存约 2.16 GiB，不能用 guest RAM 静态值替代并发预算。
Device Manager 的 WHPX 提示与 `systeminfo`/`emulator -accel-check` 结果不一致，需保留
为开放风险；不能据此放宽 helper 白名单或 loopback 边界。

多实例观察见 `docs/checkpoints/CP-20260902-gate-c-ramp-2-4.md`：独立 `entity2`/`entity3`
均 boot 成功，但三台 qemu 并行时宿主 commit 约 96.5%，第 4 台按门槛未启动。该证据只
用于后续 planner/profile 复测，不能直接替换 `provider-manifest.v1` 中的规划值；固定时长
idle/soak、I/O、GPU/温度和 writable clone 的实际写入曲线仍待补齐。

## 2026-09-03 follow-up 证据

`docs/checkpoints/CP-20260903-gate-c-multi-followup.md` 补充了一次独立的多实例容量复核：
双实例在 5 分钟和回收后约 10 分钟窗口中 ADB/boot/进程均稳定；第三实例启动探测在
commit `95.979%` 前触发保护并精确退出，未完成 boot；第四实例未启动。该 follow-up 是
宿主机事实输入，不是 `HostService` 的部署默认值，也没有激活 helper/provider。

本模块的容量结论继续采用 fail-safe：只有目标宿主机的显式 profile、有效运行配置和固定
窗口证据才能进入未来 `HostPlannerPort` 输入；静态 `config.ini` 的 2 GiB/GPU-off 与
运行时 4096 MiB/GPU-host 不一致，低资源参数未形成可用 profile。当前 M11 的治理状态
仍为 `partial`，真实 provider、认证、跨进程恢复和正式 test-only probe port 未完成。

`CP-20260903-gate-c-baseline-15m.md` 又记录了双实例约 15 分钟量级延长基线：实际采样
914.2 秒，commit `81.446--83.260%`、Private 合计 `7.478--7.480 GiB`，两台 ADB/boot/
唤醒状态全程正常。该证据仍是宿主机事实输入，不是 `safe_instances` 或 provider 接入授权。

## 11. 低资源 profile 候选（2026-09-03）

用户已选择低资源优先。Candidate A 的 `-memory 2048 -gpu off` 被 Android Emulator
提升为 `4096MB`，因此不纳入 profile。Candidate B 的 operator-run 输入为
`-lowram -cores 2 -memory 2048 -gpu software`；effective 配置为 2 核、2 GiB、heap
512，GPU software 因 `opengl32sw` 缺失回落 `lavapipe`。在 baseline 实例旁的 30 样本
窗口中，QEMU Private 约 3.55 GiB，commit `84.30--84.80%`，可作为下一轮 ramp 的候选。

该候选仍是 M11 的观测输入，不改变 `PROVIDER_MANIFESTS`、`safe_instances`、
`max_devices` 或部署默认值。正式 planner 输入前，必须建立独立第二个低资源 writable
clone，完成低资源双实例固定窗口与受保护 `1 -> 2 -> 4` ramp，并分别记录 GPU/I/O 和
目标宿主机差异。详细证据见 `docs/checkpoints/CP-20260903-low-resource-profile.md`。

GPU renderer follow-up（详见 `docs/checkpoints/CP-20260903-gpu-renderer.md`）确认：
`-gpu host` 可使用宿主 NVIDIA GPU，`-gpu swiftshader_indirect` 可使用内置 SwiftShader，
均通过 5 分钟离线 Settings smoke。`opengl32sw.dll` 缺失使 `-gpu software` legacy 路径
仍为风险；这些结果不进入容量公式或部署默认值，必须与 I/O、温度和按进程 GPU 归因分开
记录。
