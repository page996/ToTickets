# Checkpoint: Gate C multi-instance follow-up and commit-pressure probe

checkpoint_id: `CP-20260903-gate-c-multi-followup`
created_at_utc: `2026-09-02T18:02:22Z`
status: `verified_with_gap`
base_git_commit: `aba645fbf7c19cec2e78062c0a101f17d4bde591`

## Scope and non-goals

本 checkpoint 记录用户要求的“不要停在单实例，继续添加多实例验证占用”的后续 operator
run。目标是把单实例低占用、双实例稳定占用、第三实例启动峰值和数据目录逻辑占用分开
测量，并在宿主机提交压力线触发时停止扩展。

本阶段不安装 APK，不连接或自动操作真实大麦，不执行登录、验证码、OCR、设备输入、
选票、下单、支付、抓包、逆向或风控规避；不启动项目 API/Vite/Tauri，不改变 loopback
exposure、provider `safe_instances`、API `max_devices` 或 helper manifest。用户已有的
`ticket_test_1` 与 follow-up 开始时已存在的 `ticket_test_2` 均保留运行，未由清理步骤停止。

## Modules and approval boundary

- `M11-host-readiness`：只记录真实宿主机/AVD 观测，不把结果写成部署容量承诺。
- `M7-adapter-layer`：只做人工/健康状态观察；没有连接生产 `DeviceAdapter`。
- `M13-system-helper-policy`：本阶段是用户批准的本地 operator-run，不是 helper activation；
  `entries=[]`、`planningOnly=true` 保持不变。
- 运行时采样与启动脚本仅存于被忽略的 `.runtime/r2-avd-multi-20260903/`，不是生产
  代码、正式 helper 或发布依赖。

用户已批准启动独立 AVD 做多实例占用验证。停止边界为：新增实例若 commit 达到 95%、
可用物理内存低于 4 GiB、ADB/进程失效或出现可归因的新崩溃迹象，只对该新增 serial
执行定向 graceful stop；不按进程名批量清理，不删除锁或用户数据。

## Host and instance inventory

| instance | data reference | console/ADB | observed process | follow-up state |
| --- | --- | --- | --- | --- |
| `ticket_test_1` | `entity1` | `5554` / `emulator-5554` | emulator `17760` -> qemu `2904` | 保留在线；原用户实例 |
| `ticket_test_2` | `entity2` | `5556` / `emulator-5556` | emulator `35324` -> qemu `1848` | 保留在线；follow-up 开始时已存在，按用户持有实例处理 |
| `ticket_test_3` | `entity3` | `5558` / `emulator-5558` | emulator `2836` -> qemu `8424` | 本次探测在 commit 保护线停止，未完成 boot |
| `ticket_test_4` | `entity4` | `5560` 未使用 | 无 | 仅创建 `config.ini`，不是可启动/已验收实例 |

`adb` PID `7756` 和现存设备端口均只监听 loopback。项目服务未启动。`ticket_test_1` 的
父链曾由 Android Studio -> emulator -> qemu 组成；`ticket_test_2` 的启动器父 PID 在
复核时已退出，因此不推断其 launcher 身份。所有 PID、路径和端口只属于本机证据，不得
复制到运行时代码或默认配置。

## Effective configuration

三个独立数据根的静态 `config.ini` 都声明 `hw.ramSize=2G`、`hw.gpu.enabled=no`、
`hw.cpu.ncore=4`；启动后生成的 `hardware-qemu.ini` 对当前 Android 37 Google APIs
`x86_64` profile 显示 `hw.ramSize=4096`、`hw.gpu.enabled=true`、`hw.gpu.mode=host`。
请求 `-memory 2048 -gpu off` 的先前 low-profile 日志也记录了 `Increasing RAM size to
4096MB`，并出现软件渲染 fallback；因此低资源 profile 状态为 `not_effective`（RAM）和
`software_renderer_observed/unconfirmed`（GPU），不得据静态配置预算并发。

本 follow-up 的 `ticket_test_2` 请求 argv 为 `-avd ticket_test_2 -port 5556
-no-snapshot -no-snapshot-save -no-boot-anim -qt-hide-window`，没有隐含的 2 GiB/GPU-off
覆盖。第三实例请求 argv 同样显式记录在 probe metadata；实际日志包含 WHPX 检测和
NVIDIA Vulkan 选择。CPU 加速、GPU 后端和 Android Studio UI 横幅是三个独立信号；当前
`emulator -accel-check`/运行日志显示 WHPX 可用，但 Device Manager 横幅仍不一致，结论
保持 `passed_with_inconsistency`，不写成“无加速”。

## Valid evidence

### Two-instance idle window

有效报告：`.runtime/r2-avd-multi-20260903/two-idle-5m-valid2.samples.json`。

- 窗口：`2026-09-02T17:31:50Z` 至 `17:36:34Z`，10 个样本，约 284.3 秒。
- 两个 ADB serial 全程 `device`，`sys.boot_completed=1`，`mWakefulness=Awake`。
- qemu 工作集合合计 `8.349--8.353 GiB`；Private Memory 合计约 `7.476 GiB`。
- 宿主可用物理内存 `8.043--8.672 GiB`；commit `84.381--87.139%`。
- NVIDIA 主机级显存观测约 `2.8--3.3 GiB` 使用（不是按实例分解）；E: 剩余约
  `386.7 GiB`（GiB 口径）。

### Third-instance protected probe

有效报告：`ticket_test_3-probe.events.jsonl`、`ticket_test_3-probe.meta.json` 及同目录
stdout/stderr。第三台于 `2026-09-02T17:41:49Z` 启动，qemu PID `8424` 出现后：

| elapsed | ADB | qemu WS / Private | host free / commit |
| ---: | --- | ---: | ---: |
| 0.0 s | not found | not present | `11.582 GiB` / `93.352%` |
| 6.8 s | offline | `0.780 / 4.654 GiB` | `10.851 GiB` / `93.549%` |
| 13.0 s | device, boot unset | `1.481 / 4.997 GiB` | `10.167 GiB` / `94.756%` |
| 19.3 s | device, boot unset | `2.121 / 5.130 GiB` | `9.462 GiB` / `95.979%` |

`commit_ge_95` 保护条件触发；按 `adb -s emulator-5558 emu kill` 定向停止，约
`2026-09-02T17:42:12Z` 复核 qemu、serial 和 `5558/5559` 均消失。第三台没有达到
`sys.boot_completed=1`，所以本次结果是“启动分配峰值失败/受保护停止”，不是第三实例
兼容性或应用验收通过/失败。

### Post-ramp two-instance recovery window

有效报告：`.runtime/r2-avd-multi-20260903/two-post-ramp-10m.samples.json`。

- 窗口：`2026-09-02T17:46:54Z` 至 `17:56:52Z`，20 个样本，约 598.9 秒。
- 两个 ADB serial 全程 `device`、boot=1、Awake；qemu 均 `Responding=True`。
- qemu 工作集合合计 `7.002--7.019 GiB`；Private Memory 合计 `7.477--7.478 GiB`。
- 宿主可用物理内存 `10.877--11.128 GiB`；commit `81.337--82.751%`。
- 工作集合在回收第三台后下降，Private Memory 基本不变；这是 Windows working-set
  trimming/运行态差异，不能把两个指标混为一谈。

### Disk and GPU scope

复核时各数据根逻辑文件量约为：`entity1 5.105 GiB`、`entity2 5.303 GiB`、
`entity3 5.297 GiB`；`entity4` 只有约 3.5 KiB 的 `config.ini`。逻辑文件量包含稀疏
镜像、snapshot 和 qcow2 元数据，不等同实时物理写入量、APK 增量或可部署容量。E: 剩余
约 386.7 GiB。`nvidia-smi` 的显存、利用率和温度是主机级聚合（本窗口约 2.8--3.4 GiB、
0--37%、55--62 C），没有按 qemu 进程归因，因此 GPU 预算仍未闭合。

## WER and acceleration correlation

已知 qemu `RADAR_PRE_LEAK_64` 事件时间为 `2026-09-02T15:50:23Z`（本地 23:50:23），
早于本 follow-up 的 clone probe 和此前 clone ramp；事件没有 faulting PID 或 APPCRASH，
结论为 `unresolved/no crash observed`，不能归因于第三实例、Hydra 或某一 qemu。探测日志
的 crashdata detection 是模拟器自带诊断，不等于发生崩溃。本轮未发现新的 qemu APPCRASH。
Hydra 分核/负压配置未修改；若要归因，必须另建保留配置的单变量 A/B checkpoint。

## Evidence quality and deviations

早期两次双实例采样因 serial/AVD 参数映射错误而被判为无效；第三实例第一次探测因
PowerShell 保留变量名冲突而被中断。它们均没有作为容量证据，修正后的显式 instance-map
和保护脚本才产生上述有效报告。此偏差记录在本 checkpoint，避免把失败 harness 输出当作
测试通过。

## Artifacts and hashes

以下 SHA-256 使用小写表示，文件位于被忽略的运行证据目录：

| artifact | SHA-256 |
| --- | --- |
| `two-idle-5m-valid2.samples.json` | `213abf8a2fa527abe610b69f335a30e67c3096e1be6ec8812b451813204beaf7` |
| `two-post-ramp-10m.samples.json` | `bfeb71303db19532978be0aa4f3a62c7f50b00e056018d76183988085419af7f` |
| `ticket_test_3-probe.events.jsonl` | `71bf30ca523c5564ec20231c580a18fd1f9266331f314d37333fbf55787e7b6f` |
| `ticket_test_3-probe.meta.json` | `f84fdd8525b5d64a1b69f269b9715163d462ee5746a1eae456e82ca383edb776` |
| `ticket_test_3.stdout.log` | `3f80b12f171ecaec08a0cf6d90cc7ebe50fbfac2967616bcf0110304e5f4f949` |
| `ticket_test_3.stderr.log` | `b6eaeacb382b7c62d87f5577e442ba03e94d6c5e94ed6b0b8ab42c99c677cbb8` |

工具版本为 Android Emulator `37.1.11.0`、ADB `37.0.1-15733141`；工具 hash 已在
既有宿主机 checkpoint 登记。本阶段不把本机绝对工具路径、gRPC token、ADB 公钥或任何
账号/屏幕敏感内容写入版本化报告。

## Result and next gate

本 follow-up 的工程结论是：在当前 Android 37 `x86_64` 有效运行配置和约 32 GiB 宿主机
上，双实例可完成至少 5 分钟 idle 和约 10 分钟恢复窗口；第三实例在 Android boot 前
触发约 96% commit，不能安全完成启动；第四实例未启动。用户所称“单实例不高于 10 GB”
必须拆成工作集、Private/Commit、逻辑磁盘和实际 I/O 四个指标，不能直接推出 3/4 台容量。

下一门槛：

1. 若目标是 3/4 台，先选择真正生效的低 RAM/低图形 profile 并做单实例 repeat/soak，
   或提供更大物理/提交内存的宿主机；不能继续在当前 profile 盲试第四台。
2. 低资源 profile、GPU 温度/按进程显存、writable clone I/O 和固定 15 分钟以上 soak
   仍未闭合；它们必须另建 checkpoint。
3. `entity2`、`entity3`、`entity4` 的保留/清理由用户决定；本阶段不删除任何目录或锁。
4. 真实 APK、真实账号和平台人工验收仍不在自动化测试范围；mock APK/test-only harness
   尚未建立。

回滚仅指停止本阶段新增进程并保留运行证据；不得删除 checkpoint、重写 Git 历史或触碰
用户现有 `ticket_test_1`/`ticket_test_2`。

## GPU fallback wording clarification append (2026-09-03)

第三实例 stdout 还出现 `Failed to load opengl32sw` 及 software OpenGL fallback，随后
选择系统 OpenGL/NVIDIA Vulkan/GLES host backend。该信号只记录为 GPU backend fallback
警告，不能解释为 CPU/WHPX 未加速，也不能据此宣称 GPU-off 已验证；GPU 结论仍保持
`software_renderer_observed/unconfirmed`，并与 WHPX CPU 加速信号分开评估。

## Result append: dual-instance extended baseline (2026-09-03 local / 2026-09-02 UTC)

在不停止或重启用户持有的 `ticket_test_1`/`ticket_test_2` 前提下，追加完成了双实例
延长资源窗口。原始分段和聚合结果均保留在被忽略的 `.runtime/r2-avd-multi-20260903/`：

- `two-baseline-15m-20260903.samples.json`：29 个样本，活动采样 882.1 秒；
- `two-baseline-15m-tail-20260903.samples.json`：2 个样本，活动采样 32.1 秒；
- `two-baseline-15m-aggregate-20260903.json`：31 个样本，墙钟跨度 1019.0 秒，实际
  采样 914.2 秒，中间分段间隔 104.9 秒（该间隔未被隐瞒或填充）。聚合文件 SHA-256
  为 `1b72737219fd934b9f196f21f5e747a0153d9086b45a24dc826b1810d1e68e5e`。

覆盖期间两台 ADB 均为 `device`、`sys.boot_completed=1`、`mWakefulness=Awake`，qemu
均 `Responding=True`。宿主可用物理内存范围为 `12.303--13.055 GiB`，commit 为
`81.446--83.260%`；两台 qemu working set 合计为 `3.393--4.176 GiB`，Private 合计
为 `7.478--7.480 GiB`。E: 逻辑剩余从约 `386.693` 到 `386.691 GiB`，未见可归因的
增长。`nvidia-smi` 仍是主机聚合观测，不能按 qemu 进程分摊显存或 GPU 温度。

该延长窗口把“当前 profile 的双实例短时资源/健康观察”补齐到约 15 分钟量级，但由于
分段间隔、未执行人工业务操作和未完成按进程 GPU/I/O 归因，仍不形成 `safe_instances`
或部署容量授权。代码/配置、loopback 边界、helper allowlist 和在线实例状态均未改变。
