# 模块工程说明

每个模块都有独立职责、输入输出和可替换边界。模块之间只依赖下文的接口契约，不读取彼此的数据库表。

## M1：设备注册与生命周期（Device Registry & Lifecycle）

职责：登记设备别名、提供商、连接地址和能力；启动、停止、重启、发现和健康检查。

输入：`DeviceRegistration`、`LifecycleCommand`。

输出：`DeviceSnapshot`、`device.state.changed`、`device.health.changed`。

不负责：第三方 App 登录、页面识别、任何 UI 点击或输入。

独立性：可以用 `MockAdapter` 运行；替换 Android Emulator/实体设备供应商不改变 API。

验收：重复启动幂等；错误可恢复；越权或未知能力一律拒绝；设备数量超过配额时不启动新进程。控制平面按 `heartbeat_seconds` 调用适配器健康端口；成功但状态未变化的心跳只刷新 `last_seen_at`，不推进设备 `sequence`，避免使已经展示给操作者的确认快照无故失效。只有状态转换才推进序列并发布 `device.health.changed`。适配器抛错、返回未知枚举或返回与操作相矛盾的生命周期/预览结果时，控制平面转换为 `adapter.unavailable`，进入受控 `error` 状态并审计；连续相同健康故障不重复推进序列或刷写同类审计。

## M2：只读画面与焦点管理（Screen Preview）

职责：创建/停止单个设备的只读预览，报告帧时间戳、尺寸、丢帧和流状态；管理当前焦点设备。

输入：`PreviewStart`、`PreviewStop`、`FocusSelect`。

输出：`screen.stream.started`、`screen.frame.meta`、`screen.stream.stopped`。

默认策略：不落盘、不录制、不 OCR、不做页面元素识别；只允许一个焦点流。画面上可能出现敏感信息，UI 必须提供立即停止按钮。

## M3：时间同步与提醒（Schedule & Reminder）

职责：解析带时区的开售时间，检测系统时钟偏差，计算单调倒计时，触发本地提醒并等待人工确认。

输入：`ScheduleDefinition`、`ReminderAck`。

输出：`schedule.created`、`schedule.tick`（仅内部）、`reminder.fired`、`reminder.acknowledged`、`clock.uncertain`。

约束：提醒只能产生 `ReadyForHuman` 语义，绝不调用设备输入或第三方 API。每个提醒目标必须严格晚于当前控制平面时间，错过窗口的创建/修改请求 fail closed；系统睡眠/时钟跳变时必须重新确认。终态日程不可变更，取消必须是 state-only 请求。

## M4：人工确认闸门（Human Confirmation Gateway）

职责：显示即将执行的安全操作、要求操作者确认、签发短期命令票据、写审计。

允许命令：设备启动/停止/重连、打开已配置的 App、开始/停止预览、单设备焦点选择、提醒确认。

禁止命令：输入文本/坐标、批量广播、点击购买/提交/支付、验证码、实名、支付密码、OCR 后动作。

实现要求：服务端重新校验，而不是信任 UI；每次命令带 `operator_id`、`device_id`、`intent`、`expires_at` 和 `idempotency_key`；无确认或过期则拒绝。

## M5：账号别名与任务配置（Alias & Task Registry）

职责：保存不可识别的账号别名、设备分组、演出公开信息、备注和人工状态。

只允许保存：随机内部 ID、用户自定义别名、公开链接、时区、提醒策略、状态标签。

严禁保存：密码、OTP、身份证号、实名姓名、支付密码、Cookie、Token、完整订单号或支付二维码。

## M6：审计与安全（Audit & Security）

职责：鉴权、授权、策略版本、审计事件、脱敏、保留和急停。

要求：拒绝事件也记录；日志字段采用结构化 schema；错误消息不能回显命令原文中的秘密；支持导出脱敏 JSON 供人工复核。

## M7：模拟器/设备适配器（Adapter Layer）

职责：把供应商命令映射为端口接口，维护进程句柄、连接状态和资源配额。

适配器分级：

- `MockAdapter`：允许完整自动化测试，但只连接仓库内 mock App。
- `ReadOnlyAdbAdapter`：发现、健康、截图/流元数据、启动/停止 AVD；禁止 `input` 子命令。
- `HumanPreviewAdapter`：可调用 scrcpy 进行人工预览；输入能力默认关闭，若未来启用必须单设备、单事件、可见和审计。

## M8：测试与仿真（Mock App Harness）

职责：提供合成 App、状态 fixture、故障注入、契约测试和 UI 回归。

安全隔离：测试包名使用 `local.mock.ticketing`; CI 在执行自动化前检查包名，不允许连接 `cn.damai` 或未知包名；测试数据全部生成且不可对应真实个人。

## M9：控制台 UI/API 合约

职责：把各模块呈现为设备网格、时间线、提醒面板、审计视图和错误恢复入口。

UI 不显示“自动抢票”“成功率”等会诱导越权的功能文案；所有高风险动作使用明确的人类可理解的确认文案。

## M10：配置与依赖目录（Configuration & Supply Chain）

职责：加载并校验绑定地址、端口、数据/日志目录、外部工具路径、资源配额和依赖 provenance；向其他模块提供不可变的运行时配置。

输入：版本化配置文件、允许的环境变量覆盖、用户在 UI 中选择的 provider 路径。

输出：`ValidatedConfig`、启动诊断、构建 provenance 和依赖审计结果。

约束：不提供隐式系统路径、不猜测 `PATH`、不接受未知配置键、不把配置写回源码。配置解析失败时控制平面不启动；路径穿越、不可执行文件、地址格式错误和超出资源上限都要 fail closed。

独立性：可在没有 Android 设备和真实平台的机器上单元测试；其 schema 与 `docs/09-dependency-and-reproducible-build.md`、构建清单和 provider manifest 版本化。

## M11：宿主机探测与部署规划（Host Readiness & Planning）

职责：以无副作用方式读取目标宿主机的 CPU、内存、磁盘和显式工具选择状态，加载
版本化 provider manifest，并给出带资源保留量的保守容量/启动并发估算。

输入：操作系统资源 API、用户明确选择的 SDK/ADB/模拟器/scrcpy 路径、provider
manifest。不得从 PATH、注册表或用户目录猜测工具，不执行 APK 或真实第三方应用。

输出：`host-probe.v1`、`provider-manifest.v1`、容量规划结果和待人工复核的
`unknown` 项。响应不包含绝对路径、主机名、环境变量原文、凭据或设备画面。

约束：默认 `side_effects=none`；激活/启动阶段必须与探测阶段分离，并经过单独的人
工确认、命令 allowlist、资源预留、generation/operation_id 和审计。provider 能力
中的 `user_input` 与 `automation` 永远为 `false`。

独立性：HostService 的容量函数可以脱离 Android SDK、设备和网络进行单元测试；
不同宿主机只提供 probe 输入，不改变控制平面协议。当前开放 `/hosts/probe`、
`/hosts/providers` 只读端点，以及仅管理进程内 mock 状态的 `/deployments*` REST
端点；真实 provider 的部署状态控制仍留待认证/TLS/RBAC 和 Gate C 通过后实现。
