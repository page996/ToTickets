# Checkpoint: host preflight and helper policy baseline

checkpoint_id: `CP-20260902-host-preflight`
created_at_utc: `2026-09-02T12:33:05Z`
status: `verified_with_gap`
base_git_commit: `b93e0d8`

## Scope and non-goals

本阶段把当前目标宿主机的只读检查结果追加为独立证据，并建立
`system-helper-manifest.v1` 的默认拒绝策略、schema 和纯校验入口。不会启动模拟器、
安装或授权 Android 加速驱动，不连接真实设备，不安装 APK，不登录大麦，不访问外部
网络，不改变当前 loopback exposure，也不新增运行时依赖。

本阶段不把当前机器的路径写入运行时代码或默认配置。宿主机绝对路径只出现在本 checkpoint
的证据表中；版本化 helper manifest 只允许显式运行时路径引用，默认条目为空。

## Affected modules and module books

- `M11-host-readiness` / `docs/modules/api-host-readiness.md`：追加当前宿主机快照和 Gate C
  缺口；不改变 `host-probe.v1` wire contract。
- `M13-system-helper-policy` / `docs/modules/system-helper-manifest.md`：新增 manifest
  schema、默认拒绝清单、激活授权纯函数和负向测试。
- `M10-config-supply-chain`：记录 helper provenance、锁定路径引用和不新增依赖的决定。

## Read-only host evidence (2026-09-02)

以下数值来自本机显式检查，不外推到其他宿主机：

| 项目 | 观察结果 | 证据/限制 |
| --- | --- | --- |
| CPU | AMD Ryzen 9 7945HX；16 核/32 线程 | `Win32_Processor` |
| 内存 | 总计约 31.22 GiB；检查时可用值由系统动态变化 | `Win32_ComputerSystem`/`os`；不是预留承诺 |
| 磁盘 | C: 约 76.99 GiB 可用；E: 约 261.24 GiB 可用 | `Win32_LogicalDisk`；E: 作为用户选择的数据卷候选 |
| GPU | NVIDIA GeForce RTX 5080 Laptop；`nvidia-smi` 总显存 16303 MiB、可用 14239 MiB；AMD Radeon 610M 亦存在 | `nvidia-smi`/WMI；需在目标 profile 启用 GPU 后复测 |
| 虚拟化 | 固件虚拟化、SLAT、VM monitor extensions 为 true；`HypervisorPresent=False` | Windows 可选功能查询因权限不足未能确认 WHPX/Hyper-V |
| 加速 | `emulator -accel-check` 返回 code 6：Android Emulator hypervisor driver 未安装 | 不能据此授权 Gate C |
| AVD | `ticket_test_1`；Android 37 Google APIs `x86_64`；`medium_phone`；4 vCPU、2 GiB RAM、10 GiB data、512 MiB SD | `avdmanager list avd` 与用户选择的 E: 数据目录；当前 `hw.gpu.enabled=no` |
| SDK/ADB | Android Emulator `37.1.11.0` build `15917651`；ADB `37.0.1-15733141` | 官方 SDK 文件；实际 helper 尚未登记/启用 |
| 工具 hash | `adb.exe` SHA-256 `B4A6B45570284652CCCF7B46258B29E653538904359A58FD4931CF3EF286B3F`；`emulator.exe` SHA-256 `DEDE05844D17902A7C74F2CEE2BBE97EC9AFAAF22EBC35A7CDC6D7C1EAA0B9DD`；`avdmanager.bat` SHA-256 `2307299B666C61610D1F35B36EA05C2D24C43DDEC33E755D40A52797A21D2AA1` | 目标宿主机批准条目必须重新采集并使用规范化小写 hash |
| Java | 用户安装的 Microsoft OpenJDK `17.0.20.1`；Android Studio bundled JBR `25.0.2` 也可运行 `avdmanager` | 当前 shell 未继承 `JAVA_HOME`；运行时必须由显式项目/用户选择提供 |
| 网络/设备状态 | 无 emulator 进程；无 ADB server 及 5037 listener；无项目 API/Vite/Tauri 进程 | 清理后复核 |

本机工具路径（仅证据，不是项目默认值）：

- ADB：`C:\Users\Siyu_Zhu\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- Emulator：`C:\Users\Siyu_Zhu\AppData\Local\Android\Sdk\emulator\emulator.exe`
- AVD manager：`C:\Users\Siyu_Zhu\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\avdmanager.bat`
- AVD metadata：`C:\Users\Siyu_Zhu\.android\avd\ticket_test_1.ini`，数据目录：`E:\ticket-test\entity1`

这些路径不可复制到源码、manifest 或部署脚本；目标环境必须通过显式配置/用户选择重新
解析，并以 `path_ref` 关联 helper 条目。

## Capacity estimate and deployment recommendation

按当前 `android-emulator-avd` 规划 profile（每实例 4 threads、4096 MiB、16 GiB data、
1024 MiB VRAM）和本机采样资源计算：

| 资源 | 估算上限 | 说明 |
| --- | ---: | --- |
| CPU | 7 | `floor((32 - 2) / 4)`，预留 2 threads |
| 可用内存 | 3 | 以约 16.7 GiB 采样可用内存计，预留 4096 MiB |
| E 盘 | 15 | `floor((261.24 - 20) / 16)`，预留 20 GiB |
| GPU/VRAM | unknown | 项目无副作用 probe 未确认 AVD GPU backend |
| 保守 safe_instances | 3 | 取已知上限最小值；`confidence=unknown`，不是授权数 |
| effective/startup | 3 / 2 | 受控制面上限和启动突发上限约束 |

用户 AVD 当前实际配置为 2 GiB RAM、10 GiB data、GPU disabled，与上述规划 profile 不同；
不能直接套用 `safe_instances=3`。建议部署预算先按规划 profile 预留 CPU 4 threads、内存
4 GiB、数据卷 16 GiB、VRAM 1 GiB/实例和 20 GiB 主机余量，单实例冷启动稳定后再用
1 -> 2 -> 4 ramp test 以实测值替换 profile。若维持当前 2 GiB/10 GiB AVD，应建立独立
profile 并重新测量，不得从静态配置推导购票成功率或并发承诺。

工具文件的完整 hash、绝对路径和命令输出属于本机敏感/易变证据，不进入源码、默认
manifest 或公共 API 响应。上述 hash 只作为本次主机快照；正式 helper 条目必须在目标
宿主机重新采集、核对来源/许可证并由用户明确批准。

## Planned implementation

1. `config/system-helper-manifest.schema.json`：严格 `additionalProperties=false` 的
   `system-helper-manifest.v1` JSON Schema。
2. `config/system-helper-manifest.v1.json`：可提交、默认 `entries=[]` 的 deny-by-default
   manifest；不声明任何可执行 helper。
3. `apps/api/src/helpers/helper-manifest.types.ts` 与 `helper-manifest.ts`：不执行进程的
   parser、策略校验和 activation grant 检查；路径、版本、hash、能力、环境、资源、数据流、
   生命周期和审计字段均由纯函数验证。
4. `apps/api/test/helper-manifest.spec.ts`：正常、未知字段、危险能力、路径/hash/版本不匹配、
   未批准状态、秘密环境变量和外部网络等负向测试。

## Deviation and cleanup

预检期间为确认 ADB 版本曾运行 `adb devices`，该命令自动启动了临时 ADB server（PID
`34408`，127.0.0.1:5037）。随后使用同一显式 ADB 路径执行 `adb kill-server`，退出码 0；
复核确认 ADB 进程数和 5037 listener 均为 0。后续预检入口禁止调用会启动 daemon 的命令，
并把 `adb devices` 视为需要单独 R2 批准的动作。

## Decisions, risks and approvals

- 以官方 Android Emulator/AVD 为当前 Gate C 候选；不把任何闭源模拟器或串流供应商加入
  核心 manifest。
- helper manifest 允许未来进入项目，但默认无条目；本阶段的 approved entry 仍不能触发
  进程执行，必须另建 R2 checkpoint、人工确认和 provider-host 端口。
- 不新增 Ajv、Playwright、Puppeteer 或其他依赖；schema 校验在当前阶段使用无副作用的
  手写纯 TypeScript parser。根级 `ws` phantom dependency 与浏览器 harness 依赖继续作为
  后续独立决策项。
- 真实大麦 APK、登录、验证码、输入、选票、下单、支付和环境/包体检测规避仍被禁止。

## Rollback

删除本阶段新增的 manifest/schema/纯校验模块和文档变更即可恢复到 `b93e0d8`；保留本
checkpoint 和本机证据，不删除或重写历史 checkpoint，不终止无关进程。

## Next gate

完成本阶段本地测试和合规检查后，下一门槛是：管理员在目标宿主机安装/启用 WHPX、Hyper-V
或 Android Emulator Hypervisor Driver，并由用户人工启动 `ticket_test_1` 做单实例观察。
在该门槛前不启动 AVD/ADB helper，不进行 1→2→4 ramp test；任何正式 helper 条目需另行
记录完整 hash、批准路径、资源上限和撤销方式。

## Result append: 2026-09-02T13:15:59Z

`result_status`: `verified_with_gap`

### Implemented files and modules

- 新增 `M13-system-helper-policy`：`apps/api/src/helpers/helper-manifest.types.ts`、
  `helper-manifest.ts`；只解析/授权计划，不执行进程。
- 新增严格 schema 和默认空 allowlist：`config/system-helper-manifest.schema.json`、
  `config/system-helper-manifest.v1.json`。
- 新增 19 项正常/负向测试：`apps/api/test/helper-manifest.spec.ts`。
- 新增 ADR/模块书并更新模块索引、连接矩阵、依赖说明、路线图、发布历史说明和 host
  deployment 文档；保留 2026-09-01 的历史 AVD 空快照并追加 2026-09-02 当前事实。
- 未修改 `package.json`、`pnpm-lock.yaml`、Cargo manifest/lock 或 SBOM artifact；未新增依赖。

### Verification evidence

- `scripts/pnpm.ps1 --filter @ticketing-console/api test -- helper-manifest.spec.ts`：19/19 通过。
- `scripts/pnpm.ps1 --filter @ticketing-console/api test`：API 19 suites/202 tests 通过。
- 注入动态同端口 loopback `CONSOLE_TEST_API_BASE_URL`（带 `/api/v1`）与
  `CONSOLE_TEST_EVENTS_URL`（带 `/api/v1/events`）后运行 `scripts/pnpm.ps1 test`：
  API 19 suites/202 tests、Console 9 files/81 tests 全部通过。
- `scripts/pnpm.ps1 typecheck`：API/Console 通过。
- `scripts/pnpm.ps1 build`：Nest/Vite 通过；只生成被忽略的 dist 产物。
- `scripts/check-compliance.ps1`：124 runtime/command files、3 Node manifests、1 Rust
  manifest、1 configuration template；无违规。
- `scripts/generate-sbom.ps1 -Check`：现有 SBOM 为 current。
- manifest/schema JSON 解析和 `git diff --check` 通过。

### Test deviations

第一次 workspace test 未注入 Console test endpoints，按设计因缺少
`CONSOLE_TEST_API_BASE_URL`/`CONSOLE_TEST_EVENTS_URL` fail closed。第二次注入了动态
loopback host/port但漏掉版本化路径，runtime contract 再次按设计拒绝。第三次使用同端口
且完整 `/api/v1`/`/api/v1/events` 路径后全部通过。三次均未启动服务或访问网络；失败属于
测试配置证据，不是生产代码回归。

静态合规首次把 schema 的 HTTPS 正则误判为运行时 URL；改为语义等价的字符类正则后通过，
没有放宽 source URL 必须为 credential-free HTTPS 的 parser 规则。

### Runtime and cleanup

本阶段未启动模拟器、API、Vite、Tauri 或浏览器。只读预检中一次 `adb devices` 自动启动
ADB server，已使用同一明确路径的 `adb kill-server` 关闭；最终无 adb/emulator 进程和
5037 listener。仅保留 Codex 自身 node 进程，未触碰无关进程。

### Remaining gaps and next gate

- manifest 默认 `entries=[]`；ADB/emulator 当前只是候选证据，没有 approved 条目，也没有
  provider-host execution port。
- Android Emulator hypervisor driver 未安装，WHPX/Hyper-V 状态需管理员确认；AVD 未启动。
- 当前仓库没有 mock APK。用户需决定先做空系统 AVD smoke，还是先建立独立 test-only
  mock APK；两者均需新的模块书/checkpoint。
- `safe_instances=3` 只是规划 profile 的 `confidence=unknown` 估算；当前 AVD 的
  2 GiB/10 GiB/GPU disabled 配置与 profile 不一致，必须以单实例和 1→2→4 ramp 实测替换。
- 根 load harness 的 `ws` phantom dependency、裸 `node` 入口和正式浏览器 test-only
  harness 仍是独立依赖决策，不在本 checkpoint 修改。

本 checkpoint 的策略/证据阶段已完成；真实 helper/AVD Gate C 保持 blocked，不能把
`verified_with_gap` 解读为设备或真实平台验收通过。

## Result append: 2026-09-02T14:11:54Z (R1 revalidation)

`result_status`: `verified_with_gap`

### Current verification evidence

- `scripts/pnpm.ps1 --filter @ticketing-console/api test -- helper-manifest.spec.ts`：20/20
  通过；此前段落的 19/19 是 helper 测试新增前的计数。
- 使用同一动态 loopback 端口并注入完整版本化路径后运行
  `scripts/pnpm.ps1 test`：API 19 suites/203 tests、Console 9 files/81 tests 全部通过。
- `scripts/pnpm.ps1 typecheck`、`scripts/pnpm.ps1 build`、`scripts/pnpm.ps1 test:load:mock`：
  全部通过；仅更新被忽略的 `dist/`/`.runtime` 产物。
- `scripts/check-compliance.ps1`：通过（124 runtime/command files、3 Node manifests、
  1 Rust manifest、1 configuration template）；`scripts/check-compliance.test.ps1` 与
  `scripts/tests/check-compliance.Tests.ps1` 均通过。
- `scripts/generate-sbom.ps1 -Check`：通过，SBOM 未变化。
- `scripts/cargo.ps1 fmt --manifest-path apps/console/src-tauri/Cargo.toml -- --check`、
  `check --locked`、`clippy --locked --all-targets -- '-D' 'warnings'`：全部通过。
- `scripts/tauri.ps1 build --no-bundle`：第二次使用注入的
  `CONSOLE_API_BASE_URL`/`CONSOLE_EVENTS_URL` 成功；当前 release executable
  SHA-256 为 `B80C0BC65048E5B4E7CF3BF67D2A80D99C31BE48D15F30A1D59AE53FE1CB7EAD`。

### Verification deviation and cleanup

Tauri 第一次尝试只注入了测试变量，wrapper 按设计因缺少
`CONSOLE_API_BASE_URL`/`CONSOLE_EVENTS_URL` fail closed（退出码 1），未覆盖旧可执行文件；
补齐变量后重跑通过。R1 未启动 API/Vite/Tauri 窗口、浏览器、ADB 或 emulator，结束时无
项目服务监听或设备进程；仅保留 Codex 自身进程。上述结果不新增浏览器视觉证据，既有
`CP-20260902-loopback-browser-regression` 仍按其原始时间点解释。

本次复验未修改依赖、锁文件、SBOM 源文件或运行时默认配置。Gate C、真实 helper 条目、
mock APK、根 load harness 的 `ws` 依赖处理和正式浏览器 harness 仍按前述待决事项保留。
