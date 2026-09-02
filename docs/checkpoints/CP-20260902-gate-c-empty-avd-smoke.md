# Checkpoint: Gate C empty-system AVD smoke

checkpoint_id: `CP-20260902-gate-c-empty-avd-smoke`
created_at_utc: `2026-09-02T16:01:13Z`
status: `verified_with_gap`
base_git_commit: `aba645fbf7c19cec2e78062c0a101f17d4bde591`

## Scope and non-goals

本阶段登记用户对 `ticket_test_1` 空系统 AVD 的人工 smoke 结果，并用只读进程/ADB
检查交叉核对运行状态。范围只包括启动可达性、画面连续性和人工手机式操作；不把该结果
解释为资源容量、并发能力、真实 APK 兼容性或真实大麦验收。

本阶段不修改源码、依赖、锁文件、默认配置或 helper manifest；不安装 APK，不登录大麦，
不执行验证码、OCR、选票、下单、支付、抓包、逆向或风控规避；不启动项目 API、Vite、
Tauri 或浏览器服务，不停止用户已经启动的设备进程。

## Affected modules and module books

- `M11-host-readiness` / `docs/modules/api-host-readiness.md`：增加 Gate C 空系统 smoke
  的事实引用；不改变 `host-probe.v1` 合约或容量公式。
- `M7-adapter-layer` / `docs/modules/device-adapter.md`：本记录只证明候选设备的人工观察，
  不代表真实 adapter 或 provider-host 已连接。
- `M13-system-helper-policy` / `docs/modules/system-helper-manifest.md`：保持默认拒绝；
  本阶段没有批准或激活任何 helper 条目。

## Files, dependencies, processes and devices

| 范围 | 本阶段事实 |
| --- | --- |
| Git/files | 建立本 checkpoint 前基线工作树 clean；本文件及后续文档补充是本阶段唯一新增/修改内容；无依赖或锁文件变化 |
| AVD | `ticket_test_1`；Android 37 Google APIs；`x86_64`；4 vCPU；2 GiB RAM；10 GiB data；GPU disabled；数据卷由用户选择为 E: |
| 用户报告 | 冷启动到 Android 页面约 90 秒；可到达 Google 加载页和 Android 界面；画面持续刷新，可进行正常手机式操作；用户报告可持续操作且画面正常（未定义时长）；随后用户表示将实例挂起等待 |
| 只读交叉核对 | `adb` PID 7756；`emulator` PID 17760；`qemu-system-x86_64` PID 2904；设备 `emulator-5554` 状态为 `device`，`sys.boot_completed=1` |
| 网络边界 | emulator/ADB listener 仅位于 loopback（5554/5555/8554/5037 等）；未发现项目 API/Vite/Tauri listener |
| 资源快照 | qemu 工作集约 5.2 GiB、私有内存约 2.16 GiB；本次 PowerShell 视图显示 E: 总约 600.0 GiB、剩余约 397.2 GiB；与 2026-09-02 历史预检约 261 GiB 可用的快照不一致，需确认卷映射后复测；这是单次运行态读数，不是承诺 |

路径、PID 和资源读数是本机证据，不得复制到运行时代码、默认 manifest 或公共 API。

## Commands and evidence

用户人工观察（时间由用户回执提供，精确时间未单独记录）：

1. 使用用户创建的 E: 盘 AVD 启动并等待 Android 页面。
2. 观察到约 90 秒冷启动；Google 加载页和 Android 界面均可达。
3. 连续操作期间画面正常，交互表现可对标手机操作。
4. 用户随后将实例置于等待/挂起状态，资源占用尚未由用户采集。

本轮只读复核命令及关键结果：

- `Get-CimInstance Win32_Process`：确认 emulator -> qemu 进程及完整 AVD 名称。
- 显式路径 `adb.exe devices -l`、`get-state`、`shell getprop sys.boot_completed`：返回
  `emulator-5554 device`、`device`、`1`。
- 这些 ADB 查询使用了用户已运行的 `127.0.0.1:5037` daemon；本轮未主动调用
  `start-server`，未新建或停止 daemon。由于 `adb devices` 在无 daemon 时可能产生进程，
  后续正式 test-only 入口仍须显式声明该副作用并绑定 helper 批准。
- `Get-NetTCPConnection`：设备和 ADB 连接均为 `127.0.0.1`/`::1`。
- qemu 两秒 CPU 采样增加（约 `0.28` 至 `0.58` 秒，随采样时点变化），
  `Responding=True`，线程 `WaitReason` 未出现 `Suspended`；因此复核时进程仍是运行态。
- `config.ini`：`hw.cpu.ncore=4`、`hw.ramSize=2G`、`disk.dataPartition.size=10G`、
  `hw.gpu.enabled=no`、Android 37 `google_apis/x86_64`。
- 既有宿主机证据 `CP-20260902-host-preflight` 的预检时点实际记录为
  `HypervisorPresent=False`、`emulator -accel-check` code 6（hypervisor driver 未安装）；
  该历史快照不能作为本次运行时加速结论。后续 operator-run 的启动日志和运行时探针另行
  记录了 WHPX operational/code 0（详见 `CP-20260903-gate-c-multi-followup`），两者按时点
  分开保留，不能互相回填或覆盖。
- 追加只读采样（约 `2026-09-02T16:12:36Z`）：qemu CPU 五秒增量约 `0.953` 秒，
  工作集约 `5.161 GiB`、私有内存约 `2.155 GiB`，进程响应正常；E: 剩余约 `397.2 GiB`。
  这是运行态快照，不能替代固定窗口的资源报告。

“用户挂起”与“操作系统级进程挂起”不是同一状态。本轮不能把窗口最小化、Android Studio
控制项或串流面板状态当作 OS suspend；需要下一次人工复核时以 CPU 增量和线程状态确认。

## Decisions and approvals

- 在既有用户批准的范围内，接受空系统 AVD 作为 Gate C 的第一项 smoke 观察。
- 将本轮结论限定为：启动可达、画面/人工操作初步通过；状态为
  `verified_with_gap`，不授予 helper、真实 provider 或并发部署授权。
- 继续优先 x86_64 和用户选择的数据卷，但部署实现必须保持路径/宿主机可配置，不能以本机
  路径为默认值。
- 加速证据单独记录：后续 operator-run 的 `emulator -accel-check`/启动日志报告 WHPX
  operational/code 0；本 checkpoint 引用的预检快照则是 code 6。用户附图中的 Device
  Manager 横幅仍显示 “Windows Hypervisor Platform is not enabled”，`systeminfo` 又显示
  虚拟机监控程序正在运行。三者属于不同时间点或不同检测层，当前结论是“运行时探针初步
  可用、界面/组件状态待解释”，不是“完全无加速”或“加速配置已验收”。若提示再次出现，
  需保留原始日志/截图并复测相同版本和权限。

## Risks and data handling

- 单实例空系统的约 90 秒启动时间不能外推到 APK、串流、账号数量或并发。
- qemu 实际工作集约 5.2 GiB 高于 AVD 声明的 2 GiB guest RAM；可能包含宿主机映射、缓存
  和图形/模拟器开销，必须用重复采样拆分 idle/boot/操作阶段后再做预算。
- 本次 E: 397.2 GiB 与历史预检 261 GiB 可用值不一致，可能来自采样时间、卷映射或统计
  口径差异；在确认数据目录实际所在卷前，不据此计算容量。
- Hydra 分核/负压配置不是本轮直接故障证据；在高负载或多实例测试时可能增加稳定性风险，
  应保留配置并做受控 A/B，而不是在本 checkpoint 下修改电压或驱动。
- 仅记录设备状态和聚合资源读数；不记录账号、手机号、身份证、验证码、支付信息、屏幕
  敏感内容或真实平台流量。

## Verification status

| 门槛 | 状态 | 说明 |
| --- | --- | --- |
| 空系统单实例启动/进入 Android | `passed (manual)` | 用户约 90 秒观察；ADB boot completed |
| 画面连续与人工手机式操作 | `passed (manual)` | 用户报告，未作自动输入 |
| WHPX/虚拟化可用 | `passed_with_inconsistency` | 探针可用，但 Device Manager/UI 与 `systeminfo` 状态冲突，待解释 |
| 真正挂起/恢复语义 | `open` | 复核时进程仍运行，未证明 OS suspend |
| idle/boot/操作资源采样 | `open` | 尚未按固定窗口采样 |
| 单实例 repeat/soak | `partial_observation` | 用户报告可持续使用且无异常；时长、负载和重复次数未按协议采集 |
| `1 -> 2 -> 4` ramp | `blocked_pending_single_instance` | 先完成资源和稳定性证据 |
| mock APK test-only 验收 | `open` | 仓库当前仍无 mock APK |
| 真实大麦 APK/平台验收 | `out_of_scope` | 只允许用户人工验收，不能自动化或规避检测 |

## Rollback procedure

本 checkpoint 仅为追加文档，不需要回滚运行状态。若文档结论有误，在新 checkpoint 中追加
更正和证据；不得删除或覆盖本文件，不得重写 Git 历史。代码/配置仍回滚到最近已验证的
提交或 checkpoint，且不终止不属于本阶段的 AVD/ADB 进程。

## Next gate

1. 用户恢复或重新启动同一 AVD；在 Windows 任务管理器或项目预检入口记录 idle 5 分钟、
   idle 15 分钟、冷启动和持续操作四个窗口的 CPU、工作集/私有内存、GPU（GPU disabled
   时标为不适用）、E: 活动时间/吞吐/剩余空间。
2. 重复至少一次单实例冷启动和操作 soak，并记录崩溃、黑屏、ADB 断连、恢复时间；先不
   改 Hydra 配置。若出现可复现稳定性问题，再由用户批准保存配置后的默认电压 A/B。
3. 单实例证据稳定后，另建 checkpoint 执行 `1 -> 2 -> 4` ramp；每一步都可停止并保留
   精确进程、端口、资源和清理证据，不能从静态 profile 推导容量。
4. 另建 mock APK 模块书和 test-only harness 后，才把调度/观察测试接入设备；helper
   manifest 仍为空，不能自动接入 ADB/emulator。

本阶段没有关闭 Console 受控实测、SQLite 持久化或系统通知策略的既定顺序；这些仍按用户
后续验收和决策闸门推进。

## Correction append (2026-09-03)

本 checkpoint 第 62--63 行把加速复核错误地指向了
`CP-20260902-host-preflight` 的初始预检段落。该预检段落实际记录的是当时的
`HypervisorPresent=False` 和 `emulator -accel-check` code 6；它不是本次启动后的
运行时证据。后续独立 operator-run 日志（例如被忽略的
`.runtime/r2-avd-multi-20260903/ticket_test_3.stdout.log`）记录了
`WHPX ... detected`/`accelerator is operational`，因此当前结论仍是
`passed_with_inconsistency`：运行时 WHPX 信号与早期预检/UI 探测口径分属不同时间点，
不应写成“无加速”或“加速已完全验收”。本追加只更正证据链解释，不改写原始预检记录。
