# ADR 0004：宿主机工具与数据卷显式选择

- 状态：已采纳
- 日期：2026-09-01

## 背景

宿主机、Android SDK 安装位置和可用数据卷并不唯一。通过当前工作目录、PATH、注册表、
用户目录或 `ANDROID_SDK_ROOT` 推导路径，会让“在本机可用”被误读为可部署，也可能把
环境细节泄露到控制平面响应。用户要求为后续多宿主机和深度二次开发预留稳定接口，当前
仍只允许 loopback。

## 决策

- `runtime-config.v3` 的完整配置显式声明 `storage.data_dir`、`storage.log_dir`、
  `tools.adb` 和 `tools.scrcpy`；`tools.emulator` 可选。环境变量模式允许逐项注入，
  未提供的项保持未检查状态。
- 配置层只做规范化和 schema 校验。`HostService` 只对已选择的数据卷执行磁盘探针，
  只对已选择的可执行文件做存在性检查；不实现隐式 resolver 或自动安装/启动。
- `host-probe.v1` 和 `provider-manifest.v1` 只返回非敏感状态与规划估算，不回显绝对路径、
  主机名或环境变量。真实 provider 的 deployment state、generation、operation_id 和
  命令 allowlist 必须在独立版本化接口中实现，并经过认证、授权和负向测试后才能启用。

## 后果

- 同一代码可迁移到不同宿主机，但部署者必须明确选择数据卷和工具路径；缺失信息会显示
  `unknown`/`not_checked`，不能被当作 Gate C 通过。
- 容量 profile 仍是估算值，必须在目标宿主机完成单实例到多实例 ramp test 后更新；探针
  本身没有设备或文件系统副作用。
- 若未来需要 SDK/provider 专用 resolver，必须新增带 schema 版本和审计记录的 provider
  配置，不得恢复隐式路径猜测，也不得因此扩大到远程监听或真实平台自动化。
