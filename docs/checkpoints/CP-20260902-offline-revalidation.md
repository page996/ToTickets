# Checkpoint: offline revalidation

checkpoint_id: `CP-20260902-offline-revalidation`
created_at_utc: `2026-09-02T11:22:07.645Z`
status: `in_progress`
base_git_commit: `9ef2d71`

## Scope and non-goals

本阶段只在项目内部隔离工具链中重跑离线测试、类型检查、构建、mock load self-test、静态
合规、SBOM 和 Rust/Tauri 检查，以刷新恢复后的可复现证据。允许生成或更新被忽略的
`dist/`、`target/`、`.runtime/` 临时产物；不启动 API、Vite、Tauri 窗口、AVD、ADB、系统
helper 或浏览器，不安装依赖，不访问真实平台，不改变 loopback 配置，不接触账号或 APK。

## Affected modules and module books

验证范围覆盖 `M1-M12` 的现有 mock/API 合约、`M9` Console transport/UI、`M10` 配置与供应链、
`M11` Host readiness 和 `M12` mock deployment；模块定义与治理缺口见
`docs/modules/index.md`、`docs/modules/api-host-readiness.md` 和
`docs/modules/console-control-plane-client.md`。

## Planned commands and evidence

所有 Node/pnpm 命令必须经 `scripts/pnpm.ps1`，Rust 命令经 `scripts/cargo.ps1`，Tauri 命令
经 `scripts/tauri.ps1`。结果在本文件追加记录；命令失败时保留 stdout/stderr、退出码和
生成物时间，不用历史 `.runtime` 结果替代。

## Approvals and risks

用户已批准继续推进并按既定顺序复验；本阶段属于本地 R1。测试可能重建 `dist/`、Rust
`target/` 或校验 SBOM，但这些不应进入源码提交。若发现 tracked 文件被工具修改，将停止
后续命令并逐项核对，不覆盖用户已有修改。

## Rollback

本阶段不改生产源码或运行配置；回滚只需删除本阶段新生成的被忽略临时产物，或恢复到
`9ef2d71` 的 tracked 文件状态。不得用 `reset --hard`、强制推送或删除 checkpoint 回滚。

## Next gate

离线复验完成后，另建 R2 checkpoint 决定是否启动 loopback mock API + Vite/浏览器回归；
真实设备、ADB、AVD、scrcpy 或其他 helper 仍需 `system-helper-manifest.v1` 白名单和独立
人工确认。

## Result append: 2026-09-02T11:36:24Z

result_status: `verified`

### Commands and results

- `scripts/pnpm.ps1 --version` → pnpm `11.19.0`；`scripts/cargo.ps1 --version` → Cargo `1.88.0`。
- `$env:CONSOLE_TEST_API_BASE_URL='http://127.0.0.1:18080/api/v1'; $env:CONSOLE_TEST_EVENTS_URL='ws://127.0.0.1:18080/api/v1/events'; scripts/pnpm.ps1 test` → API `18` suites/`183` tests passed，Console `9` files/`81` tests passed；没有服务监听该端口，所有 endpoint 仅为测试注入值。
- `scripts/pnpm.ps1 typecheck` → API、Console 均通过。
- `scripts/pnpm.ps1 build` → Nest/Vite 均通过；只更新忽略的 `apps/api/dist`、`apps/console/dist`。
- `scripts/pnpm.ps1 test:load:mock` → `mock-control-plane load harness self-test passed`。
- `pwsh -NoProfile -File scripts/check-compliance.ps1` → 通过（120 runtime/command files、3 Node manifests、1 Rust manifest、1 config template）。
- `pwsh -NoProfile -File scripts/check-compliance.test.ps1`、`scripts/tests/check-compliance.Tests.ps1` → 均通过。
- `scripts/generate-sbom.ps1 -Check`、`scripts/tests/generate-sbom.Tests.ps1` → 通过；SBOM `1143` components/`1144` dependency nodes，双次输出字节一致。
- `scripts/cargo.ps1 fmt --manifest-path apps/console/src-tauri/Cargo.toml -- --check` → 通过。
- `scripts/cargo.ps1 check --manifest-path apps/console/src-tauri/Cargo.toml --locked` → 通过。
- 首次未加引号的 `scripts/cargo.ps1 clippy ... -- -D warnings` 被 Cargo 当作错误参数（退出码 1）；按项目 wrapper 文档重试 `scripts/cargo.ps1 clippy --manifest-path apps/console/src-tauri/Cargo.toml --locked --all-targets '--' '-D' 'warnings'` → 通过。
- 在注入 loopback 配置后运行 `scripts/tauri.ps1 build --no-bundle` → Rust release 构建通过；未打开窗口、未启动 API/Vite、未连接设备。

### Artifacts and runtime cleanup

- 新生成的 release executable SHA-256：
  `apps/console/src-tauri/target/release/human-assist-console.exe` →
  `9B941F42060402DD341DCD0D8AA49C0A697C45A02A84B410531F1843D07DC3FB`。
- 当前 SBOM SHA-256 保持为
  `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B`。
- `.runtime/tauri.generated.conf.json`、`dist/` 和 `target/` 均为项目忽略的可重建产物；
  Git tracked 状态除本 checkpoint 外无变化。构建结束后未发现由本阶段拥有的监听端口或
  API/Vite/Tauri/AVD/ADB 项目进程；Codex 自身 node/pwsh 进程未触碰。
- release executable hash 与 2026-09-01 历史审计中的 hash 不同，说明当前 Tauri 构建
  尚未达到 bit-for-bit 可复现；两者都保留为各自时间点的证据，不覆盖历史记录。

### Deviations and next gate

本阶段实际没有修改依赖、manifest、锁文件、SBOM 源文件或运行配置；`scripts/load` 的
根级 `ws` phantom dependency、pnpm SRI/Rust channel hash 强校验和正式 test-only harness
仍是后续治理项。R1 离线复验已闭合，但不产生 R2 设备/外部 helper 授权。下一步若继续，
应新建 R2 checkpoint，先启动 loopback mock API + Vite 做浏览器/移动视口回归，再由用户
确认 Console 受控测试环境；真实 Android 适配器、APK 安装和账号操作仍保持人工闸门。
