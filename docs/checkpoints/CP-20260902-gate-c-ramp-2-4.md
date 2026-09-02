# Checkpoint: Gate C empty-system AVD ramp 2 to 4

checkpoint_id: `CP-20260902-gate-c-ramp-2-4`
created_at_utc: `2026-09-02T16:29:31Z`
status: `verified_with_gap`
base_git_commit: `aba645fbf7c19cec2e78062c0a101f17d4bde591`

## Scope and non-goals

本阶段响应用户批准，继续进行空系统 AVD 多实例资源与稳定性验证，不在单实例 smoke
处停留。目标是按 `1 -> 2 -> 4` 逐步增加实例，记录启动、健康、CPU、内存、磁盘和
端口证据，并在达到资源/稳定性门槛前停止扩展。

本阶段不安装 APK，不连接或自动操作真实大麦，不执行登录、验证码、OCR、输入、选票、
下单、支付、抓包、逆向或风控规避；不启动项目 API/Vite/Tauri，不改变 loopback exposure，
不修改默认 helper manifest。现有用户实例 `ticket_test_1` 保持运行，不由本阶段停止或
改变其数据。

## Affected modules and module books

- `M11-host-readiness` / `docs/modules/api-host-readiness.md`：收集实际实例资源证据，
  不把本次结果直接写回规划 profile 或容量配置。
- `M7-adapter-layer` / `docs/modules/device-adapter.md`：只记录人工/健康观察，不连接
  生产 adapter 或发送设备输入。
- `M13-system-helper-policy` / `docs/modules/system-helper-manifest.md`：本次是 checkpoint
  绑定的人工 R2 操作；默认 manifest 仍为空，未向 API/Console 暴露可执行 helper 端口。

## Approved operation boundary

| 项目 | 约束 |
| --- | --- |
| 保留对象 | 用户现有 `ticket_test_1` 及其 Android Studio/emulator/qemu/ADB 进程，不停止、不改配置 |
| 新增对象 | 实际采用独立的 `ticket_test_2`/`entity2`、`ticket_test_3`/`entity3` writable AVD clone，端口分别 5556/5557、5558/5559；每次只启动一个并等待 boot 完成 |
| 启动参数 | 实际由本阶段 operator 通过显式 emulator 命令启动独立 clone，使用 `-avd`、`-port`、`-no-snapshot`、`-no-boot-anim`；首次对原 AVD 使用 `-read-only` 的尝试因原实例非只读而按工具错误退出；不使用 APK、脚本输入或生产 API |
| 数据边界 | entity2/entity3 与 entity1 数据根隔离，系统镜像可共享；不复制、删除或覆盖 `entity1`；所有日志/采样写入被忽略的 `.runtime` 证据目录。独立 clone 的逻辑目录约 5.28 GiB，包含快照/镜像文件，不能等同实时写放大 |
| 网络边界 | 仅观察 loopback 控制/ADB 端口；不向真实平台发请求；Android 默认网络仅作为系统启动现象记录，不作为业务测试 |
| 停止方式 | 只针对本阶段新实例记录的精确 serial/PID，优先对应 ADB graceful stop，失败才精确 force stop；最后复核端口和 PID 不存在 |

## Resource gates

每增加一个实例前后记录宿主机总/可用内存、qemu 工作集/私有内存、CPU、E: 剩余空间、
GPU 状态和 ADB 健康。以下是停止条件，不是容量承诺：

- 可用物理内存低于 4 GiB，或提交/分页压力持续异常：停止新增并回退本阶段实例；
- 任一已启动实例 boot 失败、ADB 断连、黑屏、崩溃或宿主机出现明显卡顿：停止新增，
  保留日志并进入故障复核；
- 端口/serial 与已存在实例冲突：不重试同一端口，改用新的偶数 console 端口并记录；
- 4 实例启动后若资源仍稳定，只记录观测上限；不自动把 4 写成部署 `safe_instances`。
- 本阶段只读/共享原 AVD 的方案未通过；后续 ramp 必须继续使用已关机后创建的独立 writable
  clone，或另建全只读基线，不能混用两种模式。

## Baseline before ramp

已知基线来自 `CP-20260902-gate-c-empty-avd-smoke` 和只读复核：

- 现有 qemu PID `2904`、emulator PID `17760`、ADB PID `7756`；设备 serial
  `emulator-5554`，`sys.boot_completed=1`。
- 静态 `config.ini` 显示 2 GiB/GPU disabled，但运行时 `hardware-qemu.ini` 显示
  4096 MiB/GPU host；本次必须以启动后进程和运行时配置为准。
- 现有 qemu 工作集约 4.8--5.2 GiB、私有内存约 2.1--2.2 GiB；宿主机总内存约
  31.22 GiB，采样时可用约 13.3 GiB。E: 当前 PowerShell 视图剩余约 397 GiB，
  与旧快照约 261 GiB 不一致，不能直接用于部署容量。

## Actual ramp evidence (2026-09-02 UTC / 2026-09-03 local)

- 第 2 实例 `ticket_test_2`：PID `36080 -> 3784`，serial `emulator-5556`，
  `sys.boot_completed=1`；启动日志报告 boot 约 52.0 秒。运行时覆盖为 4096 MiB、GPU
  host。与原 `ticket_test_1` 并行时两台 qemu 工作集合计约 9.05 GiB、私有内存约
  7.77 GiB，宿主可用内存约 8.99 GiB，E: 约 391.98 GiB。
- 第 3 实例 `ticket_test_3`：PID `36520 -> 2900`，serial `emulator-5558`，
  `sys.boot_completed=1`；启动日志报告 boot 约 51.4 秒。三台 qemu 工作集合计约
  13.93 GiB、私有内存约 13.41 GiB，宿主可用内存约 4.39 GiB；30 秒后约 4.49 GiB，
  commit `33.74/34.98 GiB`（约 96.5%）。
- 第 4 实例未启动：按预设 4 GiB 可用内存/提交压力门槛停止扩展。不能把 3 写入 API
  `max_devices`、provider `safe_instances` 或部署默认值。
- 本阶段新增实例均通过 ADB `emu kill` graceful 退出（5558 于约 16:56:34Z，
  5556 于约 16:58:33Z）；清理后仅原 `ticket_test_1` PID 17760/2904 和用户 ADB
  PID 7756 保留，serial `emulator-5554` 在线。监听仅为 loopback；未发现项目服务。
- entity2/entity3 退出后各约 5.28 GiB logical files、25 files；entity1 约 5.11 GiB。
  E: 当前复核约 386.76 GiB free；与此前约 397 GiB/历史预检约 261 GiB 快照存在口径
  差异，需后续确认卷/统计时点。Windows Application log 同时记录一条 qemu
  `RADAR_PRE_LEAK_64`（不是明确崩溃），因此长期 soak 仍未通过。

本阶段执行主体为 operator/本地显式命令，未通过项目 helper activation；`entries=[]` 和
provider `planningOnly=true` 保持不变。日志文件只留在被忽略目录，报告不复制命令中的
绝对工具路径、gRPC token 或环境变量原文。

## Commands and evidence plan

每个实例的证据至少包括：启动命令行、父子 PID、console/ADB serial、boot 完成时间、
5 分钟 idle 资源采样、人工/健康观察结果、停止时间和清理复核。使用显式工具路径和
PowerShell 只读查询；禁止按进程名批量终止。实例启动输出、错误和采样快照存入本阶段
`.runtime` 子目录，完成后在本文件追加结果和 SHA-256（如生成报告）。

## Decisions, approvals and risks

- 用户已明确批准“添加多实例验证占用问题”，并要求不要停在单实例；本 checkpoint 将其
  解释为继续到 2，再在资源门槛允许时到 4。
- 采用 `-read-only` 是可逆的小决策：避免共享 AVD 写入和大规模复制；它不能证明独立
  数据盘写放大、APK 安装后的占用或生产部署隔离，后续需要独立数据目录 profile。
- 运行时 4 GiB/GPU host 与静态 2 GiB/GPU off 的差异是开放风险；不得通过修改用户 AVD
  配置来“对齐”数字，本阶段只观测。
- Hydra 分核/负压配置不在本阶段修改；若多实例出现崩溃/重启，先保留配置和日志，再
  另建 A/B checkpoint 请求用户确认。

## Rollback procedure

本阶段失败时只停止本阶段新增实例并保留其日志；原有 `ticket_test_1` 不触碰。恢复到
最近已验证 checkpoint 的文档/代码状态，不删除历史证据、不删除用户 AVD 数据、不强制
推送或重写 Git 历史。若只读实例留下锁/临时 overlay，先按精确 PID/serial 确认已退出，
再由用户决定是否清理残留文件。

## Next gate

第 2/3 实例的单次 boot 和短时并行观察已完成；第 4 实例因提交压力门槛未启动。下一步
不是继续压宿主机，而是补做稳定的 5/15 分钟 idle、单实例 repeat/soak、错误/恢复和
Windows WER 复核；只有这些证据稳定，且用户另行批准更高压力试验，才可重新评估第 4
实例。独立 writable clone 与 mock APK 尚未形成项目 provider；不把本阶段结果当作真实
provider 或最终部署上限。

## Profile follow-up gate (approved scope)

为继续验证用户所称的低占用配置，下一次 operator-run 可在已停止的 `entity2` 上显式
指定 `-memory 2048 -gpu off`，只启动一个实例并检查启动日志与运行时 effective config。
若 emulator 仍提升到 4096 MiB、GPU host，或宿主 commit/可用内存触及停止线，则立即停止
该 profile，不追加实例；只有实际低资源配置被确认且单实例稳定，才可在新的结果段落中再
按 `1 -> 2 -> 4` 评估。该对照不修改 `entity1`、项目配置、provider manifest 或 API
容量值，也不代表已批准的 helper activation。

## Follow-up correction and current-status note (2026-09-03)

后续用户要求继续添加多实例并复核占用；完整证据见
`docs/checkpoints/CP-20260903-gate-c-multi-followup.md`。本节只追加，不覆盖本文件中
2026-09-02 的历史 ramp 数字。

- 先前 low-profile 对照的请求参数为 `-memory 2048 -gpu off`，但其 stdout 明确输出
  `Increasing RAM size to 4096MB`，并出现 `lavapipe/swiftshader` fallback；该 profile
  状态为 RAM `not_effective`、GPU `software_renderer_observed/unconfirmed`，不能作为
  低资源并发依据。随后用户/外部 operator 启动的 `ticket_test_2` 是另一轮普通 profile，
  argv 不含这两个 override，effective `hardware-qemu.ini` 为 4096/GPU host。
- 已知 qemu `RADAR_PRE_LEAK_64` 事件发生在 2026-09-02 15:50:23Z，早于 clone ramp
  和本次 follow-up；无 faulting PID/APPCRASH，结论为 `unresolved/no crash observed`，
  不归因于任何 clone 或 Hydra。
- 本次 follow-up 的双实例 `ticket_test_1`/`ticket_test_2` 仍由用户持有并在线；新增
  `ticket_test_3` 只做受保护启动探测，在 commit 95% 线前未完成 boot 后按 serial 精确
  graceful stop。`ticket_test_4` 只创建了配置文件，未启动。旧段落中“新增实例已退出”
  仅指旧 ramp 的新增实例，不描述当前 `ticket_test_2` 的在线状态。
- 早期采样 harness 的 serial 映射/保留变量错误已标为无效；修正后的 JSON instance-map、
  5 分钟双实例、10 分钟恢复窗口和第三实例保护日志才是本阶段有效证据。
