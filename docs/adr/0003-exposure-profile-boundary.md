# ADR 0003：监听暴露 profile 与远程扩展边界

## 状态

已接受（当前只启用 `loopback.v1`）。

## 背景

当前控制平面假设调用者是同一台机器上的本地操作者。简单放宽监听地址不能提供
身份、设备授权、传输机密性或跨站请求防护；宿主机/provider 也可能位于不同网络和
信任域。用户要求现在保持 loopback，同时为后续深度二次开发预留清晰接口。

## 决策

- API 的绑定校验通过 `apps/api/src/config/exposure-profile.ts` 集中执行；
  `runtime-config.v3` 只激活 `loopback.v1`。
- `authenticated-tls.v1` 仅作为描述性 profile，必须同时具备认证、TLS、RBAC、CSRF
  和 WebSocket 握手认证，并完成 OpenAPI/事件契约、负向测试、设备授权和审计升级后
  才能启用。
- Console、Host Probe 和 provider host 不直接共享数据库或内部类；远程连接只能
  通过版本化 REST/WebSocket 合约。
- 任何 profile 切换都需要 schema 版本、配置审计、可回滚迁移和用户/安全评审；不以
  修改 `bind_host` 作为远程部署开关。

## 后果

当前行为和安全门禁不变，但未来远程扩展有单一策略边界和明确的前置检查。未完成
上述 controls 前，任何远程地址、云凭据或跨设备批量输入都继续被拒绝。

