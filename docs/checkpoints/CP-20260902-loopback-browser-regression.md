# Checkpoint: loopback browser regression

checkpoint_id: `CP-20260902-loopback-browser-regression`
created_at_utc: `2026-09-02T11:53:30Z`
status: `verified_with_gap`
base_git_commit: `6baf05e`

## Reason and scope

恢复接管后重新建立一份独立的 R2 运行证据。目标是用仓库当前构建产物启动临时
loopback mock API 与 Vite，验证控制台桌面/移动视口、REST/合法 WebSocket、非法
Origin 拒绝、API 停止/重启后的客户端恢复。历史 `.runtime` 目录和
`docs/12-final-release-audit.md` 只作为背景，不作为本轮结果。

本阶段不连接真实 Android/ADB/AVD/scrcpy，不启动系统 helper，不访问真实大麦或其他
外部服务，不使用账号或 APK，不改变生产配置，不引入新的 manifest/lockfile 依赖。

## Affected modules and ports

- `M9-console-contract-ui` / `CON-C4-event-stream`：浏览器 UI、REST client、事件流和重连；
- `API-C11-events-gateway`：Origin 校验、sync frame 和 WebSocket 关闭语义；
- `API-C10-health`：重启演练期间的 health probe；
- `M8-mock-app-harness`：仅使用仓库内 `mock-adapter` 合成设备/日程 fixture。

临时地址、端口、运行目录和 PID 均由运行时动态分配并记录在被忽略的 `.runtime` 证据
目录；它们不是部署默认值。浏览器 runner 仅用于本地 mock 控制面观察，不能调用真实
平台能力。

## Planned evidence

- 1440px 桌面和 390px 移动四个视图的截图、横向溢出和交互控件重叠检查；
- 合法 Origin 的 `event-stream.sync.v1` sync frame；
- 非法 Origin 的 REST CORS 拒绝和 WebSocket close code `1008`；
- API 精确停止、控制台异常状态、同端口重启和恢复后的快照同步；
- API/Vite/浏览器 PID、端口、退出码、stderr/stdout 与清理结果。

## Approval and risks

用户已批准继续推进并批准 loopback mock API/Vite/浏览器回归。该阶段仍可能生成临时
截图、日志和构建读取产物；这些文件应留在 `.runtime`，不进入提交。现有宿主机上有
与本项目无关的 Edge/Codex 进程，清理只能针对本阶段记录的精确 PID，不能按进程名批量
终止。浏览器工具若依赖宿主机提供的测试 runner，将在结果中明确记录其来源和局限，不能
当作项目运行时依赖或发布 SBOM 组件。

## Rollback and next gate

本阶段不修改 tracked 源码、依赖或配置；失败时保留失败证据并精确停止本阶段进程，
不删除旧 checkpoint。完成后追加 `result_status`、证据目录和偏差；下一门槛仍是
Tauri 原生窗口人工验收或用户批准的 helper/AVD Gate C，不因浏览器回归通过而扩大权限。

## Result append: 2026-09-02T11:57:29Z

`result_status`: `verified_with_gap`

### Actual execution

- 使用仓库构建产物 `apps/api/dist/main.js`、项目 `.tools/node/node.exe` 和项目 pnpm
  entry 启动临时 API/Vite；端口由运行时分配为 API `59235`、Console `59236`，绑定均为
  `127.0.0.1`。
- 使用显式 `R2_BROWSER_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  启动 Chromium-compatible 浏览器；测试只访问临时 Vite 页面和 mock API。
- 本轮运行目录：`.runtime/r2-final-1788350065805-8694a577/`；主要证据为
  `r2-evidence.json`、`r2-desktop.png`、`r2-mobile-overview.png`、`r2-recovered.png`，
  另有 API/Vite stdout/stderr 日志。该目录由 `.gitignore` 排除。

### Verification results

- 桌面 `1440px` 和移动 `390px` 下总览、设备、提醒、审计四个视图均通过；
  `scrollWidth`/`bodyScrollWidth` 分别等于视口宽度，交互控件重叠列表均为空。
- mock 设备和提醒通过浏览器触发的 REST fixture 创建，HTTP 状态均为 `201`；页面能显示
  合成设备/提醒，未写入真实凭据或平台数据。
- 合法 Origin 收到 `event-stream.sync.v1` sync frame；非法 Origin 的 REST fetch 被
  浏览器 CORS 拦截，WebSocket 建连后以 close code `1008`、reason `origin is not allowed`
  拒绝。
- 精确停止初始 API、等待控制台显示连接异常、同端口启动替代 API 后，页面恢复为“控制平面在线”；
  替代 API 使用新内存状态，恢复快照为空，符合当前非持久化实现。
- `r2-evidence.json` 的 `errors`、`console_errors` 均为空；API/Vite stderr 为空。
- 本轮脚本退出码为 `0`。初始 API PID `22244`、替代 API PID `31460` 以及 Vite 进程树均已
  精确停止；复核时两 PID 不存在，端口 `59236` 无监听，`59235` 仅保留 TCP `TIME_WAIT`。

### Evidence hashes

| artifact | SHA-256 |
| --- | --- |
| `r2-desktop.png` | `AE9C6D28953AC8D9F9A3BF4DAD6A154B2D9767911A37E1AAA2B47B852BE40FBC` |
| `r2-mobile-overview.png` | `BE393E162F2B54397DCEAA0B402DD777D5513A9C81C6771A131145E00802EA8D` |
| `r2-recovered.png` | `D3190C790D47F491982D8036AF24167BB918F98346293C35F6659F6C50852E26` |

### Deviation and next gate

仓库 tracked manifest/lockfile 没有 Playwright/Puppeteer；本轮为完成受控观察，使用了
Codex 提供的隔离 Playwright runtime，并通过显式 `NODE_PATH` 注入，同时指定宿主机 Edge
可执行文件。它没有进入项目源码或发布 SBOM，因此本结果不能替代“干净 checkout 可复现的
正式 T4 入口”。后续必须单独决定：把浏览器测试依赖正式纳入项目锁定图，或实现不依赖新增
包的项目内 test-only 浏览器协议 harness；在该决定完成前，`M9/CON-C4` 的浏览器证据状态
保持 `verified_with_gap`。

本轮没有启动 Tauri 原生窗口、AVD、ADB、scrcpy 或 helper，也没有扩大 loopback 绑定范围。
