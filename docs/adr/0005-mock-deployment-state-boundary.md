# ADR-0005：Mock-only 部署状态边界

- 状态：已采纳（当前仅 mock）
- 日期：2026-09-01

## 背景

用户要求当前只允许 loopback，同时要为不同宿主机、Android 模拟器/实体设备和未来的
二次开发预留稳定接口。直接把 ADB、模拟器或串流供应商命令接进控制器，会把资源规划、
进程生命周期和真实第三方应用操作混在一起，也无法在没有实机证据时承诺并发或兼容性。

## 决策

- 增加独立的 `DeploymentService`、repository、严格 DTO 和版本化 REST/CloudEvents
  契约。当前公开 REST 只接受 `mock-adapter` + `mock_only`，记录固定为
  `planning_only=true`、`side_effects=none`。
- `HostService` 以非敏感容量快照注入 `plan`；客户端不能提交主机资源声明。状态域分离
  `desired_state`/`observed_state`，并以单调 `generation` 和 `operation_id` 关联变更。
- 所有 mock 写请求要求 `Idempotency-Key` 和显式 `operator_confirmed=true`。状态变化和
  domain 层拒绝分别发布 `deployment.state.changed` 与
  `deployment.operation.rejected`，并写入脱敏审计。REST DTO 层的非法枚举先以
  `schema.invalid` fail fast，不伪造 domain 事件。
- domain 只管理进程内状态，不解析可执行路径、不启动外部进程、不访问 ADB、不安装 APK、
  不发送设备输入。SQLite、跨进程 provider host 和真实 provider 都必须以新版本化端口
  替换，并保持当前安全边界。
- 启用真实 provider 前必须完成服务端身份认证、TLS、RBAC、CSRF、WebSocket 握手认证、
  设备授权、provider-host allowlist、人工确认和目标宿主机 Gate C；不得通过放宽
  `bind_host` 绕过这些门槛。

## 后果

- 可以在脱机环境验证状态机、容量边界、幂等、审计和事件契约，且不会把 mock 自动化
  迁移到真实大麦适配器。
- 当前记录是内存态，重启后丢失；真实 provider 的资源预留、恢复和持久化仍需独立设计、
  负向测试和人工验收。
- `validating`、`provisioning`、`starting` 等阶段先作为版本化状态保留，不能被解释为
  已存在的执行器或设备就绪证明。

## 证据

- 实现：`apps/api/src/deployments/`
- REST/OpenAPI 契约：`apps/api/test/openapi-contract.spec.ts`
- domain/负向测试：`apps/api/test/deployment-service.spec.ts`、`apps/api/test/deployment-api.spec.ts`
- 事件 schema：`docs/schemas/deployment-state-changed.v1.json`、
  `docs/schemas/deployment-operation-rejected.v1.json`
