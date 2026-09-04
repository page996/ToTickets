# Checkpoint: APK static provenance gate

checkpoint_id: `CP-20260904-apk-static-gate`
created_at_utc: `2026-09-04T15:43:16Z`
status: `rejected`
base_git_commit: `ba6e3b2eecebe1c5b547d2a9329d013a23b35d28`

## 1. Goal and boundary

本阶段承接 `CP-20260903-apk-source-evaluation`，对用户批准从应用宝获取的一个
`cn.damai` 候选执行隔离下载后的静态来源门禁，并形成不可覆盖的安装资格结论。范围只含
来源元数据、传输证据、工件哈希、ZIP/APK 签名、manifest、ABI、对齐和恶意软件扫描。

本阶段不启动 AVD，不安装或运行真实 App，不登录、不输入、不抓包、不逆向、不调用私有
接口，也不研究或规避包体、环境或平台风控。用户对来源研究的批准不等于绕过 M14 门禁的
安装批准。

## 2. Modules and ownership

- `M14-apk-provenance-gate` 拥有本次来源、静态核验和 `install_allowed` 决策。
- `M7-adapter-layer`、`M13-system-helper-policy` 未连接；`apk_install` 仍默认拒绝。
- APK、HTML、网络响应和工具原始输出只保存在 Git 忽略的
  `.runtime/apk-evaluation-20260903/`，不进入依赖、SBOM、发布包或 helper allowlist。
- 本阶段没有新增依赖、生产接口、运行时配置、数据库、设备状态或外部监听。

## 3. Source and artifact evidence

应用宝页面 `https://sj.qq.com/appdetail/cn.damai` 声明：

| 字段 | 观测值 |
| --- | --- |
| package / version | `cn.damai` / `9.0.32` (`versionCode=109003200`) |
| declared size | `109959714` bytes |
| declared MD5 | `9A7D35E181CFE078E8A2AFDEE4394F10` |
| page download fields | `download_url` 与 `apk_url` 均为空 |

本阶段规范化字段为 `source_class=mainstream_store_cdn_candidate`、
`source_anchor_status=derived`、`source_identity_anchor=false`、`stage_decision=rejected`、
`reason_class=signature_valid_identity_unanchored` 和 `install_allowed=false`。

候选 URL 由页面 MD5 和文件名规则推导，不是页面直接给出的下载链。应用宝 HTML 中另一个
显式 APK URL 属于应用宝自身下载器，并非 `cn.damai`，因此不能作为该候选的来源锚点。
受控 HTTPS HEAD/GET 均返回 `200`、APK content type、`109959714` bytes 且无重定向；
TLS 1.3 和 CDN 证书只证明传输端点，不能证明 APK 发布者身份。

隔离工件：

| 字段 | 实际值 |
| --- | --- |
| ignored path | `.runtime/apk-evaluation-20260903/candidates/cn.damai-9.0.32-yyb.apk` |
| size | `109959714` bytes |
| MD5 | `9A7D35E181CFE078E8A2AFDEE4394F10`（与页面声明一致） |
| SHA-256 | `626F6643A82F49A080D0998DEC51D4B0815DF23A68A2AB72BE088959BF95AB2F` |

网络、TLS 和下载字段的结构化证据在
`.runtime/apk-evaluation-20260903/static-20260904/source-probe.json` 与
`tls-probe.json`。这些忽略目录证据是本机 checkpoint 附件，不是版本化发布物。

## 4. Static verification

| Check | Result |
| --- | --- |
| ZIP stream integrity | `12466` entries、`178215644` expanded bytes、失败 `0` |
| APK signature | `apksigner` v2 数学验证通过；1 个 signer |
| signer | 自签名 `O=大麦娱乐, L=北京, C=86`；RSA 1024；SHA-256 `4ACD9A208AF31123608CF1355AC63D53E27547387E4E254BCD232E72EFE2E3C9` |
| signer identity | 没有独立可信设备/商店基线，`identity_anchor=false` |
| manifest | `cn.damai` 9.0.32；minSdk 23；targetSdk 35；`debuggable=false` |
| native ABI | 75 个 native libraries，仅 `armeabi-v7a` |
| target compatibility | entity5 为 Android 37 `x86_64`；镜像只报告 arm64 转译候选，不能证明 ARMv7 兼容 |
| zipalign | 4 KB 与 16 KB 检查均失败 |
| zipalign failures | `lib/armeabi-v7a/libpreverify1.so`、`lib/armeabi-v7a/libsgxdataso.version.so` |
| manifest review surface | 58 项 uses-permission、约 400 个组件、约 79 个 `exported=true` |
| permission tool deviation | `apkanalyzer manifest permissions` 退出 `1`（内部 `aapt dump badging` 返回 1）；改用 `aapt2 dump permissions`，退出 `0` 并解析 58 项 |
| Defender | 退出码 `0`，未发现威胁 |

Defender 版本为 `4.18.26080.3-0`，引擎 `1.1.26080.3`，签名 `1.459.49.0`。扫描清洁不是
来源、signer 身份或 ABI 兼容性证明。权限/组件数量也不是恶意判定，但在来源身份未锚定时
属于必须保留的人工审查风险。

结构化原始证据位于 `static-20260904/` 的 `static-summary.json`、
`certificate-summary.json`、`zip-stream-integrity.json`、`defender-report.json`、
`tool-inventory.json` 和 `decision.json`。

关键附件不可变索引：

| Attachment | observed/mtime UTC | SHA-256 |
| --- | --- | --- |
| `decision.json` | `2026-09-04T15:37:23Z` | `FBD37A4F75F9EB20CCEC28E25262F2B53B12DF37B8FD6CF00B0F8D550720C544` |
| `certificate-summary.json` | `2026-09-04T15:43:40Z` | `3C6C6992D61ED2D9684832883E6CEF3F70D1396FCCF76DA789577AC42FFBAF97` |
| `zip-stream-integrity.json` | `2026-09-04T15:43:16Z` | `27782788CAEEFCF1B572C31C094C8A768EC34BE565EF6993A46FA118F8362D76` |
| `defender-report.json` | `2026-09-04T15:37:23Z` | `8A4AE956ACB9FC553700145017CAE7847E7115A6B49CA2C3D7F9EF7DB3699EA8` |
| `static-summary.json` | `2026-09-04T15:36:52Z` | `0C116B97429FB1EE410F2F2BFC2718B8BE5A611DE24987FBFB897674FDE592FE` |
| `tool-inventory.json` | `2026-09-04T15:36:45Z` | `981673991BC5A87701C318E5346F88647AE1D1080660313E6E6DC863AB5320A9` |

## 5. Decision and acceptance result

本候选的最终状态为：

- stage decision: `rejected`
- reason class: `signature_valid_identity_unanchored`
- `install_allowed=false`

被忽略的 operator-run `decision.json` 使用旧字段 `decision` 保存上述 reason class；本
checkpoint 是规范化结果。任何消费者都必须按 `stage decision` 与 `reason class` 分字段，
不能把 `signature_valid_identity_unanchored` 当成可安装状态。

ZIP 可读、MD5 一致、v2 签名数学有效和 Defender clean 均不能抵消以下阻断项：

1. 候选 URL 未由应用宝页面的 `cn.damai` 下载字段直接锚定；
2. signer 指纹没有独立可信基线；
3. APK 仅含 `armeabi-v7a`，目标 x86_64/现有 arm64 转译路径无法证明兼容；
4. 4 KB 与 16 KB `zipalign` 均失败；
5. 权限和 exported 组件面仍需在可信工件上人工复核。

因此没有向 entity5 或任何其他设备发送 `adb install`，没有启动真实大麦 App，也没有把
工件加入项目运行时。用户已经批准来源研究以及负责后续人工登录，但该批准不能改变本次
fail-closed 静态结论。

## 6. Deviations and process cleanup

- 第一次长内联下载命令在启动前因 PowerShell 转义策略被拒绝，未发出请求；随后改用隔离
  的一次性脚本完成有界下载。脚本和输出仍只在 `.runtime`。
- 下载脚本先校验响应、content type 和长度并将 `.part` 原子改名为 final，再计算 final 的
  SHA-256/MD5；此前“哈希通过后才改名”的表述不符合实际顺序，现已更正。final 文件从未
  被执行或安装，且 M14 在哈希及全部静态检查完成前始终拒绝安装。
- 一次用于确认设备为空的 `adb devices -l` 在 ADB server 未运行时自动启动显式 SDK
  `adb.exe` daemon（PID `12208`，loopback `127.0.0.1:5037`）。它没有启动 AVD 或 App，
  已用同一 SDK 的 `adb kill-server` 清理。
- checkpoint 收尾复核为：无 adb/emulator/qemu 进程，无 5037 或模拟器监听；设备列表为空。
  该收尾状态只代表本次复核时间点，后续设备操作仍需重新发现现场。

## 7. Risks, rollback, and next gate

本次没有生产代码、依赖或设备变更。文档回滚只能追加更正，不删除本 checkpoint 或重写
Git 历史。APK 是外部闭源工件；若要清理，必须先核对并单独批准精确的
`.runtime/apk-evaluation-20260903/` 目标，不得删除源码、AVD 数据或按名称批量清理。

重新进入安装评估至少需要：

1. 从官方设备/官方商店导出或由页面直接提供可验证下载链的 APK；
2. 提供不含账号信息的 SHA-256 和 `apksigner` 证据，用独立可信材料锚定 signer；
3. 说明目标 ABI/转译与对齐要求，并重新通过 M14；
4. M14 达到 `install_eligible` 后，另立设备 checkpoint 并再次取得 entity5 安装批准。

任何后续真实登录、验证码、页面点击、票档、下单和支付仍由用户人工完成。若无法补齐这些
证据，APK 线保持 `rejected`；项目可继续进行彼此独立的人工 Console/Tauri 签收，之后按
既定顺序评估 SQLite，系统通知策略最后单独讨论。
