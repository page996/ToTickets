# 宿主机检查与部署规划

## 1. 目的与边界

本文件定义跨宿主机的资源检查、provider 规划和后续部署控制边界。当前实现只做
无副作用的检查和容量估算，不启动 ADB、模拟器、scrcpy、Appium 或第三方应用，
也不发送任何设备输入。`ready` 只表示控制平面/provider 基础设施可用，不表示
第三方页面、账号或购票流程已准备好。

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
| `mock-adapter` | mock | 1 thread | 256 MiB | 1 GiB | 0 | 0 Mbps | 可用于离线测试 |
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

## 5. 部署状态控制设计

后续真实 provider 接入采用 `desired_state` 与 `observed_state` 分离、generation 和
`operation_id` 关联的状态机：

```text
planned -> validating -> capacity_reserved -> provisioning -> starting -> ready
   |             |              |                  |             |
 failed <--------+--------------+------------------+-------------+--> degraded
   |
 stopping -> stopped -> released
```

控制命令必须逐实例、幂等、显式人工确认并审计：`plan`、`validate`、`start`、`stop`、
`restart`。当前仓库只实现 planning/readiness 层，尚未执行这些外部进程命令；未来
适配器必须通过 `DeviceAdapter`/provider host 端口，命令 allowlist 由用户选择的
provider manifest 限定。失败后从 `discovering`/`failed` 重新检查，不重放任何输入。

未来协议可增加：

- `GET /api/v1/hosts/{host_id}/capabilities`
- `POST /api/v1/deployments/plan`
- `POST /api/v1/deployments/{deployment_id}/validate`
- `GET /api/v1/deployments/{deployment_id}`

这些端点在认证、TLS、RBAC、CSRF、设备授权和远程 agent 合约确定前不启用。当前 API
继续只绑定 loopback；不得通过修改 `bind_host` 绕过安全前置条件。

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
静态代码或串流供应商宣传替代。
