# Checkpoint: recovered validation and release handoff

checkpoint_id: `CP-20260903-release-handoff`
created_at_utc: `2026-09-02T18:48:00Z`
status: `verified_with_gap`
base_git_commit: `aba645fbf7c19cec2e78062c0a101f17d4bde591`

## Scope and non-goals

本 checkpoint 收束恢复接管后的文档一致性修正、项目隔离门禁复验和 Git 交付准备。范围
包括审计时间点/哈希引用、路线图 Gate C 状态和多实例证据索引；不修改源码、依赖、运行时
默认配置、helper allowlist 或 Console 受控测试环境，不启动/停止/重启用户 AVD，不连接
真实大麦或真实账号。

## Affected modules and module books

- `M11-host-readiness`：宿主机事实与 Gate C 证据索引；不拥有设备生命周期。
- `M7-adapter-layer`：仅记录人工/健康观察；没有生产输入能力。
- `M13-system-helper-policy`：`entries=[]`、`execution=not_performed` 保持不变。
- `M10-config-supply-chain`：只复验项目隔离 Node/pnpm/Rust、SBOM 和合规门禁。

## Files, dependencies, processes and devices

- 版本化文件：本 checkpoint 及 `docs/07-implementation-roadmap.md`、
  `docs/12-final-release-audit.md`、`docs/13-host-preflight-and-deployment.md`、M7/M11/M13
  模块书；未修改源码、manifest、lockfile、默认配置或 SBOM 内容。
- 依赖/工具：仅使用仓库 `.tools` Node 24.13.0、pnpm 11.19.0、Rust/Cargo wrapper；没有
  安装新依赖或调用系统 Node/Rust。
- 进程/设备：测试与构建未启动项目 API/Vite/Tauri 窗口、ADB 或模拟器；用户已有
  `ticket_test_1`/`ticket_test_2` 未停止、重启或改变；没有访问真实平台。
- 运行态产物：`dist/`、`target/`、`.runtime/` 仍由 `.gitignore` 排除；只记录可复核 hash，
  不把本机路径或 PID 写入运行时代码。

## Commands and evidence

使用环境注入的 loopback 测试 URL 运行 `scripts/pnpm.ps1 test`，并依次运行
`typecheck`、`build`、`test:load:mock`、`check-compliance.ps1`、合规/SBOM 测试、
`generate-sbom.ps1 -Check`、Cargo `fmt/check/clippy` 和 `scripts/tauri.ps1 build --no-bundle`；
所有命令退出码为 0。完整输出由本轮终端复核，摘要与产物 hash 见本 checkpoint 结果追加及
`docs/12-final-release-audit.md`。

## Decisions and approvals

本轮沿用用户已批准的本地文档修正、隔离门禁复验和 Git 推送授权；没有新增依赖、供应商、
协议、外部网络或 helper 权限。三/四实例扩展仍暂停，`entity2` 保持用户持有，`entity3/4`
目录清理不自动执行；低资源 profile 与更大宿主机的选择保留为下一次重大决策。

## Current evidence

- API `19 suites / 203 tests`、Console `9 files / 81 tests`；workspace typecheck/build、mock
  load self-test、compliance、SBOM、Rust fmt/check/clippy 和 Tauri `--no-bundle` 均通过。
- R1 复验时点的 release executable SHA-256 为 `B80C0BC65048E5B4E7CF3BF67D2A80D99C31BE48D15F30A1D59AE53FE1CB7EAD`；
  最新本次复验值为 `5E074D800FE968A62C656D7143BD1FCD607FED8B454ADCE65524544682D1A485`；
  SBOM SHA-256 保持 `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B`。
- `ticket_test_1`/`ticket_test_2` 保持用户在线；双实例延长基线实际采样 914.2 秒、墙钟
  1019.0 秒，commit `81.446--83.260%`，qemu Private 合计 `7.478--7.480 GiB`。
- `ticket_test_3` 的受保护启动探测在 boot 前达到 commit `95.979%` 后精确停止；
  `entity4` 仅有配置文件，未启动。详情分别见 Gate C follow-up 与 15 分钟基线 checkpoint。
- 当前 exposure 仍只允许 loopback；helper manifest 没有可执行条目。

## Corrections made

- 空系统 smoke 的加速引用改为后续独立运行时 checkpoint，不再把 WHPX operational 结果
  归入早期 `HypervisorPresent=False/code 6` 预检。
- 路线图明确区分“项目 helper/provider 自动启动门槛”和用户单独批准的 operator-run。
- 最终审计将旧哈希保留为历史快照，并增加当前构建 canonical 哈希表；测试数字按时间点
  标注，避免把历史结果混成当前证据。

## Risks and open gates

- 当前 profile 只证明双实例观察上限，不形成 `safe_instances=2` 或最终部署容量承诺；
  继续 3/4 实例前必须选择真正生效的低 RAM/低图形 profile，或改用更大物理/提交内存宿主机。
- 低资源 override 尚未生效；GPU/I/O 按进程归因、目标宿主机专用预检、单实例 repeat/soak、
  Tauri 原生窗口人工验收、SQLite 持久化和系统通知策略仍未完成。
- `entity2` 不得由项目工具自动停止、重启或删除；`entity3/4` 目录和 stale lock 是否清理
  需要用户单独决定。

## Rollback and next decision gate

文档修正可通过保留本 checkpoint 并在新 checkpoint 追加更正来回滚语义；不得删除历史记录
或重写 Git。下一门槛是用户在“低资源 profile”与“更大宿主机”之间选择其一；选择前只做
现有双实例的人工观察/收尾，不启动第四实例。SQLite 仍排在人工验收之后，系统通知策略最后
讨论，Console 受控测试环境保持现状。

## Result append: 2026-09-02T18:55:00Z

`result_status`: `verified_with_gap`

门禁已按本 checkpoint 范围实际复跑：API `19 suites/203 tests`、Console `9 files/81 tests`、
typecheck/build、mock load、compliance、SBOM、Rust fmt/check/clippy 和 Tauri `--no-bundle`
均通过。最新 Tauri release executable SHA-256 为
`5E074D800FE968A62C656D7143BD1FCD607FED8B454ADCE65524544682D1A485`；SBOM 仍为
`40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B`。该 hash 只代表本次
构建时间点，不能据此宣称 bit-for-bit 可复现；测试和构建期间未启动项目服务、Tauri 窗口、
ADB 或模拟器，`ticket_test_1/2` 未被触碰。
