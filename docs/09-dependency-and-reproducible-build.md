# 依赖、隔离环境与可复现构建

## 1. 适用范围

正式应用只包含 NestJS/TypeScript 控制平面和 Tauri + React/TypeScript 桌面控制台。Rust 只用于 Tauri 壳及构建。Python、FastAPI、Electron 和 `pip` 不属于运行时或部署链。

Android SDK Platform-Tools/ADB、scrcpy、模拟器和 Windows 构建组件属于外部 provider/系统前置项，不得因开发机上已经存在就视为项目依赖。引入前必须有可配置发现器、版本和来源记录、许可证/EULA 评估、hash/provenance 以及只读能力验收。

## 2. 当前冻结清单

| 层 | 声明与锁定文件 | 当前状态 |
| --- | --- | --- |
| Node 工具链 | `.node-version`、根 `package.json`、`config/toolchain.lock.json` | Node `24.13.0`、pnpm `11.19.0` 精确冻结 |
| pnpm workspace | `pnpm-workspace.yaml`、根/应用 `package.json`、`pnpm-lock.yaml` | 单一 lockfile，直接依赖全部精确版本 |
| Rust 工具链 | `rust-toolchain.toml`、`config/toolchain.lock.json` | Rust `1.88.0`、minimal profile、`rustfmt`/`clippy`、Windows MSVC x64 target |
| Rust crates | `apps/console/src-tauri/Cargo.toml`、同目录 `Cargo.lock` | 直接 crate 使用 `=x.y.z`，锁文件 version 4 |
| 许可证/用途/SBOM | `docs/dependency-catalog.md`、`sbom/human-ticketing-console.cdx.json` | 直接依赖已逐项核验，开发/构建 SBOM 已生成；传递许可证和运行时专用 SBOM 尚未闭环 |

完整的直接依赖版本、用途、来源、SPDX 表达式、权限面、发布校验值和 Package URL 只维护在 `docs/dependency-catalog.md`，避免两份版本表漂移。

## 3. 项目级隔离工具链

`scripts/bootstrap-toolchain.ps1` 从 `config/toolchain.lock.json` 读取版本、下载源和已记录 hash，将工具安装到仓库忽略的 `.tools/`。脚本不修改用户或系统 PATH。当前 bootstrap 是 Windows x64 实现，并依赖操作系统提供 PowerShell、`curl.exe`、archive 解压能力和 TLS 根证书。

项目命令必须通过 wrapper 运行：

- `scripts/pnpm.ps1` 解析仓库根目录，验证项目 Node/pnpm 文件存在，把其目录置于当前子进程 PATH 最前，并用该 Node 直接执行锁定的 pnpm entrypoint。
- 同一 wrapper 每次都注入由仓库根动态计算的 `--config.store-dir` 和 `--config.cache-dir`：内容寻址 store 位于 `.pnpm-store/`，metadata/tarball cache 位于 `.runtime/pnpm-cache/`。调用方不能覆盖这两个路径，因此不依赖用户目录下的 pnpm cache。
- `scripts/cargo.ps1` 把 `RUSTUP_HOME`、`CARGO_HOME` 指向 `.tools/` 下的项目目录，再调用项目 Cargo proxy；不读取全局 Rust 作为回退。
- `scripts/tauri.ps1` 同样注入项目 Rust home 和 Cargo bin，再通过 `scripts/pnpm.ps1` 启动 console 的受控 Tauri/CSP wrapper；桌面构建不得直接调用系统 `tauri`、`cargo` 或 `pnpm`。

wrapper 只保证被选择的 Node/pnpm/Rust 是项目版本。它仍保留其后的系统 PATH，以便发现 Windows linker 等批准的系统前置项；因此 release provenance 还必须记录实际 MSVC、Windows SDK 和 WebView2 版本。

## 4. pnpm 11 workspace 策略

pnpm 11 的非认证项目设置集中在 `pnpm-workspace.yaml`，`.npmrc` 仅保留未来 registry 认证的注释位置，凭据不得提交。当前设置的工程含义如下：

| 设置 | 当前值 | 约束与影响 |
| --- | --- | --- |
| `catalogMode` | `strict` | 添加依赖时严格执行 catalog 策略；不能用临时版本绕过 manifest 审查 |
| `engineStrict` | `true` | Node/pnpm engine 不匹配即失败 |
| `ignoreScripts` | `true` | 安装期依赖 lifecycle scripts 默认不执行，降低供应链执行面；需要脚本的依赖必须单独审批 |
| `networkConcurrency` | `1` | 降低当前 Windows 安装环境的并发压力；影响速度，不改变解析结果 |
| `nodeLinker` | `hoisted` | 使用 hoisted 布局兼容现有 Nest/Vite/Tauri 工具；代码仍只能导入自己 manifest 声明的依赖 |
| `packageImportMethod` | `copy` | 从 store 复制包内容，避免部署产物依赖 cache 的 hardlink/reflink 语义 |
| `saveExact` | `true` | 新增依赖默认写入精确版本 |
| `sharedWorkspaceLockfile` | `true` | 根 `pnpm-lock.yaml` 是所有 workspace importer 的唯一解析真源 |
| `strictPeerDependencies` | `true` | 缺失或冲突 peer dependency 使安装失败 |
| `verifyStoreIntegrity` | `true` | 从 store 导入前校验内容完整性 |

`minimumReleaseAgeExclude` 当前只列出六个已审批的 NestJS `11.2.2` 包；仓库没有设置 `minimumReleaseAge`，因此该列表本身不构成 release-age 防护。若以后启用等待期，例外必须有单独审批记录，不能把 exclude 列表当作通用允许清单。

`nodeLinker: hoisted` 会让未声明包在物理目录中看起来可见，这是布局副作用，不授予导入权限。合规检查和评审应以 manifest 直接依赖为准，构建必须从空 `node_modules` 复现，以发现 phantom dependency。

### 4.1 Tauri 平台可选二进制的校验与缓存恢复

`@tauri-apps/cli@2.8.4` 在 lockfile 中列出 11 个相同版本的平台可选包；Windows x64 只应物化 `@tauri-apps/cli-win32-x64-msvc@2.8.4`。其 lockfile tarball SRI 为：

```text
sha512-XuvGB4ehBdd7QhMZ9qbj/8icGEatDuBNxyYHbLKsTYh90ggUlPa/AtaqcC1Fo69lGkTmq9BOKrs1aWSi7xDonA==
```

该 SRI 校验下载 tarball。由同一已验证 tarball 解包得到的 `cli.win32-x64-msvc.node` 当前 SHA-256 为 `C20E2691CD7BC6382FD285E18ECF5B38390968D5B9C1D670E6750B17EE1B1EE5`；这是平台载荷的二级核验值，lockfile SRI 仍是解析真源。`packageImportMethod: copy` 表示 `node_modules` 是 store 的独立副本，所以 `pnpm store status` 不能代替已安装载荷核验。

若安装只对该可选包报告 integrity/cache 错误，先停止命令行明确包含本仓库路径的相关进程，确保没有并行 pnpm，再执行最小恢复：

```powershell
$repoRoot = (Resolve-Path -LiteralPath '.').Path
$projectNode = Join-Path $repoRoot '.tools/node/node.exe'
$runtime = ([string](& $projectNode -p "process.platform + '/' + process.arch")).Trim()
if ($runtime -cne 'win32/x64') {
    throw "This recovery pin is for win32/x64, current runtime is $runtime."
}

$recoveryRoot = Join-Path $repoRoot '.runtime/tauri-cli-native-recovery-2.8.4'
$installedPackage = Join-Path $repoRoot 'node_modules/@tauri-apps/cli-win32-x64-msvc'
$quarantinedPackage = Join-Path $recoveryRoot 'previous-installed-package'
if (Test-Path -LiteralPath $recoveryRoot) {
    throw "Recovery directory already exists: $recoveryRoot"
}
New-Item -ItemType Directory -Path $recoveryRoot | Out-Null

& ./scripts/pnpm.ps1 store add --force '@tauri-apps/cli-win32-x64-msvc@2.8.4'
if ($LASTEXITCODE -ne 0) { throw 'Targeted Tauri store refresh failed.' }

if (Test-Path -LiteralPath $installedPackage) {
    Move-Item -LiteralPath $installedPackage -Destination $quarantinedPackage
}
& ./scripts/pnpm.ps1 --filter '@ticketing-console/console' install --frozen-lockfile --offline
if ($LASTEXITCODE -ne 0) {
    throw 'Offline relink failed; preserve the quarantine for rollback.'
}

$nativePayload = Join-Path $installedPackage 'cli.win32-x64-msvc.node'
$actualNativeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nativePayload).Hash
if ($actualNativeHash -cne 'C20E2691CD7BC6382FD285E18ECF5B38390968D5B9C1D670E6750B17EE1B1EE5') {
    throw 'Installed Tauri native payload differs from the verified release tarball.'
}
```

如果 offline relink 仅因其他已锁依赖未预热，可在保持 `--frozen-lockfile`、console filter 和项目本地 cache 的前提下改用 `--prefer-offline`。禁止用 `pnpm install --force`：pnpm 会把不匹配当前 OS/CPU 的 optional dependencies 一并安装。也不得手工删除 `.pnpm-store/v11` 内部内容或照搬 npm 的“删除整个 node_modules/package-lock”建议；恢复失败时把精确隔离的旧包移动回原路径。

### 4.2 Tauri 的传递版本锁定

`Cargo.toml` 的 `tauri = "=2.8.5"` 只精确约束直接 crate。该版本对 runtime crate 使用兼容范围，因此当前 `Cargo.lock` 实际固定：

```text
tauri = 2.8.5
tauri-runtime = 2.9.2
tauri-runtime-wry = 2.9.3
wry = 0.53.4
```

这不是漂移：`Cargo.lock` 同时锁定每个传递 crate 的精确版本、registry source 和 archive checksum。验证必须使用 `cargo ... --locked`；`--frozen` 额外要求 offline。已有锁文件时不得常规执行 `generate-lockfile`，否则即使直接 `tauri` 版本不变，也可能重新选择更新的兼容传递版本。crate checksum 校验下载 archive，不校验 `target/` 中的编译产物。

Node 侧同理：直接 `@tauri-apps/cli@2.8.4`、其各平台 optional package 和各自 SRI 都由 `pnpm-lock.yaml` 固定；生成的 SBOM 保留全部平台组件，并以 `target-os`/`target-cpu` 属性区分。

`apps/console/scripts/run-tauri-with-config.mjs` 必须解析并执行 `@tauri-apps/cli/tauri.js`。包默认导出 `main.js` 只暴露 Node API；直接用默认导出启动会在没有执行构建的情况下正常退出，因此不能以退出码 0 单独作为 Tauri 构建证据。验收必须同时确认 release 可执行文件生成或更新时间戳变化。

## 5. 冻结安装和验证流程

新机器或干净工作目录使用仓库相对命令；任何运行时地址、输出位置和外部工具位置都由配置或环境变量提供：

```powershell
& ./scripts/bootstrap-toolchain.ps1
& ./scripts/pnpm.ps1 install --frozen-lockfile
& ./scripts/tests/check-compliance.Tests.ps1
& ./scripts/tests/pnpm-wrapper.Tests.ps1
& ./scripts/tests/generate-sbom.Tests.ps1
& ./scripts/generate-sbom.ps1 -Check
& ./scripts/check-compliance.ps1
& ./scripts/pnpm.ps1 typecheck
& ./scripts/pnpm.ps1 test
& ./scripts/pnpm.ps1 build
```

Rust/Tauri 验证从 crate 目录执行，并强制消费已有锁文件：

```powershell
Push-Location apps/console/src-tauri
& ../../../scripts/cargo.ps1 fmt --check
& ../../../scripts/cargo.ps1 clippy --locked --all-targets '--' -D warnings
& ../../../scripts/cargo.ps1 check --locked
Pop-Location
```

PowerShell 会在某些调用形式中消费未加引号的独立 `--`；这里必须按示例把它作为字符串传给 Cargo。注入已校验的控制台端点环境变量后，桌面壳从仓库根验证：

```powershell
& ./scripts/tauri.ps1 build --no-bundle
```

该入口生成配置派生的 CSP overlay，并只构建 release 可执行文件；当前 `bundle.active` 为 false，不生成签名安装包。

生成或修改 `Cargo.lock` 是依赖变更，不属于普通验证步骤；需要明确审批、registry 元数据复核和目录更新。缓存已完整预热后，可在隔离验收中增加 pnpm/Cargo offline 模式，证明构建没有未声明下载。

安装目录不是锁定证据。尤其在安装中断或 Windows 文件占用后，必须把不完整目录隔离到项目 `.runtime/` 再从锁文件重建，不能根据现有 `node_modules` 反向修改 manifest/lockfile。`.runtime/`、`.tools/`、`.pnpm-store/` 和 `node_modules/` 都不得进入发布源码清单。

## 6. 完整性和可复现性边界

已经实现：

- Node archive 和 rustup-init 下载在落盘后执行 SHA-256 校验，失败即拒绝安装。
- npm 直接/传递解析由 `pnpm-lock.yaml` 冻结；直接包的 registry SHA-512 SRI 已与锁文件核对。
- crate 解析和 registry checksum 由 `Cargo.lock` 冻结；直接 crate checksum 已与 crates.io 元数据核对。
- pnpm wrapper 总是优先使用项目工具并注入项目本地 store/cache；Cargo wrapper 总是注入项目 Rust home。
- 安装期 dependency scripts 默认关闭，版本范围和 peer 漂移由 workspace 策略拒绝。

尚未实现，因此不能声称 bit-for-bit 可复现：

- pnpm 工具包的官方 SRI 已写入依赖目录，但 `config/toolchain.lock.json` 和 bootstrap 尚未强制校验它。
- `channel_manifest_sha256` 已记录但 bootstrap 尚未核验；rustup-init 语义版本和各 Rust component artifact hash 未单独锁定。
- Windows linker、SDK、WebView2、Tauri installer backend 的实际版本尚未进入 build provenance。
- Vite/Tauri/Nest 产物尚未定义时间戳、文件排序、绝对调试路径等归一化规则，当前目标是 dependency-reproducible，不是 bit-identical。
- 尚无提交的 `build-info.json`、构建目录 hash 或两次干净构建比较结果。

这些缺口必须保持为显式发布门禁，不能用“本机成功构建”替代。

## 7. SBOM 与许可证流程

`scripts/generate-sbom.ps1` 使用 PowerShell/.NET 标准库直接解析 pnpm lockfile v9 和 Cargo lockfile v4，不新增 npm、crate 或全局工具依赖。它还读取两个应用 manifest 与 `docs/dependency-catalog.md`，给直接依赖补充 scope、用途和 SPDX 表达式。未知 lockfile 版本、未解析依赖边、重复 Package URL、目录缺项或图中悬空引用都会使生成失败。

版本化输出 `sbom/human-ticketing-console.cdx.json` 是 CycloneDX 1.6 开发/构建视角：

- 679 个 pnpm package、462 个 Cargo package 和 2 个 npm workspace 应用，共 1,143 个组件；workspace 根组件位于 metadata。
- 1,144 个依赖节点，覆盖 pnpm peer variant 合并后的依赖边、optional dependencies、Cargo 传递边和 workspace 连接。
- npm SRI 转换为 CycloneDX SHA hash，Cargo checksum 原样记录；metadata 记录两份 lockfile 的 SHA-256。
- Tauri 平台可选二进制保留 OS/CPU/libc 属性；关键 Rust runtime 版本由测试断言。
- 为保证相同输入逐字节一致，省略随机 serial number 和生成时间，并显式记录该确定性策略。
- 直接依赖许可证来自已核验目录；传递组件写入 `license-status=unresolved-transitive`，不是虚构的许可证结论。

依赖目录或锁文件经批准变化后重新生成，再检查版本化 artifact：

```powershell
& ./scripts/generate-sbom.ps1
& ./scripts/tests/generate-sbom.Tests.ps1
& ./scripts/generate-sbom.ps1 -Check
```

自测试执行两次临时生成并比较文件 hash，同时校验组件计数、唯一引用、依赖闭包、lockfile hash、直接许可证以及 Tauri 平台/传递版本。当前 artifact 还使用 PowerShell `Test-Json` 对官方 CycloneDX 1.6 JSON Schema 验证通过；需要复验时由调用方提供已核验的 schema 文件路径：

```powershell
$schemaPath = (Resolve-Path -LiteralPath $env:CYCLONEDX_SCHEMA_PATH).Path
$sbomJson = Get-Content -Raw -LiteralPath sbom/human-ticketing-console.cdx.json
$sbomJson | Test-Json -SchemaFile $schemaPath
```

正式发布仍需补齐：只含 NestJS 部署闭包和 Windows 安装包实际携带 JS/Rust/native 组件的运行时 SBOM；每个传递组件的许可证选择、版权 notice、源码提供义务和维护状态；以及含工具链、OS/架构、配置 schema、锁文件/SBOM hash、构建命令和测试摘要的 provenance。不得通过临时 `npx`、`cargo install` 或在线服务生成未锁定的发布证据。

## 8. 源码部署与安装包

源码部署从干净 checkout 开始，先 bootstrap 项目工具链，再按第 5 节冻结安装和验证，最后使用通过 schema 二次校验的用户配置启动。当前 `runtime-config.v3` 还会在运行时把监听地址限制为字面量 IPv4 `127.0.0.0/8` 或 `::1`；主机名、通配地址和其他 IP 不能作为部署配置。不得复制开发机的 `node_modules`、cache、`.tools` 或运行时配置作为部署方式。

自包含交付由 Tauri 构建 Windows 安装包；它不得捆绑大麦账号、手机号、验证码、Cookie、Token、实名信息、ADB 私钥或支付数据。NestJS 进程的携带/启动方式、端口分配、升级回滚、签名证书和 WebView2 部署模式仍需在打包阶段 ADR 中冻结。Android SDK/模拟器默认外置，由 provider 发现器验证，不随安装包静默安装。

## 9. 依赖变更门禁

新增、升级或删除依赖前，变更说明必须包含用途、精确版本、官方来源、许可证、权限面、替代方案、体积/性能影响、回滚版本和测试结果；同步更新 manifest、锁文件、`docs/dependency-catalog.md`、SBOM 和 provenance schema。

CI/发布验收必须拒绝：lockfile 漂移、未记录直接依赖、许可证未决组件、未审查的 install script、未声明网络下载、系统工具静默回退、配置中的秘密默认值，以及产物中存在 SBOM 未覆盖组件。
