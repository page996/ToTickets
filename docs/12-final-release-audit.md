# 最终交付审计

## 审计范围

本记录对应 2026-09-01 的源码、项目隔离工具链和 mock-only 离线验收。它证明本轮列明的构建、依赖图和本地控制平面检查已完成，不代表真实平台接口、购票成功率或任何规避平台规则的能力。

运行时地址、端口、配置文件和临时目录均由环境变量或运行时 fixture 注入；本文不定义部署默认地址。`/api/v1` 与 `/api/v1/events` 仅是版本化协议路径。

## 通过项

- 本轮离线验收命令及其结果在下方“验收记录”中按实际运行时间补录；旧版本测试数字和产物哈希不再作为证据。

## 桌面回归

本轮未重新启动 API、Vite、Tauri 或浏览器自动化，也未重新生成视觉截图；因此不把历史 `.runtime/final-visual-audit/` 结果当作本轮证据。桌面/移动视口回归仍是发布前人工必做项。

本轮只执行协议/组件单元测试，没有声称任何视口、页面错误、溢出、重叠或浏览器网络探针结果。事件流协议由单元测试覆盖 envelope、序列间隙和重连边界；非法 Origin 与真实浏览器页面回归本轮未执行。

## 验收记录

以下命令均在项目隔离工具链中执行，未安装依赖、未启动真实设备或真实平台进程：

| 命令 | 结果 |
| --- | --- |
| `scripts/pnpm.ps1 test`（API 14 suites/150 tests；Console 9 files/81 tests） | 通过 |
| `scripts/pnpm.ps1 typecheck`（API、Console） | 通过 |
| `scripts/pnpm.ps1 build`（Nest/Vite） | 通过 |
| `scripts/pnpm.ps1 test:load:mock` | 通过 |
| `scripts/check-compliance.ps1` | 通过：105 runtime/command files，3 Node manifests，1 Rust manifest，1 config template |
| `scripts/check-compliance.test.ps1` | 通过 |
| `pwsh -NoProfile -File scripts/tests/generate-sbom.Tests.ps1` | 通过：1143 components，1144 dependency nodes |
| `scripts/generate-sbom.ps1 -Check` | 通过 |
| `scripts/cargo.ps1 fmt --manifest-path apps/console/src-tauri/Cargo.toml -- --check` | 通过 |
| `scripts/cargo.ps1 check --manifest-path apps/console/src-tauri/Cargo.toml --locked` | 通过 |
| `scripts/cargo.ps1 clippy --manifest-path apps/console/src-tauri/Cargo.toml --locked --all-targets '--' '-D' 'warnings'` | 通过 |
| `scripts/tauri.ps1 build --no-bundle`（loopback 配置） | 通过；生成 Windows release executable |

Windows PowerShell 5.1 不支持 SBOM 脚本使用的 `.NET Path.GetRelativePath`；按项目要求用 PowerShell 7 (`pwsh`) 重跑后通过。该环境差异不影响生成物。

## 产物哈希

以下路径均相对于仓库根目录，算法为 SHA-256；哈希须在本轮最终构建完成后重新计算，旧哈希已失效：

| 产物 | SHA-256 |
| --- | --- |
| `apps/console/src-tauri/target/release/human-assist-console.exe` | `D2A487F7191C722DDB67222683DDDA5A8CFBEB364C3EBE398FE9E060AE37A62E` |
| `sbom/human-ticketing-console.cdx.json` | `40E5C54F09A03B0146FB0D091E3FE3905C811FFB611D77251BB32F204A1AD56B` |

SBOM 是开发/构建视角，覆盖 pnpm lockfile、Cargo.lock 和两个 workspace manifest；正式发布仍需按 [依赖与可复现构建文档](09-dependency-and-reproducible-build.md) 补齐运行时闭包、许可证 notice 和 build provenance。

## 运行态清理

最终负载使用动态分配的临时 API 进程和 mock fixture。交付前必须只按记录的临时 PID 精确停止该进程，并确认旧服务是否由操作者保留；不得使用按名称批量终止 Node、Rust 或 Tauri 进程的命令。控制台回归应从最新源码启动，并在桌面与 390px 视口检查无控制台/网络错误、无水平溢出或控件重叠，且验证 WebSocket 重连。

## 明确未覆盖

- 不连接或操作真实大麦 App、账号、登录、验证码、实名、订单、支付或设备输入。
- 不提供高频点击、跨账号同步输入、票档选择、风控规避或任何自动购票接口。
- 当前构建证明 dependency-reproducible，不声称 Windows 工具链、WebView2、时间戳和调试路径已达到 bit-for-bit 可复现。
