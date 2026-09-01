# 最终交付审计

## 审计范围

本记录对应 2026-09-01 的源码、项目隔离工具链、mock-only 离线验收和 loopback 浏览器回归。它证明本轮列明的构建、依赖图、本地控制平面和浏览器视口检查已完成，不代表真实平台接口、购票成功率或任何规避平台规则的能力。

运行时地址、端口、配置文件和临时目录均由环境变量或运行时 fixture 注入；本文不定义部署默认地址。`/api/v1` 与 `/api/v1/events` 仅是版本化协议路径。

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

以下命令均在项目隔离工具链中执行，未安装依赖、未启动真实设备或真实平台进程；时间为
2026-09-01 中国标准时间（CST）：

| 命令 | 结果 |
| --- | --- |
| `scripts/pnpm.ps1 test`（注入 `CONSOLE_TEST_API_BASE_URL`/`CONSOLE_TEST_EVENTS_URL` loopback；API 18 suites/183 tests；Console 9 files/81 tests） | 通过（含 HostProbe/容量/exposure/deployment 契约与配置路径负向测试） |
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

## 产物哈希

以下路径均相对于仓库根目录，算法为 SHA-256；均为本轮 Tauri 重建后重新计算的结果：

| 产物 | SHA-256 |
| --- | --- |
| `apps/console/src-tauri/target/release/human-assist-console.exe` | `618215A6D377F1EA6265EC1AE9572DBC6159D25714CEF046F6F086C7CAC9478F` |
| `sbom/human-ticketing-console.cdx.json` | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |

SBOM 是开发/构建视角，覆盖 pnpm lockfile、Cargo.lock 和两个 workspace manifest；正式发布仍需按 [依赖与可复现构建文档](09-dependency-and-reproducible-build.md) 补齐运行时闭包、许可证 notice 和 build provenance。

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
