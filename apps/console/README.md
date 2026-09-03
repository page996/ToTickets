# Console workspace

`apps/console` 是 Tauri + React/TypeScript 控制台。它只连接配置指定的本地 NestJS 控制平面，不包含真实平台适配、设备输入、页面识别或购买动作。

## 运行配置

生产桌面壳通过 Tauri 命令读取以下环境变量；Vite 开发服务器通过同名变量在运行时提供 JSON，不把完整端点编译进前端资源：

| 变量 | 约束 |
| --- | --- |
| `CONSOLE_API_BASE_URL` | HTTP(S) 绝对 loopback URL（IPv4 127/8 或 IPv6 loopback），路径必须为协议常量 `/api/v1` |
| `CONSOLE_EVENTS_URL` | WS(S) 绝对 loopback URL（IPv4 127/8 或 IPv6 loopback），路径必须为协议常量 `/api/v1/events`，host 和 port 必须与 API 相同 |
| `CONSOLE_OPERATOR_ID` | 本地操作者标识，最多 128 字符，仅允许字母、数字、点、下划线、冒号和连字符 |
| `CONSOLE_REFRESH_INTERVAL_MS` | `500..60000` 的整数 |
| `CONSOLE_STALE_AFTER_MS` | `1000..600000` 的整数，且不短于刷新间隔 |
| `CONSOLE_DEV_HOST` | 仅 Vite 开发服务器使用的 loopback 绑定主机（IPv4 127/8 或 IPv6 loopback） |
| `CONSOLE_DEV_PORT` | 仅 Vite 开发服务器使用的端口，范围 `1024..65535` |
| `CONSOLE_TEST_API_BASE_URL` | 测试注入的 loopback API URL；不提供源码默认值 |
| `CONSOLE_TEST_EVENTS_URL` | 测试注入的 loopback事件 URL；不提供源码默认值 |

缺失、未知或越界配置会 fail closed。控制台不会猜测主机、端口、文件路径或操作者。

## 提醒交付状态

当前 `reminder.fired` 事件只会触发控制台内的状态和倒计时刷新。操作系统桌面通知与声音播放尚未启用，不能把日程中的 `desktop` / `sound` 渠道视为已经完成的系统级送达。

启用前需要用户确认通知权限策略、后台/锁屏行为、声音资源与静音规则，并完成新增 Tauri 能力和依赖的许可证及权限面评估。该决策完成前不增加未经审核的通知插件，也不使用浏览器能力模拟可靠送达。

## Tauri CSP overlay

`src-tauri/tauri.conf.json` 只保存主机无关的最小 CSP，其中 `connect-src` 仅允许 `'self'`、`ipc:` 和 Tauri 固定内部 IPC origin `http://ipc.localhost`。后者不是部署地址，也不由运行时 endpoint 配置；它只让 WebView2 的 Tauri bridge 请求通过 CSP。包脚本 `pnpm ... tauri build` 或 `pnpm ... tauri dev` 会在启动 Tauri 前执行以下步骤：

1. 严格校验 `CONSOLE_API_BASE_URL` 和 `CONSOLE_EVENTS_URL` 的 loopback 主机、协议、版本化路径及共同的 host/port。
2. 只提取两个 URL 的 origin，并合并到基线 CSP 的 `connect-src`。
3. 将 overlay 写入仓库忽略的 `.runtime/tauri.generated.conf.json`，再使用 Tauri `--config` 参数合并。

生成器拒绝调用者额外传入 `--config`，避免覆盖受审计的 CSP。Tauri 的 CSP 在编译时固化，因此发布构建运行时使用的两个端点 origin 必须与构建时一致；端点 origin 变更后必须重新构建。overlay 不包含操作者标识、凭据或其他敏感运行配置。

主窗口 capability 不授予任何 Tauri core 或 plugin 命令；`build.rs` 只为 Rust `invoke_handler` 显式注册的 `get_console_runtime_config` 生成应用 permission，主窗口仅获授这一项。

## 验证命令

在仓库声明的 Node/pnpm 和 Rust 工具链环境中运行：

```text
pnpm --filter @ticketing-console/console test
pnpm --filter @ticketing-console/console build
& ../../scripts/tauri.ps1 build --no-bundle
```

Tauri 当前关闭安装包 bundling，直至签名、图标和发布清单在发布阶段单独审核；`--no-bundle` 仍可验证桌面二进制构建。
项目 wrapper 会动态设置仓库内 `RUSTUP_HOME`、`CARGO_HOME` 和 Cargo PATH，再调用项目 pnpm。内部 Node wrapper 显式执行 `@tauri-apps/cli/tauri.js`，构建验收还必须检查 release 可执行文件确实生成，不能只看命令退出码。
