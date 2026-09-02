# 最终交付审计

## 审计范围

本记录对应 2026-09-01 的源码、项目隔离工具链、mock-only 离线验收和 loopback 浏览器回归。它证明本轮列明的构建、依赖图、本地控制平面和浏览器视口检查已完成，不代表真实平台接口、购票成功率或任何规避平台规则的能力。

运行时地址、端口、配置文件和临时目录均由环境变量或运行时 fixture 注入；本文不定义部署默认地址。`/api/v1` 与 `/api/v1/events` 仅是版本化协议路径。

## 当前状态摘要（截至 2026-09-03）

本文开头的审计表是 2026-09-01 的历史基线；后续日期章节是不可覆盖的追加事实，不能
把不同时间点的测试数字或产物哈希混作同一轮结果。当前可复核状态为：项目隔离工具链
复验 API 19 suites/203 tests、Console 9 files/81 tests 通过；最近一次隔离重建的 release
executable 哈希为 `5E074D...`（R1 先前构建为 `B80C0BC...`），SBOM 哈希为
`40E5C54F...`；Gate C 当前
profile 已取得双实例约 15 分钟量级观察证据，但第三实例启动峰值触发保护，仍为
`verified_with_gap`，对外暴露继续限制为 loopback。

## 通过项

- 本轮离线验收命令及其结果已按实际运行时间记录；旧版本测试数字和产物哈希不再作为证据。
- 已建立首次 Git 基线提交：`6fa3bbd`；恢复接管后的基线、配置修复和主机规划提交均位于
  `main` 提交链。
- 本轮部署状态控制与契约测试作为收尾提交推送到
  `https://github.com/page996/ToTickets`，未使用 force push；最终远程 SHA 在交付回执中
  再次核验。

## 桌面回归

本轮完成 Nest/Vite 构建后（API `dist` 文件时间约为 21:30 CST），于 21:35 CST 启动临时
loopback API 和 Vite，并使用本机 Chromium 对桌面 1440px 与移动 390px 视口进行回归。完整
证据保存在 `.runtime/r2-final-1788269740740-68b41ffb/`；其中 `r2-evidence.json` 保存
运行时分配的 fixture 地址（API `58969`、Vite `58970`）和结果，页面、设备列表、提醒、审计
视图均加载成功，稳态无 page error，REST 快照和合法 WebSocket 同步帧均成功。

- 桌面四个视图：`scrollWidth=1440`（视口宽度 1440），可见控件数依次为 `11/10/9/11`，均无几何重叠。
- 移动四个视图：`scrollWidth=390`（视口宽度 390），可见控件数依次为 `11/10/9/11`，均无横向溢出或几何重叠。
- 故障注入：停止 API 后控制台进入“连接异常/快照过期”，重启后约 5 秒恢复“控制平面在线”并重新同步空内存快照。
- Origin：合法 Origin 收到 `event-stream.sync.v1`；浏览器非法 Origin 的 REST 请求被 CORS
  拦截，WS 以 close code `1008` 和 `origin is not allowed` 拒绝。

React StrictMode 首次 effect 清理会产生一次“WebSocket connection ... closed before the
connection is established”开发模式警告；API 停机注入期间的 `ERR_CONNECTION_REFUSED`
也被记录为预期故障证据。两者均未出现在服务恢复后的稳态页面错误中。截图和日志保存在
本地忽略目录 `.runtime/r2-final-1788269740740-68b41ffb/`，不作为版本化发布产物。Tauri 原生窗口本轮只完成
`--no-bundle` 构建，尚未替代浏览器回归作为人工窗口验收。

## 验收记录

以下表格中的命令均在项目隔离工具链中执行，未安装依赖、未启动真实设备或真实平台
进程；时间为 2026-09-01 中国标准时间（CST），仅代表该历史离线阶段：

| 命令 | 结果 |
| --- | --- |
| `scripts/pnpm.ps1 test`（注入 `CONSOLE_TEST_API_BASE_URL`/`CONSOLE_TEST_EVENTS_URL` loopback；API 18 suites/183 tests；Console 9 files/81 tests；2026-09-01 历史快照，已由后续 R1 复验取代） | 通过（含 HostProbe/容量/exposure/deployment 契约与配置路径负向测试） |
| `scripts/pnpm.ps1 typecheck`（API、Console） | 通过 |
| `scripts/pnpm.ps1 build`（Nest/Vite） | 通过 |
| `scripts/pnpm.ps1 test:load:mock` | 通过 |
| `scripts/check-compliance.ps1` | 通过：120 runtime/command files，3 Node manifests，1 Rust manifest，1 config template |
| `scripts/check-compliance.test.ps1` | 通过 |
| `scripts/tests/check-compliance.Tests.ps1` | 通过 |
| `pwsh -NoProfile -File scripts/tests/generate-sbom.Tests.ps1` | 通过：1143 components，1144 dependency nodes |
| `scripts/generate-sbom.ps1 -Check` | 通过 |
| `scripts/cargo.ps1 fmt --manifest-path apps/console/src-tauri/Cargo.toml -- --check` | 通过 |
| `scripts/cargo.ps1 check --manifest-path apps/console/src-tauri/Cargo.toml --locked` | 通过 |
| `scripts/cargo.ps1 clippy --manifest-path apps/console/src-tauri/Cargo.toml --locked --all-targets '--' '-D' 'warnings'` | 通过 |
| `scripts/tauri.ps1 build --no-bundle`（loopback 配置） | 通过；生成 Windows release executable |
| loopback mock API + Vite + Chromium 桌面/390px 回归（端口由运行时分配；证据目录见上） | 通过；页面/REST/WS/视口/控件布局检查完成，脚本退出码 0 |
| 浏览器非法 Origin REST/WS 验证 | 通过；CORS 拦截，WS close `1008` |
| API 停止/重启后的控制台重连演练 | 通过；恢复后显示“控制平面在线”并重新同步 |

恢复接管后新增的 API 只读端点 `GET /api/v1/hosts/probe` 与
`GET /api/v1/hosts/providers`，以及 mock-only 部署 REST 路由，已由运行时测试和 OpenAPI
契约测试覆盖。部署 domain 的真实 planner 拒绝会发布带 `deployment_id: null` 的
`deployment.operation.rejected`；REST DTO 在进入 domain 前拒绝非 mock provider 时只返回
通用 `schema.invalid`，不伪造 deployment event。配置层现在只接受
显式选择的 `storage.data_dir`、`tools.adb`、`tools.emulator` 和 `tools.scrcpy`，未提供时
返回 `unknown`/`not_checked`，不会从工作目录、PATH、注册表或 `ANDROID_SDK_ROOT` 猜测。
R2 浏览器证据在上述构建完成后生成，并与当前 API dist 的时间顺序一致；它验证 mock 控制
平面，不等于 Tauri 原生窗口人工验收。

Windows PowerShell 5.1 不支持 SBOM 脚本使用的 `.NET Path.GetRelativePath`；按项目要求用 PowerShell 7 (`pwsh`) 重跑后通过。该环境差异不影响生成物。

## 产物哈希（2026-09-01 历史快照；非当前构建）

以下路径均相对于仓库根目录，算法为 SHA-256；均为本轮 Tauri 重建后重新计算的结果：

| 产物 | SHA-256 |
| --- | --- |
| `apps/console/src-tauri/target/release/human-assist-console.exe` | `618215A6D377F1EA6265EC1AE9572DBC6159D25714CEF046F6F086C7CAC9478F` |
| `sbom/human-ticketing-console.cdx.json` | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |

SBOM 是开发/构建视角，覆盖 pnpm lockfile、Cargo.lock 和两个 workspace manifest；正式发布仍需按 [依赖与可复现构建文档](09-dependency-and-reproducible-build.md) 补齐运行时闭包、许可证 notice 和 build provenance。

## 当前构建哈希（R1 复验时点，2026-09-02）

以下是 R1 工作树实际复验的 canonical 记录；重新构建后必须重新计算，不能与上面的
2026-09-01 历史快照混用。

| 产物 | SHA-256 |
| --- | --- |
| `apps/console/src-tauri/target/release/human-assist-console.exe` | `B80C0BC65048E5B4E7CF3BF67D2A80D99C31BE48D15F30A1D59AE53FE1CB7EAD` |
| `sbom/human-ticketing-console.cdx.json` | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |

## 最新隔离门禁复验（2026-09-03）

恢复接管后的文档修正完成后，使用项目 `.tools` Node/pnpm/Rust wrapper 再次运行全量测试、
类型检查、Nest/Vite 构建、mock load self-test、合规与 SBOM 检查、Rust fmt/check/clippy
及 Tauri `build --no-bundle`。API `19 suites/203 tests`、Console `9 files/81 tests` 和
其余门禁均通过；没有启动 API/Vite/Tauri 窗口、ADB 或模拟器。该次 Tauri 重建产生的当前
exe 哈希如下；构建时间差异导致它与 R1 的 `B80C...` 不同，不宣称 bit-for-bit 可复现。

| 产物 | SHA-256 |
| --- | --- |
| `apps/console/src-tauri/target/release/human-assist-console.exe` | `5E074D800FE968A62C656D7143BD1FCD607FED8B454ADCE65524544682D1A485` |
| `sbom/human-ticketing-console.cdx.json` | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |

## 运行态清理

本轮 R2 动态 API、重启 API、Vite 进程树和浏览器均已按目标精确关闭；证据 fixture 的端口
已无监听（仅可能存在 TCP `TIME_WAIT`）。未使用按名称批量终止 Node、Rust 或 Tauri 进程的
命令。临时截图/日志留在 `.runtime/r2-final-1788269740740-68b41ffb/`，运行态
数据未进入 Git。

## 远程扩展前置条件

当前 v3 只允许 loopback，且身份仍是可信本机假设：`X-Operator-Id`/请求体
`operator_id` 可被本机调用者伪造，尚无真正认证、RBAC、TLS、CSRF、WS 握手认证或资源范围
隔离。不得仅放宽 `bind_host` 来启用局域网/远程访问。下一版本应先定义独立的 exposure/
security profile，引入服务端 `Principal/AuthContext`、设备授权、REST/WS 认证和 TLS，再
升级 OpenAPI/错误契约并完成负向测试。

## 模拟器选型结论

本轮选择官方 Android Studio Emulator/AVD 作为 Gate C 和 mock 设备的首选基线，理由是
官方 SDK/ADB、系统镜像和快照更容易版本化与复现；先验证单实例，再按宿主机资源扩大。
Genymotion Desktop 保留为第二候选，必须先完成 EULA、许可证、版本矩阵和数据流审查；
Genymotion Cloud 不作为默认方案。BlueStacks、雷电等闭源消费级模拟器不进入核心依赖。
用户提供的安装截图和本轮只读文件检查确认 Android Studio Standard、SDK、Platform-Tools
与 Emulator 已安装；`adb` 37.0.1、Emulator 37.1.11.0。当前没有已创建 AVD 或 scrcpy，
Android Emulator hypervisor driver 也未安装；因此没有启动模拟器、安装 APK 或连接真实
第三方应用。截图只证明安装设置/组件下载，不证明并发、兼容性或检测结果。

## 恢复接管后的宿主机与参考仓库审计

宿主机检查只作为本机快照：32 逻辑线程、约 32 GiB RAM、检查时可用内存约 14--15 GiB，
系统盘/数据盘余量约 79/262 GiB；固件虚拟化、SLAT、DEP 可用，但 emulator-check 报告
hypervisor driver 未安装。API 的 `host-probe.v1` 不回显路径、主机名或环境变量，并把
GPU/虚拟化未覆盖项标为 `unknown`；容量 profile 必须在目标宿主机 ramp test 后替换。
本轮未运行 `adb devices`，也未启动 ADB server；没有启动模拟器或安装包。工具状态仅由
显式选择的工具路径检查和静态版本信息获得。

对 `WECENG/ticket-purchase` 的结论是隔离 clone 的静态审计：其源码明确自动选择/提交
购票流程并含批量点击和 Cookie pickle，许可证未声明，环境脚本只检查工具/包名，不能
证明 APK 或环境检测兼容性。未运行代码、未安装依赖/APK、未访问真实平台；该仓库不作为
本项目依赖或实现来源。详细风险类别和公开证据见 `docs/01-research-report.md`。

## 明确未覆盖

- 不连接或操作真实大麦 App、账号、登录、验证码、实名、订单、支付或设备输入。
- 不提供高频点击、跨账号同步输入、票档选择、风控规避或任何自动购票接口。
- 当前构建证明 dependency-reproducible，不声称 Windows 工具链、WebView2、时间戳和调试路径已达到 bit-for-bit 可复现。
- 当前尚未完成 Tauri 原生窗口人工验收、SQLite 持久化、真实只读 Android adapter 和发布签名/安装包。
- 当前尚未完成真实 provider 的部署状态控制、目标宿主机专用 GPU/虚拟化/网络检查和
  Gate C；HostProbe 只提供 planning/readiness，不会自行启动外部实例。

## 后续宿主机事实（2026-09-02）

本文件前述模拟器段落是 2026-09-01 的发布审计快照，保留其原始结论；后续只读检查已
发现用户创建的 AVD `ticket_test_1`（Android 37 Google APIs、`x86_64`、4 vCPU、2 GiB
RAM、10 GiB data、E 盘数据目录）。这不改变本审计的发布状态：AVD 尚未启动，hypervisor
driver 未安装，GPU/虚拟化/并发和真实 APK 兼容性仍未验收。完整当前证据见
`docs/checkpoints/CP-20260902-host-preflight.md`；`system-helper-manifest.v1` 当前
为默认空 allowlist，不能因工具已安装而自动启动 helper。

## R1 策略与构建复验补充（2026-09-02）

本节只补充当前工作树的 helper 策略和离线构建证据；前文浏览器/视觉回归和 2026-09-01
测试数字仍按其历史时间点解释，本节没有重新生成浏览器截图或声称 Tauri 原生窗口人工验收。

- helper manifest 定向测试 20/20；workspace 测试 API 19 suites/203 tests、Console 9
  files/81 tests；typecheck、Nest/Vite build、mock load self-test、静态合规、SBOM 和
  Rust fmt/check/clippy 均通过。
- `scripts/tauri.ps1 build --no-bundle` 在注入 loopback 配置后通过；当前 release
  executable SHA-256 为
  `B80C0BC65048E5B4E7CF3BF67D2A80D99C31BE48D15F30A1D59AE53FE1CB7EAD`。这是本次构建的
  时间点哈希，不覆盖前文历史哈希，也不构成 bit-for-bit 可复现承诺。
- 第一次 Tauri 调用因未注入 `CONSOLE_API_BASE_URL`/`CONSOLE_EVENTS_URL` 按设计拒绝，
  补齐后重跑成功；全程未启动 AVD、ADB、API、Vite、Tauri 窗口或真实平台进程。

## Gate C 多实例观察补充（2026-09-03，本地日期）

本节是 R1 之后的独立 R2 运行记录，不改写前文 2026-09-01/09-02 的历史快照。详情见
`docs/checkpoints/CP-20260902-gate-c-ramp-2-4.md`，脱敏聚合报告位于被忽略的
`.runtime/r2-avd-ramp-20260902-1634/ramp-summary.json`（SHA-256
`389E37D0D1EE89CFAA349DDD675E6265252F52E5337B9B597F829162E6E13495`）。

- 用户原有 `ticket_test_1` 保持在线；本轮新增独立 writable clones `ticket_test_2`/
  `entity2` 和 `ticket_test_3`/`entity3`，均为 Android 37 Google APIs `x86_64`。
- 两个新增实例分别在 console 5556/5558 boot 完成，启动日志约 52.0/51.4 秒；三台
  并行时 qemu 工作集合计约 13.93 GiB、私有内存约 13.41 GiB，宿主可用内存降至
  4.39--4.49 GiB，commit 约 96.5%，因此第 4 台未启动。
- 新增实例已按精确 serial `emu kill` graceful stop，复核仅原 `emulator-5554` 和用户
  ADB daemon 保留；未启动项目 API/Vite/Tauri、未安装 APK、未访问真实购票平台。
- 静态 `config.ini` 的 2 GiB/GPU off 与运行时 `hardware-qemu.ini` 的 4096 MiB/GPU
  host 不一致；clone 目录各约 5.28 GiB logical（其中约 4 GiB 为 snapshot ram image）。
  这不能替代 writable 数据 I/O、15 分钟 soak、GPU/温度和第 4 台测试。
- Windows Application log 出现 qemu `RADAR_PRE_LEAK_64` 事件，未观察到明确崩溃；它是
  后续稳定性复核的风险证据，不能归因于 Hydra 或本轮某一实例。

这次是用户批准的 operator-run 压力观察，不是项目 helper activation；
`system-helper-manifest.v1` 仍为默认空 allowlist，当前部署和 API `safe_instances` 均未
因本轮结果改变。当前最终发布状态仍为 `verified_with_gap`。

## Gate C multi-instance follow-up (2026-09-03)

后续受控证据见 [`CP-20260903-gate-c-multi-followup.md`](checkpoints/CP-20260903-gate-c-multi-followup.md)。
用户/外部 operator 已持有 `ticket_test_2`，因此本轮没有重启或停止它；在保留
`ticket_test_1`/`ticket_test_2` 的情况下完成了 5 分钟双实例窗口和约 10 分钟恢复窗口。
两个 ADB serial 全程 `device`、boot=1；双实例 qemu 工作集合约 7.00--8.35 GiB、Private
约 7.48 GiB，commit 分别在 81.3--87.1% 的观察范围内。

本轮只对独立 `ticket_test_3`（5558）做一次带保护的启动探测。它在约 19 秒内将宿主
commit 推到 95.979%，尚未完成 Android boot，随后按 `adb -s emulator-5558 emu kill`
精确退出；原两台仍在线。`ticket_test_4` 只有 `config.ini`，未作为实例尝试。该结果
把当前 profile 本轮可验证的短时观察上限限定为“2 台”；第 3 台启动分配即触发保护，
因此不能把 2 台写成安全容量或部署承诺，也不改变 `safe_instances`、`max_devices` 或
provider 默认值。

本轮还确认低资源 override 没有生效（仍 4096 MiB；GPU 只观察到软件 fallback/host
backend 的混合证据），以及 WER `RADAR_PRE_LEAK_64` 事件早于 clone ramp、无 APPCRASH，
不能归因 Hydra。项目最终状态仍为 `verified_with_gap`；下一步需低资源 profile 或更大
宿主提交容量、15 分钟以上 soak、按进程 GPU/I/O 证据和用户决定的实例目录清理。

### 双实例延长基线补充（2026-09-03）

后续在保留两台用户实例的条件下完成了约 15 分钟量级的双实例只读资源窗口；聚合证据
见 `CP-20260903-gate-c-baseline-15m.md` 和
`.runtime/r2-avd-multi-20260903/two-baseline-15m-aggregate-20260903.json`。实际采样
914.2 秒、墙钟跨度 1019.0 秒（含 104.9 秒分段间隔），两台全程 ADB `device`/boot=1；
宿主 commit `81.446--83.260%`，qemu Private 合计 `7.478--7.480 GiB`。该结果只
增强当前 profile 的双实例观察证据，不改变“尚未形成 safe capacity”的结论。

## 2026-09-03 文档一致性更正

本节是对前述历史段落的解释索引，不覆盖或删除原始时间点记录：

- 第 24--26 行的“远程 SHA”表述应以本地 `origin/main` 跟踪引用
  `7e1074111d28437f41506289db3d430c3bee1829` 为当前可复核依据；本轮没有执行新的在线
  远程查询，因此不把它描述成新的远程在线核验。
- 第 169--174 行的“AVD 尚未启动/driver 未安装”属于 2026-09-02 预检快照；后续运行时
  WHPX 与双实例事实见第 9 节及对应 checkpoint。综合发布状态仍为 `verified_with_gap`。
- 第 232--233 行的“15 分钟以上 soak”是当时的下一门槛；双实例约 15 分钟量级窗口已在
  后续章节记录，当前下一门槛改为低资源 profile 或更大宿主机、固定时长 soak、按进程
  GPU/I/O 归因和用户决定的目录清理。

## 2026-09-03 在线引用复核补充

本节只追加当前可复核的远程引用证据，不改写前述历史时间点。2026-09-02T19:36:45Z
（UTC）执行只读命令 `git ls-remote origin refs/heads/main`，返回：

`64b7b1700d5fc8d8d685f9291792f20160a69a12 refs/heads/main`

因此第 24--26 行所述“最终远程 SHA”现在可由该命令直接复核；它不是对发布完成、
工作树以外产物或真实平台能力的证明。第 95--103 行的 `B80C...`、第 169--174 行的
加速/AVD 预检和第 184--189 行的 R1 构建哈希均保留为各自时间点的历史快照；当前
canonical 构建哈希仍以“最新隔离门禁复验”一节为准。
