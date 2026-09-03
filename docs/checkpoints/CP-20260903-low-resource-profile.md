# Checkpoint: low-resource AVD profile evaluation

checkpoint_id: `CP-20260903-low-resource-profile`
created_at_utc: `2026-09-03T10:35:00Z`
status: `verified_with_gap`
base_git_commit: `08138ccfa2fef025063c3e9805f9b83c884f3c15`

## Scope and decision

用户已选择“低资源优先”作为下一阶段方向，并接受继续按人工 Console/Tauri 验收、
SQLite、系统通知的顺序推进。本阶段只评估一个显式低资源 AVD 启动候选，不把它写入
生产默认配置或 `safe_instances`，不启动 `entity4`，不触碰用户持有的 `entity1`/`entity2`
配置，不连接真实大麦或第三方 APK。

候选运行参数为 Android Emulator CLI 的显式 `-memory 2048 -gpu off`，数据目录仍使用
用户选择的 `E:\ticket-test\entity3`，端口使用 loopback `5558`/`5559`。参数是否真正
覆盖 AVD 的有效 QEMU 配置必须通过进程命令行、运行时资源和固定观察窗口复核；静态
`config.ini` 不作为生效证据。

## Affected modules and ownership

- `M11-host-readiness`：记录 profile 输入、宿主机预检、资源预算和 ramp 证据；不拥有
  AVD 数据目录生命周期。
- `M7-adapter-layer`：仅记录 operator-run 的 ADB/Emulator 状态和健康观察；没有输入能力。
- `M10-config-supply-chain`：checkpoint、运行时报告和门禁结果可追溯；不改变源码依赖。

## Guard rails and rollback

- 启动前要求可用物理内存 `>=8 GiB`、commit `<=85%`、目标端口空闲且无同 AVD 活动锁。
- 观察中若可用内存 `<6 GiB` 或 commit `>90%`，暂停后续扩展；若可用内存 `<4 GiB`、
  commit `>=95%`、ADB 断连、黑屏或 WER，仅按记录的 serial 精确停止本阶段新增实例。
- 结束或触发保护时优先执行 `adb -s emulator-5558 emu kill`，轮询至进程和端口消失；
  仅核对同一 command line 的 PID 后才允许精确 force stop。禁止按名称批量终止、删除
  AVD 目录或修改活动锁。
- 本阶段不把 ADB/emulator 加入 `config/system-helper-manifest.v1.json`；这是用户批准的
  operator-run 观察，不是项目 helper/provider 激活。

## Evidence to collect

记录启动命令、emulator/QEMU PID、serial、`sys.boot_completed`、有效的 `-memory/-gpu`
参数、loopback listener、固定时长资源曲线（Free RAM、commit、QEMU Working/Private）、
ADB/进程响应、停止结果和目录/锁状态。报告放在被忽略的 `.runtime/` 目录，不提交屏幕、
账号或其他敏感信息。

## Decision gate

只有低资源参数在目标宿主机的固定窗口和受保护 `1 -> 2 -> 4` ramp 中均达到门槛，才可
追加新的 profile manifest/部署建议；否则保留为失败或未知候选，改用更大宿主机。无论
结果如何，人工 Console/Tauri 验收仍先于 SQLite，系统通知策略最后单独讨论。

## Result append: 2026-09-03T10:52:25Z

### Candidate A: explicit memory/GPU flags

- `ticket_test_3` / `emulator-5558` 使用 `-memory 2048 -gpu off` 启动并完成 30 个样本、
  约 5 分钟观察；全程 `device/boot=1`、QEMU 响应，commit `89.60--89.92%`、可用内存
  最低 `9.415 GiB`。
- Emulator 日志明确记录 `Increasing RAM size to 4096MB`；effective
  `hardware-qemu.ini` 为 `hw.ramSize=4096`、`hw.gpu.enabled=true`、`hw.gpu.mode=lavapipe`。
  QEMU Private 约 `5.56 GiB`，未达到低资源目标，因此该候选不接受为 profile。
- 报告：`.runtime/r2-avd-low-resource-20260903/ticket_test_3-5m.json`。

### Candidate B: low-RAM/low-core profile

- 同一 `entity3` 使用 `-lowram -cores 2 -memory 2048 -gpu software` 启动；QEMU 命令行和
  effective 配置均保留这些资源参数，`hw.cpu.ncore=2`、`hw.ramSize=2048`、`vm.heapSize=512`。
- GPU software 在本机因 `opengl32sw` 缺失失败，运行时回落到 `lavapipe`；这是待处理的
  图形后端风险，不能记录为 GPU off 或独立显存预算。
- 固定窗口报告：`.runtime/r2-avd-low-resource-20260903/ticket_test_3-lowram-5m.json`，
  30 个样本，`2026-09-03T10:47:06.916Z` 至 `2026-09-03T10:52:01.967Z`；全程
  `device/boot=1`、进程响应，可用内存最低 `11.867 GiB`，commit `84.30--84.80%`，
  QEMU Private 约 `3.55 GiB`。该结果是“基线实例 + 一个低资源候选”的混合观察，不等同
  于两台低资源实例容量。
- 停止仅执行 `adb -s emulator-5558 emu kill`，进程和 listener 均已消失。两次运行留下的
  零字节锁均在确认无活动进程/端口后归档为 `multiinstance.lock.stale-20260903-run1`
  和 `multiinstance.lock.stale-20260903-run2`；原锁内容未修改，AVD 目录保留。

### Decision gate after evaluation

Candidate B 可作为下一轮 ramp 的候选输入，但尚未写入 `provider-manifests.ts`、部署默认值、
`safe_instances` 或 `max_devices`。下一轮需要独立的第二个低资源 writable clone，先做两台
低资源实例的固定窗口，再按受保护 `1 -> 2 -> 4` 递增；GPU 后端和目标宿主机差异必须单独
记录。`entity1` 活动锁继续绑定 QEMU PID `21008`，`entity2` 和 `entity4` 未被本阶段触碰。
