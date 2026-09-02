# Checkpoint: documentation consistency and current-state index

checkpoint_id: `CP-20260903-documentation-consistency`
created_at_utc: `2026-09-02T19:37:30Z`
status: `verified_with_gap`
base_git_commit: `64b7b1700d5fc8d8d685f9291792f20160a69a12`

## Scope and non-goals

本阶段只修订审计、路线图和溯源索引，使历史时点证据、当前 canonical 证据和待决门槛
不再被误读为同一轮结果。范围不包括源码、依赖、运行时默认配置、数据库、helper 白名单、
设备生命周期或 Console 交互行为。

本阶段不启动/停止/重启 API、Vite、Tauri、ADB、模拟器或其他宿主进程，不删除或修改
`entity1`/`entity2` 活动锁、`entity3` stale lock、`entity4` 配置，不连接真实大麦、真实
账号或第三方 APK。

## Affected modules and module books

- `M10-config-supply-chain`：记录远程引用与当前构建哈希的时间点边界。
- `M11-host-readiness`：记录 Gate C 当前状态索引和低资源/更大宿主机门槛。
- `M7-adapter-layer`：确认双实例观察不等同于真实 provider 接入。

对应模块书和治理规则未改变；本阶段没有建立模块间新连接。

## Files, dependencies, processes and devices

- 修改：`docs/12-final-release-audit.md`、`docs/07-implementation-roadmap.md`。
- 新增：本 checkpoint 文件。
- 依赖、锁文件、SBOM、源码和默认配置：未修改。
- 现场设备保持用户持有状态：`ticket_test_1`/`emulator-5554`（emulator PID
  `17760`，qemu PID `2904`）和 `ticket_test_2`/`emulator-5556`（emulator PID
  `35324`，qemu PID `1848`）；ADB server PID `7756`。本阶段未对这些进程执行写操作。

## Commands and evidence

只读在线引用复核于 `2026-09-02T19:36:45Z`（UTC）执行：

```text
git ls-remote origin refs/heads/main
64b7b1700d5fc8d8d685f9291792f20160a69a12 refs/heads/main
```

修改前工作树干净，`main`、本地 `origin/main` 跟踪引用与该 SHA 一致。补丁保持
`git diff --check`、静态合规和文档引用检查作为本阶段退出门槛；没有重新运行源码构建，
因为本阶段不改变源码或依赖。

## Decisions and approvals

- 沿用用户已批准的 loopback、本地 mock 验证、人工验收优先和多实例 operator-run 边界。
- 不把当前 profile 的双实例观察写成 `safe_instances=2` 或部署容量承诺。
- `entity3` stale lock 与 `entity4` 目录仍不自动清理；活动实例锁不可触碰。
- 低资源 profile 与更大宿主机的选择保留为下一重大决策；在选择前不启动第四实例。

## Risks and data handling

文档中的旧预检、R1 哈希和历史测试数字仍保留，均明确标注时间点；当前 canonical 哈希与
远程 SHA 仅表示对应复核时刻，不证明 bit-for-bit 可复现、真实 APK 兼容性、认证安全或
购票能力。运行态 PID、路径和资源读数只进入 checkpoint/忽略目录证据，不进入运行时代码。

## Rollback procedure

不删除历史段落。若本次索引语义需要调整，保留本文件并新增 checkpoint 追加更正；可通过
恢复到 `base_git_commit` 的文档版本进行人工对比，但不得重写 Git 历史、强制推送或删除
证据文件。设备回滚不适用，因为本阶段未改变设备。

## Next gate

用户选择“当前宿主机的真正生效低 RAM/低图形 profile”或“更大物理/提交内存宿主机”后，
再建立独立模块书和 checkpoint，执行目标宿主机 preflight、单实例 repeat/soak、GPU/I/O
观测及受保护 ramp。Tauri 原生窗口人工验收仍优先于 SQLite；系统通知策略最后另行讨论。

## Result append: 2026-09-02T19:42:52Z

- `git diff --check` 通过；`scripts/check-compliance.ps1` 通过（0 violations）。
- 本阶段提交已在本地创建：`6a0f9aa862378039fa67c2cbac0be68f90036289`。
- 向 `origin/main` 的三次推送尝试（普通 HTTPS 两次，随后显式 HTTP/1.1 一次）均因到
  `github.com:443` 的连接重置/连接失败而退出；没有修改 remote URL 或执行 force push。
- 远程在线引用最后成功核验仍为前一 SHA `64b7b1700d5fc8d8d685f9291792f20160a69a12`；
  当前本地状态为 `main...origin/main [ahead 1]`，工作树干净。网络恢复后应只执行
  `git push origin main`，再用 `git ls-remote origin refs/heads/main` 核对新 SHA。

随后为记录本追加结果又建立了本地提交 `8c7925adf05a7fdd03db0f1628b11f4ed0c17e21`；
截至 `2026-09-02T19:47:46Z`（UTC），最终本地状态为 `main...origin/main [ahead 2]`，
工作树干净。该状态覆盖上面的时间点描述，待网络恢复后应推送两个本地提交。
