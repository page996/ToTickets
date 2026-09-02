# 系统 Helper Manifest 模块开发书

**module_id**：`M13-system-helper-policy`
**版本**：`system-helper-policy.v1`
**状态**：`active`（策略/校验）；`approved helper` 未启用
**治理**：`partial`
**负责人边界**：配置供应链与 provider-host 连接前的 helper policy owner
**源码边界**：`apps/api/src/helpers/*`、`config/system-helper-manifest*.json`

## 1. 职责与非职责

本模块解析版本化 `system-helper-manifest.v1`，校验 helper provenance、能力、路径引用、
操作、环境、数据流、资源、生命周期、审计和撤销字段，并为未来 provider host 生成不可执行
的 activation plan。默认 manifest 为空，未批准条目 fail closed。

本模块不启动或停止进程，不解析 PATH/注册表，不访问 ADB、模拟器、scrcpy 或网络，不安装
APK，不处理账号/凭据，不发送设备输入，也不拥有 API/Console/部署数据库状态。

## 2. 状态、变量与不变量

| 状态/变量 | owner | 不变量 |
| --- | --- | --- |
| `SystemHelperManifest.entries` | 版本化配置 + parser 返回值 | helper_id 唯一；结果冻结；空列表表示默认拒绝 |
| `SystemHelperEntry.state` | manifest | 只有 `approved` 可生成 plan；`proposed/revoked` 一律拒绝 |
| `artifact.pathRef/version/sha256` | manifest | 路径只能是 `env:`/`project:`/`selection:` opaque ref；hash 为 64 位小写 hex |
| `capabilities` | manifest | allow 只能来自只读安全集合；所有禁止能力必须显式 deny |
| `invocation` | manifest | 操作符号化、环境键 allowlist、网络为 `none`、资源上限有界 |
| `dataPolicy` | manifest | `sensitive_data=deny`；`write_scopes=[]`；读取范围为 project/selection ref |
| activation plan | 纯函数临时值 | 不含实际路径/命令；`execution=not_performed`；带审计 checkpoint |

## 3. 函数与端口

| 入口 | 前置条件 | 后置条件/错误 |
| --- | --- | --- |
| `parseSystemHelperManifest(value)` | 任意 JSON 值；不得假设已通过 schema engine | 返回冻结的 camelCase manifest；未知字段、缺失字段、重复 ID、非法 provenance/能力/资源时抛错 |
| `authorizeHelperActivation(manifest, request)` | manifest 已解析；调用者提供显式 path ref、版本、hash、操作和环境键 | 仅 approved 且全部匹配时返回 `HelperActivationPlan(execution=not_performed)`；否则拒绝 |
| `DEFAULT_SYSTEM_HELPER_MANIFEST` | 编译期常量 | 空 allowlist；不触发任何外部动作 |

当前没有 REST/WebSocket/CloudEvents 或进程端口。未来 provider-host 只能消费 activation plan，
并需另建认证、TLS、RBAC、人工确认和生命周期合同；不得让 Console 直接调用本模块或 shell。

## 4. Manifest wire schema

规范来源为 `config/system-helper-manifest.schema.json`，顶层和所有子对象均为
`additionalProperties=false`。`config/system-helper-manifest.v1.json` 是唯一提交的默认实例，
其 `entries=[]` 不代表任何 Android 工具已批准。目标宿主机的完整路径、版本和 hash 只能在
独立 R2 证据中采集，再生成用户明确批准的外部/部署配置。

安全能力集合仅包含 `version_read`、`metadata_read`、`health_read`、`lifecycle_control`、
`screen_observation`、`device_discovery_read`。以下能力固定禁止：设备输入、UI 自动化、
凭据、交易自动化、私有接口、外部网络、风控规避、APK 安装和数据导出。

## 5. 专用测试入口

`apps/api/test/helper-manifest.spec.ts` 是 test-only policy harness：读取提交的默认 JSON，
用内存 fixture 构造 approved/proposed/revoked 条目，验证正常解析、冻结结果、未知字段、
重复 ID、绝对路径、hash/版本、危险能力、网络/写入、shell-like 操作、秘密环境变量、批准
记录和 activation provenance 的负向路径。测试不启动进程、不读 PATH、不连接设备或网络。

## 6. 连接门槛、审计与回滚

连接任何 ADB、emulator、scrcpy 或其他 helper 前必须依次满足：

1. 目标宿主机显式选择路径并采集完整版本/hash/来源/许可证；
2. manifest 条目为 `approved`，且能力、参数、环境、资源和数据流通过 parser；
3. 新建 R2 checkpoint，记录用户批准、启动/健康/停止/崩溃恢复和撤销方式；
4. provider-host 通过认证/人工确认端口后，先做单实例人工观察，再做 `1 -> 2 -> 4` ramp。

任一字段不匹配必须 fail closed；撤销通过标记 `revoked` 或移除条目完成，保留审计和失败
证据。回滚恢复到最近已验证 checkpoint，不删除历史记录。

## 7. 当前结论

- **已由代码/测试确认**：默认空白 allowlist、严格字段/能力/环境/资源解析，以及所有
  provenance/批准不匹配的拒绝路径。
- **工程假设**：未来以 activation plan 连接版本化 provider-host；实际命令映射、隔离和
  Windows job/resource API 尚未实现。
- **待用户/平台确认**：Android Emulator Hypervisor Driver/WHPX、目标宿主机权限、实际
  helper 条目完整 hash/许可证、AVD 单实例稳定性、并发开销和真实 APK 人工兼容性。

关联记录：`docs/adr/0006-system-helper-manifest-boundary.md`、
`docs/checkpoints/CP-20260902-host-preflight.md`。

2026-09-03 的多实例压力观察另见
`docs/checkpoints/CP-20260902-gate-c-ramp-2-4.md`：该阶段是用户批准的 operator-run
实验，未通过本模块 activation plan，也未把 ADB/emulator 写入项目 helper allowlist；
`entries=[]` 和 `execution=not_performed` 约束保持不变。

本次后续保护探测的完整记录见
`docs/checkpoints/CP-20260903-gate-c-multi-followup.md`；第三实例因 commit 保护而停止
不改变 allowlist、helper 能力边界或 provider 授权状态。
