# Checkpoint: recovery continuity and current host handoff

checkpoint_id: `CP-20260903-recovery-continuity`
created_at_utc: `2026-09-02T19:20:25Z`
status: `verified_with_gap`
base_git_commit: `7e1074111d28437f41506289db3d430c3bee1829`

## Scope and non-goals

本 checkpoint 记录恢复接管后的只读连续性复核，以及下一阶段的决策闸门。复核确认仓库、
远程分支、Gate C 证据和用户持有的双实例仍处于已知状态；不修改源码、依赖、运行时配置或
helper allowlist，不启动/停止/重启任何 AVD 或项目服务，不删除锁、目录、APK 或测试产物。

本阶段也不连接真实大麦、真实账号或真实 APK，不执行登录、验证码、OCR、设备输入、选票、
下单、支付、抓包、逆向或风控规避。

## Affected modules and module books

- `M11-host-readiness`：复核宿主机资源、工具选择和 Gate C 证据；不拥有设备生命周期。
- `M7-adapter-layer`：确认当前仍只有 Mock 适配器，真实只读 adapter 未激活。
- `M13-system-helper-policy`：`system-helper-manifest.v1` 仍为 `entries=[]`；本次只读检查不是
  helper activation。
- `M10-config-supply-chain`：核对工作树、远程提交、产物哈希和项目隔离边界。

## Files, dependencies, processes and devices

- Git：复核开始前 `main` 与本地 `origin/main` 跟踪引用相同（`7e10741`），工作树干净；本
  checkpoint 与三份文档澄清构成本次 tracked 变更，未修改源码、依赖或 ignored 运行产物。
- 当前在线设备（用户持有，禁止自动处置）：
  - `ticket_test_1` / `emulator-5554`：emulator PID `17760`，qemu PID `2904`。
  - `ticket_test_2` / `emulator-5556`：emulator PID `35324`，qemu PID `1848`。
  - ADB server PID `7756`，只监听 loopback `127.0.0.1:5037`。
- 两台设备复核均为 `device`、`sys.boot_completed=1`、`mWakefulness=Awake`；qemu
  `Responding=True`。当前监听仍只包含两台实例的 loopback 控制/ADB 端口。
- `entity1`/`entity2` 的活动锁与 PID 绑定，禁止删除或修改；`entity3` 只有停止探测留下的
  stale `multiinstance.lock`，`entity4` 只有 `config.ini`，两者均未自动清理。
- 项目隔离工具链、Node/pnpm/Rust lockfile、API/Console 代码和 SBOM 未发生变更。

## Commands and evidence

只读核对得到以下当前快照（资源值随操作系统运行而变化，不是部署承诺）：

| 指标 | 当前观察 | 解释 |
| --- | ---: | --- |
| 宿主总内存 | `31.219 GiB` | 本机快照 |
| 可用物理内存 | `12.718 GiB` | 满足后续探测的预检值，但不是容量授权 |
| 提交占用 | `29.244 / 35.738 GiB`，`81.830%` | 仍需在启动前重新采样 |
| E: 可用空间 | `386.691 GiB` | 逻辑卷空间，不代表镜像实际写入曲线 |
| qemu 工作集 | `2.798 + 0.717 GiB` | Windows working set，不能替代 Private/Commit |
| qemu Private | `2.099 + 5.407 GiB` | 双实例当前观测 |

当前实际产物 hash 与上一个 release handoff 一致：

- Tauri executable：`5E074D800FE968A62C656D7143BD1FCD607FED8B454ADCE65524544682D1A485`
- SBOM：`40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B`

SDK/AVD 只读盘点确认四个名称均登记在 Android SDK 的 AVD 列表中，数据根位于用户选择的
`E:\\ticket-test\\entity1..4`。`ticket_test_3` 的有效历史探测仍为 boot 前触发
`commit_ge_95` 并精确停止；`ticket_test_4` 仍是配置文件而非完整实例。

盘点时执行了只读的 `sdkmanager --list`。工具报告 deprecated 提示并尝试发布 analytics，
随后因网络连接超时退出；没有安装、更新、删除或改变任何 SDK 包，亦未启动设备或项目服务。
该网络副作用仅作为本 checkpoint 的偏差记录，不作为项目 helper 能力或供应商验证。

## Decisions and approvals

- 继续遵守当前只允许 loopback 的 exposure；不能把 loopback 现状写成永久架构限制，未来远程
  扩展仍需认证/TLS/RBAC/CSRF 等新版本门槛。
- 保留用户此前对本地 mock 验证、宿主机只读检查和多实例 operator-run 的批准；本次没有
  将其扩大为 helper/provider 自动化授权。
- 当前 profile 的有效运行配置仍会从静态 `2 GiB/GPU off` 覆盖到约 `4096 MiB/GPU host`；
  因此不能继续盲试第四实例，也不能把双实例观察写成 `safe_instances=2`。

## Risks and data handling

- 双实例延长窗口和第三实例保护探测已经形成宿主事实，但低资源 profile、按进程 GPU/I/O、
  固定时长 soak、目标宿主机复测和真实 APK 兼容性仍未闭合。
- `entity3` stale lock 可能是停止探测残留；在确认无活动 PID 前不应删除，清理需要用户单独
  批准。活动实例锁永远优先保持不变。
- 当前 API/Console 为内存 repository；重启会清空数据。SQLite 必须在人工验收之后单独建
  模块书、保留策略和迁移 checkpoint；系统通知策略排在 SQLite 之后讨论。

## Rollback procedure

本 checkpoint 仅新增审计记录，无运行时回滚动作。若文档语义需要更正，保留本文件并在新的
checkpoint 追加更正；不得删除历史记录、重写 Git 历史、强制推送或触碰在线实例。任何后续
operator-run 必须保存新增证据，并只按记录的 serial、命令行和 PID 精确回收新增进程。

## Next gate

下一门槛由用户选择其一：

1. 在不改变宿主机的前提下，先设计并验证真正生效的低 RAM/低图形 AVD profile，再做单实例
   repeat/soak 和受保护的 `1 -> 2 -> 4` ramp；或
2. 改用具有更大物理/提交内存的目标宿主机，并重新做目标机 preflight 与 ramp。

在选择前，项目可继续进行不触碰设备的文档/测试准备和用户人工验收；不启动 `entity4`，不
   自动清理 `entity3` stale lock，不把当前资源快照写成部署容量。人工验收通过后按既定顺序进入
SQLite 持久化，系统通知策略最后另行讨论。

## Result append: 2026-09-03 local

- 文档更正提交为 `80871bd`（恢复连续性/当前门槛）和 `6aa7e17`（模块书路径与枚举事实）。
- `git diff --check`、静态合规检查和合规自测均通过；未重新运行全量构建，因为本轮没有源码
  或依赖变更，既有 R1 证据仍按原 checkpoint 引用。
- 第一次、第二次 `git push` 因到 `github.com:443` 的瞬时连接失败；网络恢复后重试成功。
  `git fetch origin main` 与 `git ls-remote origin refs/heads/main` 均确认远程 `main` 为
  `6aa7e17bffb91ad1d04e66f6a5986ce4adeed796`，本地工作树干净。
- 推送期间及之后复核确认 `ticket_test_1`/`ticket_test_2`、ADB server 和活动锁未被触碰。
