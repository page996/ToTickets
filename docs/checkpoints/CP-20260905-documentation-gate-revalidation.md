# Checkpoint: documentation and isolated gate revalidation

checkpoint_id: `CP-20260905-documentation-gate-revalidation`
created_at_utc: `2026-09-04T16:09:21Z`
status: `verified_with_gap`
base_git_commit: `ba6e3b2eecebe1c5b547d2a9329d013a23b35d28`

## Scope

本阶段收束 APK M14 文档一致性修订，并在不启动设备、真实 App、项目服务或外部 helper 的
条件下重跑项目隔离工具链门禁。修订范围为路线图、研究报告、模块索引、M14 模块书、APK
来源/静态 checkpoint 和最终审计；不改变生产代码、接口、依赖、配置默认值、loopback 边界
或 APK 安装资格。

## Changes and evidence

- M14 明确 `source_candidate_recorded`、`source_anchor_status`、`source_identity_anchor`、
  `stage_decision`、`reason_class` 和 `install_allowed` 的职责；派生 CDN 候选保持
  `derived` + `false`，静态结果保持 `rejected`。
- 4 KB/16 KB `zipalign` 已列为 Android 37 安装硬门槛；`apkanalyzer` 权限命令的退出码
  `1` 及 `aapt2` 成功替代路径已记录；下载脚本实际的改名/哈希顺序已如实记录。
- CP-20260904 的六个核心附件哈希与 `.runtime/apk-evaluation-20260903/static-20260904/`
  逐项一致；没有将 APK 放入 Git、SBOM、发布物或 helper allowlist。

## Isolated verification (2026-09-04 UTC)

使用仓库 `.tools` wrapper 和临时 loopback 环境完成：

| Check | Result |
| --- | --- |
| `scripts/pnpm.ps1 test` with injected loopback endpoints | API `19 suites/203 tests`、Console `9 files/81 tests`，通过 |
| `scripts/pnpm.ps1 typecheck` | 通过 |
| `scripts/pnpm.ps1 build` | Nest/Vite 通过 |
| `scripts/pnpm.ps1 test:load:mock` | 通过 |
| `scripts/check-compliance.ps1` and self-test | 主检查及 self-test 通过 |
| `scripts/generate-sbom.ps1 -Check` and SBOM self-test | 通过；`1143` components、`1144` dependency nodes |
| `scripts/cargo.ps1 fmt -- --check` | 通过 |
| `scripts/cargo.ps1 check --locked` | 通过 |
| `scripts/cargo.ps1 clippy --locked --all-targets -- -D warnings` | 通过 |
| `scripts/tauri.ps1 build --no-bundle` with injected loopback endpoints | 通过；release SHA-256 `1B4D3F8358596C7EFD40C972341A824CEF54007EEDDF9C7F127DA58A83E6A1AF` |
| SBOM SHA-256 | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |
| `git diff --check` and checkpoint reference scan | 通过；无悬空 checkpoint 引用 |

初次直接运行未注入 endpoint 的 Console 测试按设计 fail-closed；初次 clippy 参数被 wrapper
解析为 cargo 参数。两次命令均未启动服务或设备，随后使用显式注入/分隔参数重跑通过。

## Runtime and rollback

本阶段结束复核时间为 `2026-09-04T16:09:21Z`：无 adb/emulator/qemu 进程，无目标监听；
没有创建或修改 AVD 数据，也没有安装或启动 APK。构建产物和测试缓存留在既有 Git 忽略目录。
回滚仅需按文件级提交回退并保留既有 checkpoint；不得删除历史记录或按名称清理外部目录。

第一版文档提交已推送并在线核验：2026-09-04T16:14:16Z（UTC）只读
`git ls-remote origin refs/heads/main` 返回
`afd8496fb19b3884b690fb4565abe19dce918199 refs/heads/main`，与本地第一版提交一致。
本段属于后续追加记录；追加后的最终远端 SHA 以新的在线核验为准。

## 摘要一致性补正（2026-09-05）

只读交叉核对发现最终审计顶部摘要仍将 `832948...` 写作截至本摘要日期的最近构建，
与本 checkpoint 的隔离复验证据不一致。已将摘要 current release hash 修正为
`1B4D3F8358596C7EFD40C972341A824CEF54007EEDDF9C7F127DA58A83E6A1AF`，并保留
`832948...` 与 `22F50D...` 为历史时间点证据；同步将路线图和模块索引的当前更新时间标为
`2026-09-05`。该补正只改变文档摘要标签，不改变构建产物、测试结果、APK 决策或 loopback
边界。提交后须重新执行远端 ref 在线核验并追加结果，不覆盖此前的远端证据。

## Next gate

项目仍为 `verified_with_gap`，对外仍只允许 loopback。APK 候选仍为
`rejected / signature_valid_identity_unanchored`、`install_allowed=false`。后续若要真实
兼容性观察，必须先取得官方/商店直接或独立锚定的 APK、可信 signer/ABI/对齐证据并重新通过
M14，再另立设备 checkpoint；登录、验证码、输入、选票、下单和支付始终由用户人工完成。
