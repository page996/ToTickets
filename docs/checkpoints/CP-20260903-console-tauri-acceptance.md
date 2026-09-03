# Checkpoint: Console browser and Tauri native acceptance

checkpoint_id: `CP-20260903-console-tauri-acceptance`
created_at_utc: `2026-09-03T13:18:00Z`
status: `verified_with_gap`
base_git_commit: `4cd0732caea571f5b4566a6d7cfcb51409f1827e`

## Scope and non-goals

本阶段收束受控 loopback mock API、Vite 浏览器回归和 Tauri 原生窗口验收。范围包括记录临时
进程/端口、复核浏览器证据、修正 Tauri WebView2 IPC CSP 基线并用同一运行端点重建原生 shell。
不改变 API/WS 协议、设备适配器、运行时默认容量、helper 白名单或 loopback 安全边界；不启动
或停止用户 AVD（保留 `ticket_test_1`），不连接真实大麦或真实 APK。

## Affected modules and module books

- `CON-C3-tauri-bridge`：拥有 Tauri CSP overlay、运行时配置 IPC bridge 和原生窗口启动证据；
  不拥有 API 数据或设备生命周期。
- `CON-C3-runtime-config`：继续校验显式注入 endpoint；不提供源码默认地址。
- `M10-config-supply-chain`：记录项目隔离构建、产物 hash 和可回滚配置变更。

## Files, dependencies, processes and devices

- 预期版本化变更：`apps/console/src-tauri/tauri.conf.json`、Tauri overlay 生成器/测试、合规
  规则测试、本文及审计/路线图索引；不新增依赖或修改 lockfile。
- 临时测试进程：loopback API/Vite、Tauri shell、WebView2/CDP；端口和 PID 只写入本 checkpoint
  或被忽略的 `.runtime` 证据，不进入运行时代码默认值。
- 设备：仅保留用户的 `ticket_test_1`/`emulator-5554` 及 ADB；entity2--5 不由本阶段启动。

## Acceptance contract

1. 浏览器版四视图、移动 390px 布局、合法/非法 Origin 和 API 重启恢复必须引用既有
   `browser-evidence.json`，不把 host-assisted 证据写成真实平台能力。
2. Tauri release shell 必须以与构建 overlay 相同的显式 loopback API/WS origin 启动；原生
   WebView 页面应显示合成设备/提醒/审计，且无 CSP/运行时异常。
3. `http://ipc.localhost` 仅作为 Tauri 内部 IPC origin；不得由 endpoint 配置、API CORS
   allowlist 或未来远程 exposure 复用。
4. 关闭顺序为先优雅关闭 Tauri，再按记录的父子树精确停止 API/Vite/CDP；确认监听只剩
   用户 ADB/AVD。

## Initial evidence and deviation

- 浏览器证据：`.runtime/r2-console-tauri-acceptance-20260903-202100/browser-evidence.json`，
  9 个步骤通过，桌面/移动布局无重叠或横向溢出，浏览器异常为空。
- 首次原生尝试使用旧 release 二进制（CSP 仍为旧端口 `18080`），因此页面为空；该结果
  不作为应用故障证据。
- 重建前端点一致性诊断确认 API/WS 可达，但 WebView2 日志显示 `http://ipc.localhost`
  被仅含 `ipc:` 的 CSP 拦截；这是本 checkpoint 的待修复缺口。

## Superseded provisional append: 2026-09-03T13:31:00Z

本段是当时的临时判断，后续复核发现其运行记录实际来自 `tauri dev`/debug binary，不能作为
release 验收结论。保留该段用于解释偏差；canonical release 证据以下方 13:38:34Z 追加为准。

`http://ipc.localhost` 已作为唯一新增的 Tauri 内部 CSP source，并由 overlay 单元测试与静态
合规检查锁定；未加入 wildcard、外部 host 或 API allowlist。使用同一 `59694` API origin 重建
release shell 后，原生 WebView 页面显示 1 个合成设备、1 个合成提醒和 2 条审计记录；REST
资源请求与事件流请求均出现，CSP/运行时错误为 0。首次旧二进制的 `18080` CSP 偏差被保留为
历史失败证据，不能与本次通过结果混淆。

本阶段受控进程已清理：Tauri 主窗口、其 WebView2 子树和 API/Vite/CDP 均精确退出；只读复核
确认监听仅剩用户 ADB `5037` 与保留的 `ticket_test_1` `5554/5555`。entity1 活动锁和进程
未被触碰；entity2--5 未启动。

验证命令：Console `9 files/81 tests`、静态 compliance 检查、Tauri release rebuild；完整
workspace 门禁和当前产物 hash 见 `docs/12-final-release-audit.md` 的本次追加章节。

## Risks, rollback and next gate

- 风险：CSP 基线过宽会扩大 WebView 网络面；修复必须只增加 Tauri 固定 IPC origin，并由
  合规/overlay 测试锁定，不能加入任意 host 或 wildcard。
- 回滚：保留本文及运行证据，将 Tauri base CSP、overlay 测试和合规规则恢复到
  `base_git_commit` 对应版本，再重新构建；不删除历史 checkpoint 或运行产物。
- 阶段创建时的计划门槛：修复后重建并完成原生页面/IPC/WS 证据，更新 `docs/12-final-release-audit.md`
  和 `docs/07-implementation-roadmap.md`；随后运行全量隔离门禁、计算 hash、提交并推送。

## Result append: 2026-09-03T13:38:34Z

### Release binary runtime evidence

在完成 release 重建后，使用动态 loopback API `http://127.0.0.1:59701/api/v1`、事件流
`ws://127.0.0.1:59701/api/v1/events` 启动
`apps/console/src-tauri/target/release/human-assist-console.exe`；WebView2 CDP 绑定
`127.0.0.1:50131`。本次 release SHA-256 为
`22F50D6BAC64C029E904B5BA56157CC83CBFA457443EB11C17C379B9051F2358`。

生成 CSP 的 `connect-src` 仅含 `'self'`、`ipc:`、固定内部
`http://ipc.localhost` 及本次注入的 `http://127.0.0.1:59701`、
`ws://127.0.0.1:59701`，未加入 wildcard、外部 host 或 API CORS allowlist。证据目录为
`.runtime/r2-console-tauri-release-20260903/`，其中 `browser-evidence.json` 及截图
记录：overview `release-viewport.png` 158667 bytes/2880x1840，设备
`release-设备.png` 97549 bytes，提醒 `release-提醒.png` 92681 bytes，审计
`release-审计.png` 119464 bytes。页面显示 1 个合成设备、1 条提醒和 2 条审计；网络
观察为 5 个 REST URL、WebSocket sync 帧加 2 个事件帧，console/page errors 均为 0。

`runtime-before-stop.json` 保留 release 主进程、WebView2 子进程、API PID、listener、
release hash 和 generated CSP；随后 `runtime-after-stop.json` 记录
`closeMainWindow=true`、release/API 目标进程与 listener 均为空。收尾后只读复核确认
仅剩用户 `ticket_test_1`/ADB loopback。该结果是程序化 release runtime/IPC/WS smoke，
不是用户人工签收；真实 APK、真实只读 provider 和人工 Tauri 验收仍未闭合。此前 dev/旧
release 运行证据保留为历史时点，不与本次 release 结果混用。

### Next gate

release smoke 完成后，容量评估门槛为 `entity3 + entity5` 的低资源双实例固定窗口，再按
保护规则执行 `1 -> 2 -> 4` ramp，并补齐 GPU/I/O、温度、磁盘写入及目标宿主机 preflight。
在该门槛前不启动 `entity4`，不激活 helper/provider，不改变 loopback exposure 或部署
默认值。用户人工 Tauri 签收仍是进入 SQLite 前的独立产品流程门槛；两者并列且不能
互相替代。

## Result append: 2026-09-03 full isolated gate

release 运行证据清理完成后，使用仓库内 `.tools` wrapper 和动态注入的 loopback 测试地址
执行完整门禁，结果如下：

- workspace test：API `19 suites/203 tests`、Console `9 files/81 tests`；
- workspace `typecheck`、Nest/Vite `build`、mock load self-test：通过；
- 静态 compliance、两组 compliance self-test、SBOM self-test、`generate-sbom.ps1 -Check`：
  通过；SBOM self-test 为 `1143` components/`1144` dependency nodes；
- Rust `fmt --check`、`cargo check --locked`、`clippy --locked --all-targets -D warnings`：通过；
- 注入 `http://127.0.0.1:59811/api/v1` 与对应 WS endpoint 后，Tauri
  `build --no-bundle`：通过。本地址只属于构建 fixture，没有启动服务。

最终门禁重建后的 release executable SHA-256 为
`83294804715AB2259439AF4F00DE3416F195D549268BEB679EE1E06F5FF1B7D2`，SBOM SHA-256 为
`40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B`。该 exe hash 与前述
实际运行验收时点的 `22F50D...` 不同，是构建时 CSP fixture origin 不同导致的时间点产物；
两者均不构成 bit-for-bit 可复现承诺，且不能互相替代。完整门禁未启动 API、Vite、Tauri
窗口、ADB、AVD、APK 或外部 helper。

## Result append: exact CSP compliance policy

提交前独立审查发现，最初的 `http://ipc.localhost` 合规例外会跳过包含该字面量的整行，
不能独立拒绝同行的 wildcard、scheme-only 或裸 host CSP source。修复后，合规脚本会解析
`tauri.conf.json` 并将完整 base CSP 与唯一批准的 host-neutral policy 精确比较；通用地址扫描
只在扫描副本中遮蔽固定 IPC 字面量，同行其余内容继续检查。overlay 常量例外同时锚定到完整
单行，避免尾随内容借用白名单。

负向 fixture 已覆盖额外完整 URL、`*`、`https:`、裸 host、尾随 directive 和 overlay 常量
同行尾随内容；精确 base CSP 与精确常量仍通过。修复后重新执行两组合规自测、主合规扫描、
Console `9 files/81 tests` 和 `git diff --check` 均通过。该强化不改变 Tauri 运行配置、网络
exposure、依赖或产物；回滚时应连同 CSP 例外、负向 fixture 与本追加记录一起对比恢复，
不得只删除测试而保留宽例外。

补充复跑中有两项已闭合的命令偏差：第一次直接调用 Console 定向测试时未注入
`CONSOLE_TEST_API_BASE_URL`/`CONSOLE_TEST_EVENTS_URL`，测试按设计 fail-closed；随后使用运行时
分配且无监听的 loopback fixture 注入后，9 files/81 tests 全部通过。第一次强化错误文案时
又在非白名单行重复了固定 IPC URL，主合规扫描将其作为硬编码地址拒绝；改为不包含 URL 的
描述后主扫描通过。两次失败均未启动服务、设备或外部 helper，也未作为通过证据使用。
