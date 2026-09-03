# Checkpoint: approved AVD instance restore and runtime verification

checkpoint_id: `CP-20260903-instance-restore`
created_at_utc: `2026-09-03T09:58:30Z`
status: `verified_with_gap`
base_git_commit: `236f9c7ef9e05f7063bd8fd33b592fca8ead8b64`

## Scope and non-goals

本阶段根据用户批准，恢复用户已有的 `ticket_test_1`/`entity1` 与
`ticket_test_2`/`entity2`，并执行空系统 AVD 的启动、ADB、健康、端口和短时资源稳定性
复核。Android Studio 重启由用户完成；本阶段不启动 `entity3`/`entity4`，不创建新 AVD，
不修改在线实例配置，不清理任何锁或目录。

不连接真实大麦、真实账号或第三方 APK，不登录、不输入验证码、不执行设备输入、购票、
抓包、逆向或风控规避；不启动项目 API/Vite/Tauri/helper。之后只推送已存在的文档提交，
不把运行时产物加入 Git。

## Affected modules and module books

- `M11-host-readiness`：资源、端口和 AVD 运行事实；不拥有数据目录生命周期。
- `M7-adapter-layer`：仅记录用户人工启动的 Android Emulator 观察结果；真实只读 adapter
  未激活。
- `M10-config-supply-chain`：验证项目工作树与远程提交，不改变依赖或源码。

## Files, dependencies, processes and devices

- 目标 AVD：`ticket_test_1 -> E:\\ticket-test\\entity1`、`ticket_test_2 ->
  E:\\ticket-test\\entity2`；目标 serial/端口为 `emulator-5554`/5554 和
  `emulator-5556`/5556。
- 工具仅使用用户已安装的 Android Emulator/ADB；本阶段不把 SDK 路径写入运行时代码或
  helper manifest。
- 启动前记录 ADB/Emulator/QEMU PID、命令行、端口和活动锁 PID；停止时只允许按 serial
  `emu kill`，并在进程/端口消失后复核，禁止按名称批量终止。
- 保护阈值：启动前可用物理内存 `>=8 GiB` 且 commit `<=85%`；扩展/恢复后若可用内存
  `<6 GiB` 或 commit `>90%` 暂停后续扩展；可用内存 `<4 GiB`、commit `>=95%`、ADB
  断连、黑屏或 WER 时仅精确停止本阶段目标。

## Commands and evidence

执行前只读确认 Android Studio/ADB、AVD 元数据、活动锁与选定端口；启动命令的参数、PID、
boot 状态、资源曲线、监听地址和退出结果追加到本文件。验证包括：`adb devices -l`、
serial 对应 AVD 名称、`sys.boot_completed=1`、进程响应、loopback listener、至少 5 分钟
双实例观察；资源数值是时间点快照，不构成容量承诺。

## Decisions and approvals

- 用户批准恢复现有实例、执行运行测试，并在测试后推送代码；期间用户不操作。
- 当前仍只允许 loopback；不激活真实 helper/provider，不改变 `safe_instances`、API
  `max_devices` 或部署默认值。
- `entity1`/`entity2` 活动锁不可触碰；`entity3` stale lock 和 `entity4` 配置不在本阶段
  自动清理范围。

## Risks and data handling

恢复可能导致宿主机内存/commit 峰值、ADB 断连、黑屏或 QEMU/WER 事件；触发阈值时停止后续
扩展并保留脱敏日志。只记录 PID、端口、状态和聚合资源，不记录账号、屏幕内容或敏感字段。

## Rollback procedure

若启动失败或触发保护线，仅对本阶段恢复/启动的目标按记录的 serial 执行 graceful `emu kill`，
复核对应 emulator/qemu PID 与 listener 消失；不删除锁、不按名称终止、不触碰另一台用户实例。
文档/代码回滚通过保留 checkpoint 并追加更正完成，不重写 Git 历史。

## Next gate

双实例保护性基线和恢复后稳定性完成后，执行项目隔离静态门禁并推送本地提交；若门禁失败，
保留现场与证据，暂停后续实例扩展。Tauri 原生人工验收、正式 Console harness、mock APK、
SQLite 和系统通知仍按路线图顺序，不在本阶段启动。

## Result append: 2026-09-03T10:20:22Z

`result_status`: `verified_with_gap`

### Restore and preflight evidence

- Android Studio 重启后按已批准范围恢复现有 AVD；启动前可用物理内存约 `15.75 GiB`、
  commit `60.68%`，E 盘可用空间约 `386 GiB`。未启动 `entity3`/`entity4`。
- `ticket_test_1`：serial `emulator-5554`，emulator PID `39288`，QEMU PID `21008`，
  `device`、`sys.boot_completed=1`，进程 `Responding=True`。命令行使用 AVD 名称、端口
  `5554`、`-no-snapshot`、`-no-snapshot-save`、`-no-boot-anim` 和 `-qt-hide-window`。
- `ticket_test_2`：双实例观察期间 serial `emulator-5556`，emulator PID `25644`，QEMU
  PID `23196`，`device`、`sys.boot_completed=1`；其退出由保护阈值触发后的精确停止完成。

### Protected runtime evidence

- 双实例报告：`.runtime/r2-avd-restore-20260903/dual-instance-5m.json`，25 个样本，
  `2026-09-03T10:08:21.839Z` 至 `2026-09-03T10:12:54.999Z`（约 4 分 33 秒）。两台设备
  全程 `device/boot=1`、QEMU 响应；可用内存约 `7.125–7.448 GiB`，commit `93.99–95.05%`。
  最后一个样本达到 `95.05%`，报告记录 `GuardReason=commit_ge_95_percent`、
  `StoppedByGuard=true`。
- 按记录的 serial 仅执行 `adb -s emulator-5556 emu kill`。随后 `ticket_test_2` 的进程、
  端口 `5556/5557` 和硬件锁 PID 均消失；没有按名称批量终止，也未触碰 `ticket_test_1`。
- 单实例报告：`.runtime/r2-avd-restore-20260903/single-instance-5m.json`，30 个样本，
  `2026-09-03T10:13:52.634Z` 至 `2026-09-03T10:19:30.348Z`（约 5 分 38 秒）。
  `emulator-5554` 全程 `device/boot=1`、QEMU PID `21008` 响应；可用内存
  `12.235–12.663 GiB`，commit `77.13–77.37%`，未触发保护线。

### Post-test read-only verification

在 `2026-09-03T10:20:22Z` 复核：ADB 仅列出 `emulator-5554`；监听仅为 loopback
`127.0.0.1:5037`、`127.0.0.1/::1:5554/5555`，无 `5556/5557`。`entity1` 的
`hardware-qemu.ini.lock/pid` 仍为 `21008`，`entity2` 的硬件 PID 锁不存在但零字节
`multiinstance.lock` 保留；`entity3` 的零字节 stale lock（`2026-09-02T17:41:50Z`）
和 `entity4` 配置均未修改。项目 API/Vite/Tauri/helper 未启动，loopback-only 边界未改变。

### Interpretation and next gate

恢复、ADB/boot、端口隔离和单实例观察均通过；双实例在当前 profile 接近宿主机 commit 上限，
因此本结果不能证明双实例安全容量，也不授权启动第三实例。下一步先运行静态合规门禁并推送
既有提交；扩展实例前必须另行选择并批准低资源 profile 或更大宿主机，并重新完成预检。

## Gate append: 2026-09-03T10:23:06Z

- 使用仓库 `.tools` Node/pnpm wrapper，并注入 `http://127.0.0.1:18080/api/v1` 与
  `ws://127.0.0.1:18080/api/v1/events` 作为 test-only loopback endpoint：API `19` suites/
  `203` tests、Console `9` files/`81` tests 全部通过。测试期间该端口没有项目服务监听。
- `scripts/check-compliance.ps1` 通过：扫描 runtime address/path、production command、Node/Rust
  manifests 和 configuration templates，未发现静态违规；`git diff --check` 通过。
- 本 checkpoint 的唯一未提交路径为本文件；运行时报告仍留在被忽略的 `.runtime/`，未纳入提交。
