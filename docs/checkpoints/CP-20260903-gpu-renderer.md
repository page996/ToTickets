# Checkpoint: GPU renderer repair and acceleration evaluation

checkpoint_id: `CP-20260903-gpu-renderer`
created_at_utc: `2026-09-03T11:05:00Z`
status: `verified_with_gap`
base_git_commit: `e4ba2a3e2d771833b7646e0cf0f5564f594dddf0`

## Scope and decision

用户已授权修复或安装 software renderer，并要求设计 GPU 加速以改善画面流畅度；同时明确
暂不改造 `entity4`，先确认低资源实例能稳定运行受控测试 App/脚本。本阶段只处理目标宿主机
Android Emulator 的图形后端评估和可回滚的 SDK 组件维护，不安装真实大麦 APK，不登录、不输入、
不抓包、不调用私有接口，不启用项目 helper/provider。

低资源候选固定为 `-lowram -cores 2 -memory 2048`；GPU 模式作为独立变量比较：
`host`（优先使用宿主 NVIDIA GPU）、`swiftshader_indirect`/Vulkan SwiftShader、
`software`（OpenGL software）及其实际 fallback。每次只运行 `entity3`，保留
`ticket_test_1` 在线，端口使用 loopback `5558/5559`。

## Affected modules and ownership

- `M11-host-readiness`：记录 GPU/renderer 组件发现、版本/hash、资源与流畅度观测；不拥有 SDK
  安装目录生命周期。
- `M7-adapter-layer`：只记录 operator-run ADB/Emulator 健康、画面元数据和脚本 smoke；不提供
  自动输入。
- `M10-config-supply-chain`：记录 SDK package provenance、许可证、回滚和 checkpoint；不把
  主机 SDK 路径写入运行时代码。

## Installation and safety boundary

- 先只读确认已安装 `emulator` package、renderer DLL、版本和 SHA-256；若需 `sdkmanager`
  安装/重装，必须使用用户已安装的 Android SDK 工具并记录包版本、来源、许可证、变更前后
  hash 和回滚方式。
- 不复制 DLL 到项目或系统目录，不覆盖用户 AVD 数据；安装仅针对 Android SDK 的原目录，
  且开始前确认没有运行中的 Emulator。若无法安全回滚，停止在评估阶段并报告。
- 项目 `system-helper-manifest.v1` 继续为空；SDK renderer 是宿主依赖，不获得 ADB 输入、
  登录、验证码、购票或批量操作能力。

## Test contract and guards

- 每个 GPU 模式记录启动命令、emulator/QEMU PID、effective `hardware-qemu.ini`、renderer
  日志、boot/ADB、QEMU Working/Private、宿主 Free RAM/commit、listener 和退出结果。
- 低资源测试的保护线保持：启动前 Free RAM `>=8 GiB`、commit `<=85%`；观察中 `<6 GiB`
  或 `>90%` 禁止扩展，`<4 GiB`、`>=95%`、ADB 断连、黑屏或 WER 时只停止新增 serial。
- App/脚本稳定性只针对仓库内 mock/synthetic fixture 或 Android 系统离线 smoke；真实大麦
  App 的登录、验证码、页面操作和购票始终人工完成。

## Decision gate

只有 renderer 组件完整、GPU 模式在固定窗口中 boot/画面/ADB 稳定且资源预算可解释，才将其
写入后续低资源 profile 的候选输入；任何 fallback、缺失 DLL 或性能异常都保留为风险，不更新
`provider-manifests.ts`、`safe_instances`、`max_devices` 或部署默认值。之后先做人工 Console/Tauri
验收，再进入 SQLite，系统通知策略最后讨论。

## Result append: 2026-09-03T11:38:19Z

### Renderer provenance and installation decision

- 只读 `sdkmanager --list_installed` 显示项目外部宿主 SDK 已安装 `emulator 37.1.11`、
  `platform-tools 37.0.1`、Android 37 Google APIs `x86_64` system image；Emulator
  `source.properties` 的 `Pkg.BuildId` 为 `15917651`。
- 已存在且可被 Emulator 选择的 software/Vulkan 组件为
  `emulator/lib64/vulkan/vk_swiftshader.dll`（SHA-256
  `850455F779F215E38E4F065941C638F0ED25F59CEDE59BAEC9001EFD302A6BAE`）、
  `libvulkan_lvp.dll`（`95052006791C91DA2BA6D4B7694E1B19A2D74FD55CDF171FDBEBB21111B3187D`）和
  `vk_swiftshader_icd.json`（`A3749D1EDD6F36D06920D6C35EAB292C99B90A79B39A98250896D15FF3CE0B1C`）。
  GLES SwiftShader 目录也包含 `libEGL.dll`、`libGLESv2.dll` 和 `libGLES_CM.dll`。
- 旧式 `opengl32sw.dll` 在 Emulator 安装目录中不存在；因此 `-gpu software` 的
  `opengl32sw` 加载仍是已知缺口，不能报告为 GPU-off 或完整 software-OpenGL 修复。
  本轮没有复制 DLL、覆盖 SDK、安装系统组件或重装 Emulator；已有 Vulkan software
  renderer 足以完成可复现 fallback 测试，且重装会无谓扰动在线 `ticket_test_1`。

### Fixed-window observations

两种模式都在独立 `ticket_test_3`/`entity3`（loopback `5558/5559`）运行 300 秒、30 个
样本，`sys.boot_completed=1`，ADB 状态为 `device`，QEMU/Emulator `Responding=True`。
观测报告均保存在被忽略的 `.runtime/r2-gpu-renderer-20260903/`：

| 模式 | 运行时 renderer 证据 | Free RAM 最低 | Commit 范围 | QEMU Working | QEMU Private |
| --- | --- | ---: | ---: | ---: | ---: |
| `-gpu host` | RTX 5080；Vulkan 1.4.351；NVIDIA OpenGL ES translator | 11.826 GiB | 86.44--87.67% | 2.762--2.882 GiB | 3.508--3.560 GiB |
| `-gpu swiftshader_indirect` | SwiftShader Device (LLVM 10.0.0)；OpenGL ES SwiftShader 4.0.0.1 | 11.252 GiB | 86.82--88.49% | 3.078--3.135 GiB | 3.622--3.661 GiB |

对应文件为 `ticket_test_3-host-5m.json`、`ticket_test_3-swiftshader-5m.json` 及同目录
stdout 日志。两种模式各完成 6 个系统 Settings 启动/截图/内存检查周期，截图非空且
健康断言均通过：host 最小截图 214854 bytes，SwiftShader 最小截图 213374 bytes；
两个 smoke 报告的 `InputCommandsUsed` 均为 `false`。这些是系统 App 的离线观察，仓库
没有真实大麦 APK，不能替代真实 App 兼容性或人工购票验收。

### Selection and release gate

- `host` 是本机有 NVIDIA GPU 时的流畅度候选；`swiftshader_indirect` 是不依赖宿主
  GPU 型号的可复现 software fallback。两者均通过本窗口的 boot/ADB/截图 smoke，但
  SwiftShader 的 QEMU Private 高约 0.06--0.11 GiB，且整体 commit 已高于 85% 规划线，
  所以不形成并发容量承诺。
- 低资源参数仍只作为候选输入，不更新 `provider-manifests.ts`、部署默认值、
  `safe_instances`、`max_devices` 或 helper allowlist。下一门槛是第二个低资源 writable
  clone 的固定窗口、I/O/温度/按进程 GPU 归因和受保护 ramp；真实 APK 需单独提供合法、
  无敏感信息的测试包或建立 test-only mock APK 模块。

### Cleanup evidence and current state

- 观察结束后仅对已核对命令行的 `emulator-5558` 执行
  `adb -s emulator-5558 emu kill`，返回 `OK: killing emulator, bye bye`；随后确认
  ticket_test_3 的 Emulator/QEMU 进程和 `5558/5559` listener 消失，ADB 只剩
  `emulator-5554`。
- `entity3` 结束时留下的零字节 `multiinstance.lock` 在确认无活动 PID/端口后改名为
  `multiinstance.lock.stale-20260903-run4`（可恢复归档）；没有删除镜像、数据或旧的
  stale 归档。`entity1` 的活动锁仍绑定 QEMU PID `21008`，未被修改；`entity2`、
  `entity4` 未被启动或改造。
- 当前现场复核：`ticket_test_1`/`emulator-5554` 为 `device`、boot=1，QEMU/Emulator
  PID `21008/39288`，监听仅为 loopback `5554/5555`；主机可用物理内存约 14.4 GiB、
  commit 约 76.2%。项目 API/Vite/Tauri/helper/provider 仍未启动。

本 checkpoint 的结论为 `verified_with_gap`：renderer 组件和两个候选后端已实测可用，
但 legacy `opengl32sw.dll` 缺口、GPU/I/O 按进程归因、真实 APK 兼容性、人工 Console/Tauri
验收和低资源并发 ramp 尚未闭合。

### Documentation synchronization

本结果已索引到 `docs/12-final-release-audit.md`、`docs/07-implementation-roadmap.md` 和
`docs/modules/api-host-readiness.md`；三处均保留历史时点段落，只追加当前 renderer 证据和
未完成门槛，没有改写发布状态或运行时默认值。

### Project gate revalidation

- 使用动态 loopback 注入 `CONSOLE_TEST_API_BASE_URL`/`CONSOLE_TEST_EVENTS_URL` 后，
  `scripts/pnpm.ps1 test` 通过：API `19 suites/203 tests`、Console `9 files/81 tests`；
  未注入时的 fail-closed 拒绝按设计保留。
- `scripts/pnpm.ps1 typecheck`、`scripts/pnpm.ps1 build`、
  `scripts/pnpm.ps1 test:load:mock`、`scripts/check-compliance.ps1`、
  `scripts/generate-sbom.ps1 -Check`、Rust `fmt/check/clippy`（在 Tauri crate 目录按
  项目 wrapper 文档执行）均通过。一次从仓库根目录直接执行 Rust wrapper 因缺少根
  `Cargo.toml` 退出，改用显式 crate 工作目录后通过；没有修改源码或锁文件。
- 注入动态 loopback 配置后 `scripts/tauri.ps1 build --no-bundle` 通过；当前 release
  executable `apps/console/src-tauri/target/release/human-assist-console.exe` 的
  SHA-256 为 `A00419BFBC175C42CCF7ACCB5379358DA7C1BB21C63035061B5BE3FC058F365C`。
  该哈希仅代表本次构建时间点，SBOM 未改变，未启动 Tauri 窗口或项目服务。
