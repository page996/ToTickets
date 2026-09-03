# Checkpoint: low-resource entity5 ramp

checkpoint_id: `CP-20260903-low-resource-entity5`
created_at_utc: `2026-09-03T11:53:57Z`
status: `verified_with_gap`
base_git_commit: `4cd0732caea571f5b4566a6d7cfcb51409f1827e`

## Scope and decision

用户已批准建立新的独立低资源实例并继续测试。本阶段建立 `ticket_test_5`，数据目录为
`E:\\ticket-test\\entity5`，使用 Android 37 Google APIs `x86_64` system image；不启动或
改造 `entity4`，不触碰用户持有的 `entity2`，并保留在线 `ticket_test_1`。

首选运行参数为 `-lowram -cores 2 -memory 2048 -gpu host`；若 host backend 无法启动或
画面不稳定，才在同一独立目录使用 `-gpu swiftshader_indirect` 作为可复现 fallback。参数
必须由启动后的进程命令行和 `hardware-qemu.ini` 复核，静态 `config.ini` 不作为生效证据。

## Affected modules and ownership

- `M11-host-readiness`：拥有本阶段资源门槛、实例映射、GPU/renderer、磁盘和 ramp 证据；不
  拥有项目服务启动或生产容量默认值。
- `M7-adapter-layer`：只记录 operator-run ADB/Emulator 健康、画面和系统 App smoke；不提供
  自动输入。
- `M10-config-supply-chain`：记录 Android SDK package provenance、checkpoint 和回滚；不把
  主机绝对路径写入运行时代码。

## Creation, test and guard contract

- 只使用已安装并显式选择的 Android SDK `avdmanager`、`emulator` 和 `adb`；不安装真实大麦
  APK，不登录、不输入、不抓包、不调用私有接口。
- 创建前确认 `entity5` 路径不存在或为空、目标端口 `5560/5561` 空闲、无同 AVD 进程/锁，
  主机 Free RAM `>=8 GiB` 且 commit `<=85%`。
- 单实例启动后记录 emulator/QEMU PID、命令行、effective config、renderer、boot/ADB、
  listener、QEMU Working/Private、主机 Free RAM/commit、磁盘变化和固定时长 Settings
  smoke。通过后才进入双低资源实例窗口。
- 双实例 ramp 继续使用 Free RAM `>=8 GiB`、commit `<=85%` 的启动门槛；观察中 `<6 GiB`
  或 `>90%` 停止扩展，`<4 GiB`、`>=95%`、ADB 断连、黑屏或 WER 时只精确停止新增 serial。
- 结束时优先 `adb -s <serial> emu kill`，确认同一命令行的进程和端口消失后再归档本阶段
  产生的锁；不按名称批量终止，不删除 AVD 数据目录。

## Rollback and next gate

若创建/启动失败，保留失败日志和目录状态，禁止用 `entity4` 替代；仅在确认无活动进程/锁
后由用户批准清理 `entity5`。成功的单实例结果只能作为双实例低资源 ramp 输入，不能直接
写入 `safe_instances`、`max_devices`、provider manifest 或部署默认值。人工 Console/Tauri
验收仍先于 SQLite，系统通知策略最后讨论。

## Result append: 2026-09-03T12:04:29Z

### Creation and effective profile

- 已在用户批准的独立目录 `E:\\ticket-test\\entity5` 创建 `ticket_test_5`，使用 Android
  37 Google APIs `x86_64` 镜像；本阶段没有启动或改造 `entity4`，没有触碰 `entity2`。
- 启动命令由运行时进程复核为：
  `emulator.exe -avd ticket_test_5 -port 5560 -no-snapshot -no-snapshot-save -no-boot-anim -qt-hide-window -lowram -cores 2 -memory 2048 -gpu host`。
- `hardware-qemu.ini` 复核到 `hw.cpu.ncore = 2`、`hw.ramSize = 2048`、
  `vm.heapSize = 512`、`hw.gpu.enabled = true`、`hw.gpu.mode = host`；effective 配置哈希为
  `BF8DB0F02597D56E1863B10BB719B0E4BC97BF29AA95A018EB0561A23C29B694`。
- 启动日志识别到 NVIDIA GeForce RTX 5080 Laptop GPU、Vulkan 1.4.351 和 NVIDIA
  OpenGL ES Translator；WHPX accelerator operational。日志同时保留 legacy
  `opengl32sw` 缺失及回落到系统 OpenGL 的警告，因此这不是 software-only 结论。

### Fixed five-minute observation

证据文件位于被忽略的 `.runtime/r2-avd-entity5-20260903/`：
`ticket_test_5-host-boot.json`、`ticket_test_5-host-5m.json`、对应 stdout/stderr 和
六张 Settings smoke 截图。`emulator-5560`（Emulator PID `10408`，QEMU PID `28456`）
在 30 个样本中保持 `device`/`sys.boot_completed=1`、进程响应；6/6 次 Settings 启动、
截图和内存检查健康；仅显式启动 Settings，未发送触摸、文本或购票流程输入。观测指标为：

| 指标 | 结果 |
| --- | ---: |
| 最低可用物理内存 | `11.359 GiB` |
| commit 范围 | `87.126--87.730%` |
| QEMU Working Set | `2.937--3.006 GiB` |
| QEMU Private | `3.615--3.758 GiB` |
| 保护触发 | 否 |

### Cleanup and decision gate

- 观测完成后仅对已核对 serial 执行 `adb -s emulator-5560 emu kill`；Emulator/QEMU
  进程及 `5560/5561` loopback listener 已消失，`ticket_test_1` 保持在线。`entity5` 数据
  目录保留，未删除镜像或锁文件。
- 单实例 host-GPU smoke 已验证；资源 commit 高于双实例启动规划线 `<=85%`，所以本结果
  只作为第二个低资源 writable clone 的 ramp 输入，不更新 `safe_instances`、`max_devices`、
  provider manifest 或部署默认值。双低资源固定窗口、GPU/I/O 归因和可控扩展仍未闭合。
- 产品流程仍按既定顺序先完成用户人工 Console/Tauri 签收，再讨论 SQLite；系统通知策略
  保持最后讨论。容量评估则独立进入现有 `entity3 + entity5` 的低资源双实例固定窗口；
  两个门槛并列且不能互相替代。真实 APK 下载在确认合法来源后另行评估。
