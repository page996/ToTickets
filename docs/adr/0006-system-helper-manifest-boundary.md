# ADR-0006：系统 helper 白名单与默认拒绝边界

- 状态：已采纳（仅策略与校验；未启用 helper）
- 日期：2026-09-02

## 背景

宿主机预检需要读取 Android SDK/AVD 等外部工具的版本和资源状态，但把任意系统命令、
PATH 搜索或未审计的子进程接入 API 会绕过模块边界、扩大设备输入能力，并使不同宿主机
无法复现。项目还必须为后续二次开发保留可撤销的 helper 介入空间。

## 决策

- 引入版本化 `system-helper-manifest.v1`。manifest 只描述可批准的 helper 条目，默认
  `config/system-helper-manifest.v1.json` 为 `entries=[]`，即 deny by default。
- 每个条目必须提供精确版本、SHA-256、来源 URL、许可证/维护状态、显式路径引用、目的、
  allow/deny 能力、符号化操作、环境变量 allowlist、无网络/无写入数据策略、资源上限、
  生命周期、审计 checkpoint 和撤销 owner。
- `apps/api/src/helpers/helper-manifest.ts` 只做纯解析和 activation plan 校验，不启动
  进程、不解析 PATH、不返回绝对路径；只有 `approved` 条目且路径引用、版本、hash、操作
  和环境变量全部匹配时才生成 `execution=not_performed` 的计划。
- 自动登录、验证码、凭据、OCR/点击、批量输入、选票、下单、支付、私有接口、APK 安装、
  外部网络和风控规避能力永远在 deny 集合中，不能通过 manifest 授权。
- ADB、emulator、scrcpy 的实际条目、完整 hash 和用户批准路径必须在目标宿主机重新采集，
  另建 R2 checkpoint 后才能进入 provider-host；当前 host probe 仍只读 planning。

## 备选方案

- 直接调用系统 PATH/注册表：不可接受，无法审计且违反跨宿主机可复现约束。
- 引入 Ajv 等 JSON Schema runtime：暂不采用，会增加依赖、锁文件和 SBOM 变更；当前纯
  TypeScript parser 足以覆盖策略门禁，后续如需完整 schema engine 另行审批。
- 将 helper 条目写入 API 数据库：不采用；manifest 是版本化配置，运行时状态和审计由各自
  模块拥有，避免共享表结构。

## 后果

- 可以在不执行外部命令的情况下对 helper 条件进行单元/负向测试，并为未来 provider host
  保留稳定、可撤销的入口。
- 默认配置不会发现或启用本机 Android 工具；每台目标宿主机必须完成 provenance/hash/
  许可证和人工批准流程。
- 当前仍没有真实 provider 执行器或 mock APK；Gate C 只能在后续门槛明确后进行。

## 证据

- Schema：`config/system-helper-manifest.schema.json`
- 默认配置：`config/system-helper-manifest.v1.json`
- 纯策略模块：`apps/api/src/helpers/helper-manifest.ts`
- 负向测试：`apps/api/test/helper-manifest.spec.ts`
- 宿主机快照：`docs/checkpoints/CP-20260902-host-preflight.md`
