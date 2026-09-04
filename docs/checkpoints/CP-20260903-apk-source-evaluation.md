# Checkpoint: APK source and static provenance evaluation

checkpoint_id: `CP-20260903-apk-source-evaluation`
created_at_utc: `2026-09-03T14:34:12Z`
status: `verified_with_gap`
initial_status: `in_progress`
base_git_commit: `ba6e3b2eecebe1c5b547d2a9329d013a23b35d28`

## Scope and non-goals

用户已批准在完成 entity5、Tauri release smoke 和隔离门禁/推送后进入 APK 评估，并允许
考虑直接联网下载。本阶段仅查找官方/主流商店来源、记录网络证据，并在来源合格时将工件
下载到 Git 忽略的隔离目录做静态核验；不启动 AVD、不安装或运行 APK，不登录、不输入、
不抓包、不逆向、不调用私有接口、不研究风控规避。

## Affected modules and module books

- 新增 `M14-apk-provenance-gate`：拥有来源、工件静态证据和安装资格结论；不拥有设备。
- `M10-config-supply-chain`：仅提供 provenance/checkpoint 约束；APK 不进入项目依赖或 SBOM。
- `M7-adapter-layer` / `M13-system-helper-policy`：本阶段不连接；`apk_install` 继续默认拒绝。

模块开发书：`docs/modules/apk-provenance-gate.md`。

## Files, dependencies, processes and devices

- 创建本 checkpoint 时的 tracked 文件范围仅为本 checkpoint、M14 模块书和模块索引；不新增
  依赖、lockfile 或运行配置。后续路线图和最终审计的追加记录另行登记。
- 网络响应、HTML、下载工件和静态报告只进入 `.runtime/apk-evaluation-20260903/`。
- 只使用显式发现的宿主 Android SDK build-tools 做只读核验；使用前记录版本和 hash。系统
  Defender 若可用，只做目标文件扫描并记录版本/结果，不进入成品运行依赖。
- 创建本 checkpoint 时的现场快照为用户 `ticket_test_1` 保持在线但不由本阶段操作；`entity3/5`
  不启动。后续收尾状态以静态门禁 checkpoint 为准。

## Acceptance contract

1. 来源优先级为官方域名、主流应用商店；第三方下载站和 GitHub 项目不作为 APK 来源。
2. 网络请求必须有界，记录原始 URL、最终 URL、重定向、状态、内容类型、长度和 UTC 时间。
3. 下载前先核验来源页面；下载只进入隔离目录并计算 SHA-256，不自动执行或安装。
4. ZIP、APK 签名、证书、包名、版本、permissions、exported components、ABI/SDK、debuggable
   与 Defender 检查全部完成后才判定；signer 身份无法交叉锚定时 fail closed。
5. 4 KB 和 16 KB `zipalign -c` 检查均通过；任一未对齐条目都阻断安装并记录。
6. 期望包名为来源材料声明的 `cn.damai`；该值仅用于研究文档，不成为项目运行时默认值。
7. x86_64 兼容性必须依据实际 native library/安装结果判断，不能由网页版本说明推断。

## Decisions and approvals

- 外部网络和候选 APK 下载已由用户批准；供应商/来源选择由本阶段依上述标准评估。
- 用户尚未在本 checkpoint 单独批准向设备安装未知工件；即使工件合格，安装前仍需报告
  来源、版本、SHA-256、signer、权限/ABI/SDK 和风险，再进入设备阶段。
- 项目禁止逆向、私有接口、自动登录/验证码/输入/购票/支付及环境检测规避，优先级高于
  早期“必要时考虑逆向”的探索性表述。

## Risks and data handling

- 最大风险为第三方重打包、下载链劫持、证书身份未锚定、split 包不完整和 ARM-only native
  library 与 x86_64 AVD 不兼容。签名“有效”只能证明包自签名后未变，不能单独证明官方身份。
- APK 为闭源第三方工件，不提交、不再分发、不进入项目交付物；不采集账号、设备标识、
  Cookie、token 或真实订单数据。
- 首次来源探测命令在 PowerShell 解析阶段因空管道失败，未发出网络请求、未写文件；重试
  必须先修正命令结构并保留该偏差。

## Rollback and next gate

若来源或静态门禁失败，历史记录可写作 `rejected`/`signature_valid_identity_unanchored`；
规范化状态应按新 checkpoint 的 `stage_decision` 与 `reason_class` 分字段并停止，
不更换为低信誉源。外部工件清理需要先解析精确忽略目录并取得单独批准；文档回滚只追加
更正，不删除本 checkpoint 或重写 Git 历史。

下一门槛是取得至少一个官方/主流商店候选并完成静态报告。只有报告为 `install_eligible`，
才向用户汇报并申请/确认专用 `entity5` 安装与纯人工兼容性观察；否则停在来源评估。

## 2026-09-04 状态转移记录（不可覆盖追加）

来源阶段已完成，静态门禁结果转由独立 checkpoint
`CP-20260904-apk-static-gate` 固化。该候选没有达到 `install_eligible`，最终状态为
`rejected / signature_valid_identity_unanchored`，`install_allowed=false`；因此本来源
评估的有效状态为 `verified_with_gap`，不向设备阶段连接。`initial_status` 保留创建时状态；
M14 总线仍为 active，但不表示本来源 checkpoint 仍在运行。后续更正只追加到新 checkpoint。

## 2026-09-04 受控候选核验追加（不可覆盖）

本节记录本 checkpoint 后续的实际操作，不改写上方历史状态。用户在本轮明确批准从应用宝
获取应用；登录、账号、验证码和后续 App 内操作仍由用户本人完成。下载前没有启动 AVD、
没有调用 ADB，也没有安装或启动 APK。

### 来源与网络证据

- 应用宝页面 `https://sj.qq.com/appdetail/cn.damai` 的 `cn.damai` 对象声明包名
  `cn.damai`、版本 `9.0.32`、大小 `109959714` bytes 和 MD5
  `9A7D35E181CFE078E8A2AFDEE4394F10`；该对象的 `download_url` 与 `apk_url` 均为空。
- 本次候选 URL 是依据上述商店元数据的 CDN 文件名规则推导出的
  `https://imtt2.dd.qq.com/sjy.00008/sjy.00004/16891/apk/9A7D35E181CFE078E8A2AFDEE4394F10.apk?fsname=cn.damai_9.0.32.apk`，
  不是页面显式下载字段。因此来源分类只能记为“应用宝主流商店的派生 CDN 候选”，不能
  记为已由页面直接锚定的官方直链。
- 2026-09-04T15:30:56Z 的 HTTPS HEAD 返回 `200`、
  `application/vnd.android.package-archive`、`109959714` bytes、无重定向；受控 GET
  同样返回 `200`、无重定向，实际长度与声明一致。完整字段见被忽略的
  `.runtime/apk-evaluation-20260903/static-20260904/source-probe.json`。
- TLS 只读探测为 `TLS 1.3`，主机 `imtt2.dd.qq.com`，证书主题
  `CN=imtt2.dd.qq.com`，SHA-1 thumbprint
  `4ACBF581148B999B04D9D8C93E5E074350B1EAAA`；TLS 证书只证明传输端点，不证明 APK
  发布者身份。

### 隔离工件与静态证据

- 工件仅保存于被 Git 忽略的
  `.runtime/apk-evaluation-20260903/candidates/cn.damai-9.0.32-yyb.apk`，大小
  `109959714` bytes，SHA-256
  `626F6643A82F49A080D0998DEC51D4B0815DF23A68A2AB72BE088959BF95AB2F`，MD5 与商店声明
  一致。下载采用 `.part` 文件、长度上限 `160 MiB` 和 180 秒超时；脚本先核验响应/长度并
  原子改名，再对 final 文件计算 SHA-256/MD5。哈希和静态门禁完成前不得安装。
- ZIP 流式读取 `12466` 个条目、解压 `178215644` bytes，失败条目 `0`；证据为
  `.runtime/apk-evaluation-20260903/static-20260904/zip-stream-integrity.json`。
- `apksigner 0.9` 的 `v2` 数学验证通过，1 个 signer；证书自报
  `O=大麦娱乐, L=北京, C=86`，证书 SHA-256
  `4ACD9A208AF31123608CF1355AC63D53E27547387E4E254BCD232E72EFE2E3C9`，RSA `1024` 位，
  有效期 2011-06-01 至 2061-05-19。没有独立可信安装基线或第二来源指纹，故身份仍未锚定。
- manifest/badging：包名 `cn.damai`、版本 `9.0.32`、versionCode `109003200`、
  minSdk `23`、targetSdk `35`、`debuggable=false`。ZIP 含 `75` 个 native libraries，
  ABI 仅 `armeabi-v7a`；目标 entity5 是 Android 37 `x86_64`，现有镜像只报告
  `arm64-v8a` 转译候选，不能把 armeabi-v7a 视为兼容。
- `zipalign -c` 的 4 KB 与 16 KB 检查均失败；未对齐条目为
  `lib/armeabi-v7a/libpreverify1.so` 和 `lib/armeabi-v7a/libsgxdataso.version.so`。
- manifest 解析出 `58` 项 uses-permission、约 `400` 个组件，其中 `79` 个
  `exported=true`。人工复核风险包括相机、录音、精确/粗略定位、媒体/存储、日历、
  `REQUEST_INSTALL_PACKAGES`、网络状态变更、`RUN_INSTRUMENTATION`、锁屏/状态栏和多家
  厂商推送权限；这不是恶意判定，但在来源/签名未锚定时必须保持人工审查。
- Defender `MpCmdRun.exe` 版本 `4.18.26080.3-0`、引擎 `1.1.26080.3`、签名
  `1.459.49.0`，扫描退出码 `0`，输出为未发现威胁。扫描清洁不能替代来源、签名或 ABI
  兼容性证明。工具路径、哈希及原始输出见 `static-20260904/`。

### 决策、偏差与现场清理

综合结果为 `rejected`，并保留次级分类
`signature_valid_identity_unanchored`；`install_allowed=false`。拒绝依据为：派生 URL
未被页面下载字段独立锚定、signer 无可信基线、仅 armeabi-v7a 与目标 x86_64/arm64 转译
路径不匹配，以及 zipalign 失败。没有安装到 entity5，也没有启动真实 App；应用内登录等
事项尚未发生。

一次只读 `adb devices -l` 因 ADB server 未运行而自动启动了显式 SDK `adb.exe` daemon
（PID `12208`，仅监听 `127.0.0.1:5037`，设备列表为空）。这是本轮可见副作用，不是
项目服务或 helper；已用同一显式 SDK `adb.exe kill-server` 清理，并复核无 adb 进程和
5037 listener。没有 emulator/qemu 进程，entity1 未被触碰。

本轮首次长内联下载命令在进程启动前被 PowerShell 转义策略拒绝，未发出请求；随后改用
隔离的一次性脚本完成受控下载。该偏差和所有原始报告保留在 `.runtime`，不进入项目运行时。

### 回滚与下一门槛

APK 是外部闭源工件，不提交 Git、不进入 SBOM/发布物/helper allowlist。若需清理，必须由
用户单独确认精确的 `.runtime/apk-evaluation-20260903/` 目标后再删除；不得按名称批量
删除 AVD 或源码。当前不满足安装门槛，故不向 entity5 发送安装命令。

下一门槛是取得可独立验证的官方/商店 APK（优先用户从官方设备/商店导出并提供 SHA-256
与 `apksigner` 输出，或由商店页面提供可核验直链），补齐可信 signer 锚点，并确认目标
ABI/对齐要求。只有新的报告达到 `install_eligible` 且用户再次确认，才可在专用 entity5
进行“安装后不自动操作、仅人工观察”的独立阶段；登录、验证码、输入、购票和支付始终
由用户完成。
