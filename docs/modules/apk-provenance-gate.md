# APK 来源与静态核验模块开发书

**module_id**：`M14-apk-provenance-gate`
**版本**：`apk-provenance-gate.v1`
**状态**：`active`（仅 operator-run 来源研究与静态核验；安装连接为 `planned`）
**治理**：`partial`（已定义门禁和证据模型；项目内 test-only harness、证书锚点和安装端口尚未闭合）
**负责人边界**：APK 供应链证据与安装资格判定 owner；不拥有设备生命周期、设备输入或真实平台操作

## 1. 职责与非职责

本模块对用户授权获取的 Android 安装包执行来源、重定向、哈希、ZIP 完整性、APK 签名、
证书指纹、manifest、权限、ABI、SDK、debuggable 标志和本机恶意软件扫描核验，并输出可审计
的资格结论。候选优先来自大麦/阿里官方域名或主流 Android 应用商店；搜索引擎结果和第三方
下载站只能作为发现线索，不能直接成为信任锚点。

本模块不自动安装或启动 APK，不操作登录、验证码、页面、票档、订单或支付，不抓包、不
逆向、不调用私有接口，也不规避环境、包体或设备检测。APK 不进入 Git、项目依赖、SBOM、
发布包或 helper allowlist；研究结果不得被解释为项目获得真实平台自动化能力。

## 2. 状态、变量与不变量

状态机为：

`candidate_discovered -> source_candidate_recorded -> artifact_quarantined -> static_verified -> install_eligible`

`source_candidate_recorded` 只表示已记录并分类候选，不是发布者身份或下载链已验证。只有
页面直接提供、可独立核验的来源记为 `source_anchor_status=direct`；仅由页面元数据推导的
下载地址记为 `source_anchor_status=derived`，并另以 `source_identity_anchor=false` 表示
发布者身份未锚定。本次候选因此为 `derived` + `false`，而不是把两个维度压成一个状态。

任一检查失败时 `stage_decision=rejected`；证书身份没有可信锚点时同时记录
`reason_class=signature_valid_identity_unanchored`，不得继续安装。只有
`stage_decision=install_eligible` 且 `install_allowed=true` 才能交接到设备阶段。下载成功
不等于来源可信，签名数学有效也不等于发布者身份已确认。

| 变量/记录 | 类型与取值 | owner / 生命周期 |
| --- | --- | --- |
| `candidate_url` / `final_url` | HTTPS URL 与完整重定向链 | 本模块；只写入忽略目录和 checkpoint |
| `source_class` | `official_domain/mainstream_store/mainstream_store_cdn_candidate/third_party/unknown` | 本模块；人工可审计分类 |
| `source_anchor_status` | `direct/derived` | 本模块；下载链强度 |
| `source_identity_anchor` | boolean | 本模块；独立 signer/发布者身份锚点，缺失时为 `false` |
| `artifact_sha256` / `size_bytes` | 下载后计算 | 本模块；不可由网页声明替代 |
| `package_name` / `version_*` | APK manifest 静态字段 | Android build-tools 只读输出 |
| `signer_fingerprints` | APK signer 证书 SHA-256 集合 | 本模块；必须与独立可信来源交叉锚定 |
| `permissions` / `abis` / `sdk` / `debuggable` | manifest/native 静态面 | 本模块；不读取用户数据 |
| `malware_scan` | Defender 路径、版本、结果、时间 | operator-run 系统前置项证据 |
| `stage_decision` | `install_eligible/rejected` | 本模块；顶层阶段结果，默认 `rejected` |
| `reason_class` | `none/signature_valid_identity_unanchored/...` | 本模块；阻断原因，不是安装资格 |
| `install_allowed` | boolean | 仅 `stage_decision=install_eligible` 时可为 `true` |

共享下载目录必须位于 Git 忽略的 `.runtime/apk-evaluation-*`，不得复用项目源码、`data/`、
用户凭据目录或 AVD data image。原始 APK 是闭源第三方工件，只为本地人工兼容性评估临时保留，
不得再分发。

## 3. 函数、工具端口与错误语义

当前均为 operator-run 研究端口，不是生产 API。实际命令、版本、参数和输出必须写入 checkpoint
或忽略目录；未来若代码化，需另建版本化 test-only port，不能从 PATH 猜测工具。

| 逻辑入口 | 输入/前置条件 | 输出/后置条件 | 失败/超时/幂等 |
| --- | --- | --- | --- |
| `discoverCandidate(sourceUrl)` | 用户已批准联网；HTTPS；无凭据 | 来源分类、响应头、重定向链 | 单次 discovery 请求 20 秒级；失败不降级第三方源 |
| `quarantineDownload(finalUrl)` | 来源至少为官方或主流商店候选 | 原始 bytes、长度、SHA-256 | 本次完整 GET 为 180 秒/160 MiB 上限；中断文件不可安装 |
| `verifyApk(artifact)` | 文件只读；build-tools 路径显式选择 | ZIP、签名、证书、manifest/ABI 报告 | 任一解析/签名错误即 `rejected`；幂等 |
| `anchorSigner(fingerprint, evidence)` | 至少两个独立可信来源，或用户提供已知可信安装基线 | 身份锚定证据 | 单一下载源只能得到 `identity_unanchored` |
| `scanArtifact(artifact)` | Defender 路径/版本已记录 | scan result | 扫描不可用或非 clean 即不可安装 |
| `decideInstallEligibility(report)` | 所有必需字段齐全 | `stage_decision`、`reason_class`、`install_allowed` | 缺字段默认拒绝；无自动重试 |

本模块没有 REST、WebSocket、CloudEvents、数据库或设备通信。未来安装连接只能通过独立、
人工批准的 provider-host/helper 能力；当前 `system-helper-manifest.v1` 仍不允许 `apk_install`。

## 4. 静态验收标准

安装资格必须同时满足：

1. 最终下载及所有重定向使用 HTTPS，且下载链由官方/主流商店页面直接提供或由独立可信材料锚定；
2. APK/拆分包容器完整，实际 SHA-256、长度和获取时间已记录；
3. `apksigner verify --verbose --print-certs` 成功，且 signer 集合无异常轮换；
4. 期望包名为来源页面声明的 `cn.damai`，版本字段可读，`debuggable=false`；
5. 权限和 exported component 列表已人工复核，没有第三方安装器或额外 wrapper；
6. ABI 与目标 `x86_64` AVD 的实际兼容路径可解释；仅 ARM native library 不宣称兼容；
7. min/target SDK 与 Android 37 测试环境可解释，Defender 扫描为 clean；
8. 对 Android 37 候选同时通过 4 KB 基线和 16 KB page-size readiness 的 `zipalign -c` 检查；
   任一失败都必须阻断安装并记录未对齐条目；
9. signer 证书已由独立可信材料锚定。无法锚定时即使前八项通过也不安装。

## 5. 专用测试入口与负向断言

当前 test-only harness 为 `planned`。正式连接前应建立合成 APK/ZIP fixture，只测试解析器和
决策器，不包含真实大麦二进制。至少覆盖：截断 ZIP、签名失败、证书变化、错误包名、
`debuggable=true`、未知 ABI、危险权限/导出组件、HTTP 降级、重定向到第三方域、扫描不可用、
单一来源证书未锚定和 split 安装集不完整。真实 APK 只允许人工兼容性验收，不进入自动化测试。

## 6. 递归子模块

| 子模块 ID | 边界 | 当前状态 | 连接门槛 |
| --- | --- | --- | --- |
| `M14-C1-source-discovery` | 来源/重定向/发布者声明 | active (operator-run) | 来源 allowlist schema 与离线 fixture |
| `M14-C2-artifact-quarantine` | 下载、长度、哈希、保留 | active (operator-run) | 大小/超时/清理策略 |
| `M14-C3-apk-static-verifier` | ZIP、签名、manifest、ABI/SDK | planned | 项目内 wrapper 与合成 fixture |
| `M14-C4-signer-anchor` | 证书身份交叉锚定 | planned | 可信基线与轮换策略 |
| `M14-C5-malware-gate` | 系统扫描器只读调用 | planned | helper 白名单或明确 operator-run 记录 |
| `M14-C6-install-handoff` | 向设备安装阶段交接资格报告 | planned | 用户单独批准、M7/M13 port、精确回滚 |

## 7. Checkpoint、连接与回滚

首次关联 checkpoint 为 `CP-20260903-apk-source-evaluation`；本次静态门禁结论记录于
`CP-20260904-apk-static-gate`。M14 只向后续人工安装阶段交付
不可变资格报告；M7 只消费“是否允许进入安装”的结论，不读取 M14 临时文件内部结构；M13
在未来拥有 helper 激活策略，但当前明确拒绝 `apk_install`。

下载或核验失败时保留报告和原始响应证据，不改 AVD、不降级来源、不删除历史 checkpoint。
若用户决定撤销，先确认目标文件仅位于本阶段忽略目录，再单独批准删除；不得用 Git 回滚
代替外部工件清理。

## 8. 结论分类

- **已由代码/测试确认**：当前项目仍无 APK 安装生产能力，helper 默认拒绝 `apk_install`。
- **工程假设**：主流商店工件可获得且能由标准 Android build-tools 静态核验。
- **待用户/平台确认**：可信 signer 基线、商店授权条款、真实 App 在 x86_64 模拟器上的兼容性、
  环境检测行为和任何后续安装；真实 App 内所有操作始终人工完成。

## 9. 2026-09-04 operator-run evidence and fail-closed result

本节由 `CP-20260904-apk-static-gate` 固化，并保留对
`CP-20260903-apk-source-evaluation` 的来源阶段引用；不把 operator-run 脚本误记为
生产能力或正式 test-only harness。当前一次候选核验使用以下固定参数：初始请求和每一跳
都必须是 HTTPS；候选主机限定为应用宝 CDN；不自动跟随重定向；GET 超时 180 秒、字节上限
160 MiB；临时文件名为 `<artifact>.part`。本次脚本先核验状态、类型和长度，再原子改名，
随后对 final 文件计算 SHA-256/MD5；只有哈希记录完成且后续静态门禁通过才可能安装。该顺序
是本次 operator-run 的实际证据，不作为未来项目内 harness 的既定实现。来源/下载证据保存在被忽略的
`.runtime/apk-evaluation-20260903/static-20260904/source-probe.json`。

商店页面对 `cn.damai` 的 `download_url`/`apk_url` 为空；本轮 URL 由页面声明的 MD5/文件名
规则推导，故 `source_candidate_recorded` 只能表示“主流商店派生候选”，不能表示页面直链或
官方身份已确认；本次 `source_anchor_status=derived`、`source_identity_anchor=false`。HEAD/GET
均为 `200`、APK content type、`109959714` bytes、无重定向；TLS 为
`TLS 1.3`。下载工件 SHA-256 为
`626F6643A82F49A080D0998DEC51D4B0815DF23A68A2AB72BE088959BF95AB2F`，MD5 与页面声明一致。

静态核验报告（`static-20260904/static-summary.json`、`certificate-summary.json`、
`zip-stream-integrity.json`、`decision.json`）记录了：

- ZIP `12466` entries 全量读取成功（解压 `178215644` bytes，失败 `0`）；
- `apksigner` v2 验证通过，但 signer 为 RSA 1024、自报 `O=大麦娱乐, L=北京, C=86`，
  指纹 `4ACD9A208AF31123608CF1355AC63D53E27547387E4E254BCD232E72EFE2E3C9` 没有独立可信
  基线；
- manifest 为 `cn.damai` 9.0.32、minSdk 23、targetSdk 35、`debuggable=false`，含 75 个
  native libraries 且 ABI 仅 `armeabi-v7a`；entity5 目标为 x86_64/arm64 转译候选；
- 4 KB 和 16 KB `zipalign -c` 均失败，两个失败条目是
  `lib/armeabi-v7a/libpreverify1.so` 与 `lib/armeabi-v7a/libsgxdataso.version.so`；
- 解析到 58 项 uses-permission、400 个组件和约 79 个 `exported=true` 组件，需人工权限/组件
  复核；Defender 扫描退出码 0 且未发现威胁，但不改变来源/签名/ABI 门禁。

因此本候选状态为 `rejected`，附加原因分类为
`signature_valid_identity_unanchored`；`install_allowed=false`。M14 不向 M7/M13 发送
安装请求、不启动 AVD、不读取用户凭据，也不把 APK 加入项目依赖、SBOM 或发布物。

本次 operator-run `decision.json` 的 `decision` 字段保存的是旧格式原因值
`signature_valid_identity_unanchored`；规范化读取必须将其映射为
`stage_decision=rejected`、同名 `reason_class` 和 `install_allowed=false`。消费者不得把该
原因值解释成第三种可安装阶段。`apkanalyzer manifest permissions` 因其内部调用
`aapt dump badging` 返回 1 而退出 1；权限证据改用独立成功的 `aapt2 dump permissions`
（退出 0，解析 58 项），该工具偏差不被记作“全部检查通过”。

本次 operator-run 使用的工具版本/哈希和原始输出均在 `static-20260904/`；Android SDK
路径仅作为审计证据，不得复制到源码、配置默认值或运行时。后续若代码化，必须先建立
独立的 `M14-C3` synthetic APK/ZIP test-only harness，输出版本化 `stage_decision`、
`reason_class`、`install_allowed` 和 `blockers[]`，并覆盖截断 ZIP、签名/证书变化、错误
包名、ABI、对齐、HTTP 降级、非 allowlist 重定向、超时/大小上限、扫描不可用和 split 集
不完整等负向案例；真实 APK 只可走人工兼容性验收。
