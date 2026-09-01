# 前期调研报告

## 1. 调研结论

本阶段建议采用“本地控制平面 + 可插拔设备适配器 + mock-first 测试”的架构。真实大麦只作为用户在设备上自行操作的外部应用，不作为可编程业务 API。Android 设备观察优先使用 scrcpy 或平台级屏幕流；设备生命周期通过 ADB/模拟器命令或供应商适配器；Appium、uiautomator2、Maestro 仅用于本地 mock App 的测试，不接入真实购票流程。

## 2. 官方与一手来源

下表记录本次访问的公开页面。网页内容可能变化，实施前应重新核对并保存访问日期。

| 来源 | 观察 | 工程含义 |
| --- | --- | --- |
| [大麦官网](https://www.damai.cn/) | 页面公开展示分类、搜索框、登录入口、订单入口和“协议及隐私权政策”链接 | 控制台可以让用户自行打开官方页面；不得假设网页 DOM 或私有接口稳定 |
| [大麦协议入口](https://m.damai.cn/shows/mine/rule-list.html) | 官方移动端规则页存在协议/规则入口，页面由动态脚本渲染 | 不抓取或复制动态协议内容；上线前由用户/法务复核当前条款 |
| [大麦防诈骗专题页](https://x.damai.cn/markets/special/fangzhapian?spm=a2oeg.home.0.0.75df48d3hqGWGD&wh_ttid=pc) | 官网首页提供防骗入口，专题页标题为“年底防诈骗专题页” | 产品文案、提醒和日志不得暗示第三方代购或绕过官方渠道；用户应以官方页面为准 |
| [Appium 文档](https://appium.io/docs/en/latest/intro/) | Appium 是跨平台原生、混合和移动 Web 测试自动化框架 | 只用于 mock App 的契约/回归测试 |
| [Android Emulator 文档](https://developer.android.com/studio/run/emulator) | Android Studio/Emulator 是官方开发测试环境 | 首选作为可重复的 mock 设备环境，性能和多实例需实际压测 |
| [ADB 文档入口](https://developer.android.com/tools/adb) | ADB 是设备调试和管理通道 | 适配器只开放生命周期、只读诊断和显式打开应用 |
| [OpenAI Codex AGENTS.md 说明](https://developers.openai.com/codex/guides/agents-md) | 项目级约束通过仓库中的 AGENTS.md 传达 | 约束落到本仓库文件，不修改隐藏 system prompt |

由于 OpenAI 文档站在本环境的部分请求返回 403，AGENTS.md 的具体作用同时以 OpenAI Codex 开源仓库中的 [docs/agents_md.md](https://github.com/openai/codex/blob/main/docs/agents_md.md) 作为可核验索引；正式实施前应再次打开官方文档页面。

## 3. 开源项目比较

数据来自 GitHub 公共 API/README 的 2026-08-25 快照，星标只是活跃度参考，不等于安全或适配保证。

| 项目 | 许可证/状态 | 适合用途 | 不适合用途与风险 |
| --- | --- | --- | --- |
| [scrcpy](https://github.com/Genymobile/scrcpy) | Apache-2.0，活跃；README 描述为 USB/TCP 屏幕镜像和键鼠控制 | 低延迟只读预览、人工焦点设备操作 | 不能当作批量输入或自动抢票工具；其控制能力必须在适配器层禁用/隔离 |
| [Appium](https://github.com/appium/appium) | Apache-2.0，活跃；跨平台 UI 测试 | mock App 的端到端测试、设备能力探测 | 不连接真实大麦购票流程；驱动和版本矩阵较复杂 |
| [uiautomator2](https://github.com/openatx/uiautomator2) | MIT，活跃；Android UI 自动化 | mock App 的状态机测试、无障碍树实验 | 真实平台 UI 自动化会扩大合规和风控风险，生产适配器禁用 |
| [Maestro](https://github.com/mobile-dev-inc/Maestro) | Apache-2.0，活跃；YAML 流程测试 | mock App 的可读回归流程 | 流程脚本容易被误用于真实 App，仓库策略必须阻止真实包名 |
| [STF/DeviceFarmer](https://github.com/DeviceFarmer/stf) | API 未声明 SPDX，需人工审查；设备农场/远程调试 | 研究设备资产和远程观察 UX | 许可证与维护边界需审查；远程输入权限过大，不作为首版依赖 |
| [Google Emulator Container Scripts](https://github.com/google/android-emulator-container-scripts) | Apache-2.0，活跃 | CI/隔离环境里的 mock Android 实例 | Windows 本地 GPU、网络和许可条件需验证，不直接作为生产设备池 |
| [budtmo/docker-android](https://github.com/budtmo/docker-android) | GitHub API 未提供清晰 SPDX，需审查 | 快速试验、noVNC/录屏实验 | 供应链和镜像权限风险；不默认引入 |

## 4. 模拟器选型矩阵

| 方案 | 优点 | 主要限制 | 首阶段结论 |
| --- | --- | --- | --- |
| Android Studio Emulator | 官方、可脚本启动、快照和 ADB 完整 | 多实例资源占用、Windows GPU/Hyper-V 组合需验证 | 作为 mock 基线候选 |
| Genymotion | 多设备模板、开发体验成熟 | 商业许可和云/桌面版本边界 | 只有在许可确认后评估 |
| BlueStacks/雷电等消费级模拟器 | 多开功能常见、用户熟悉 | 闭源、自动化/商业许可不透明、版本行为不稳定 | 不作为核心依赖；仅人工观察试验 |
| 实体 Android 设备 | 真实兼容性、平台行为更接近用户场景 | 采购、USB/网络管理和并发成本 | 作为第二阶段人工验收设备 |
| 容器化 Emulator | 可重复、适合 CI | GPU、嵌套虚拟化和 Windows 支持复杂 | 只用于 CI/mock 实验 |

## 5. 风险与研究缺口

1. 大麦页面、登录和验证流程是动态的，不应把当前 DOM、包名或 URL 当成稳定接口。
2. 平台条款、实名规则、每单数量限制和可购买渠道会按演出变化；系统只提醒用户查阅官方规则，不自动推断。
3. 多设备并发会放大本地资源、账号安全和误操作风险；首版必须有设备上限和急停。
4. 任何屏幕流都可能暴露实名、二维码或支付信息；默认只在本机短时显示，禁止云上传和持久录制。
5. Appium/uiautomator2/Maestro 的自动化能力与本项目的人工闭环存在冲突，必须通过包名白名单和 CI 负向测试阻断真实平台。

## 6. 已批准的技术基线

- 控制 API：NestJS + TypeScript，OpenAPI 兼容 JSON REST；实时状态用标准 WebSocket。
- 控制台：Tauri + React/TypeScript；Electron、浏览器独立 UI 和 FastAPI 仅保留为已调研但未采用的对照方案。
- 事件：CloudEvents 风格 envelope，版本化 schema。
- 设备接入：`DeviceAdapter`；首版实现 `MockAdapter`，其次实现只读 ADB/Emulator 适配器。
- 画面：本机 scrcpy 或等价只读流；不保留帧，必要时内存环形缓冲并自动过期。
- 存储：SQLite/PostgreSQL 任选其一，首版 SQLite；只存设备、任务、提醒、审计和脱敏错误。
- 部署：Tauri 自包含桌面包 + NestJS 本地服务；所有地址、端口、工具路径和数据目录来自严格配置，不写死在源码。

FastAPI、Python 和 pip 在早期调研中仅用于比较，不属于已批准实现，也不应出现在正式运行时依赖中。

## 7. 证据等级与复核

- **已由来源确认：** 大麦首页的公开导航/登录/搜索入口、官方协议入口、防骗入口；所列开源仓库的公开许可证字段和维护状态快照；Appium、Android、scrcpy 等项目的公开定位。
- **工程假设：** 设备数量上限、提醒延迟目标、SQLite 作为首版存储；这些值要在 PoC 中测量并由用户确认。
- **待平台/法务确认：** 大麦当前用户协议、具体演出实名/退改/支付规则、商业模拟器 EULA、第三方依赖的再分发要求。

本报告不抓取登录后的内容，不调用未公开接口，不尝试验证码或风控挑战。公开页面和 GitHub 元数据均按 2026-08-25 记录；上线前需要重新打开链接并记录版本/哈希，不能把本报告当作平台规则的永久副本。

## 8. `WECENG/ticket-purchase` 静态审计（2026-09-01）

该仓库只作为风险对照和设备测试思路来源；本轮已隔离 clone 后静态阅读，未运行代码、
安装 APK、连接设备或访问大麦。当前提交为 `3a1c1f1`，GitHub API 未声明正式
OSI 许可证（`license=null`）。

**已由源码确认：** Android 和 Web 路径包含自动选择城市/场次/票价/数量/观演人、
批量点击和提交订单逻辑；Cookie 以本地 pickle 保存；默认配置允许提交订单；项目没有
可靠的多设备并发编排。环境检查只覆盖工具、设备和包名存在性，不能证明 APK 兼容性、
包体完整性或平台环境检测结果。

**风险类别：** 自动化输入/订单提交越过人工闭环；未锁定的移动依赖和缺少许可证增加
供应链风险；Cookie 与个人配置存在隐私/凭据暴露风险；文档中的宽监听 Appium 配置
会扩大远程控制面。仓库未发现可供本项目采用的 APK、私有 API 客户端、抓包或环境检测
绕过实现。上述结论不等同于对大麦服务端行为的实测结论。

本项目只可借鉴其“设备发现/状态观察”概念；不会移植点击、选票、登录、订单、Cookie
或降低自动化可见性的代码。真实 App 的兼容性和环境监测只能通过用户合法取得的版本、
单台设备和人工验收确认，不能通过逆向或规避手段确认。

## 9. 串流与本地 AVD 决策

Android Studio Device Streaming/远程实体设备可能支持多个会话，但并发上限、计费、
设备池、网络 RTT、数据流向和账号配额取决于供应商；Studio UI 本身不构成批量控制 API。
本地官方 AVD 没有按分钟云费用，生命周期和 ADB 更容易版本化，但受 CPU、内存、GPU、
磁盘和虚拟化后端约束。实体 USB 设备兼容性通常更接近用户环境，运维成本转移到采购、
USB 带宽和人工授权。

当前顺序为：`Mock` -> 官方 AVD 单实例 Gate C -> 单台实体设备人工验收 -> 在独立
许可证/隐私/配额审查后评估远程串流。任何方案都不能保证消除 APK 包体、完整性、调试、
网络或行为监测；本项目不以串流或模拟器规避检测。

## 10. 宿主机资源规划

资源 profile、保留量、启动并发和证据等级已独立记录在
`docs/13-host-preflight-and-deployment.md`。当前实现通过只读 API 返回估算，不把本机
硬件写成默认部署要求；跨宿主机必须重新 probe 并做 ramp test。
