# Checkpoint: Gate C dual-instance extended resource baseline

checkpoint_id: `CP-20260903-gate-c-baseline-15m`
created_at_utc: `2026-09-02T18:36:30Z`
status: `verified_with_gap`
base_git_commit: `aba645fbf7c19cec2e78062c0a101f17d4bde591`

## Scope and non-goals

本 checkpoint 记录在现有用户实例不受干扰的前提下，对当前 Android 37 `x86_64` profile
进行双实例延长只读资源基线。目标是补齐约 15 分钟量级的健康、内存、commit、GPU 聚合
和 E 盘剩余空间证据；不把观测结果写成 provider `safe_instances` 或部署容量承诺。

本阶段不启动第三/第四实例，不安装 APK，不发送设备输入，不执行登录、验证码、OCR、
选票、下单、支付、抓包、逆向或风控规避；不启动项目 API/Vite/Tauri，不改变 loopback
exposure、helper manifest、API `max_devices` 或 AVD 配置。

## Affected modules and module books

- `M11-host-readiness` / `docs/modules/api-host-readiness.md`：接收目标宿主机观测输入，
  不拥有实例生命周期。
- `M7-adapter-layer` / `docs/modules/device-adapter.md`：只记录外部 AVD 的健康状态，
  未连接生产 adapter 或 provider-host。
- `M13-system-helper-policy` / `docs/modules/system-helper-manifest.md`：本阶段不激活
  helper，`entries=[]` 与 `execution=not_performed` 保持不变。

## Files, processes and devices

| 范围 | 事实 |
| --- | --- |
| 现有实例 | `ticket_test_1` (`emulator-5554`, qemu PID 2904)；`ticket_test_2` (`emulator-5556`, qemu PID 1848)；均由用户持有并保持在线 |
| 采样入口 | `.runtime/r2-avd-multi-20260903/sample-resources.ps1`，仅采集进程/ADB/主机状态；输出在被忽略目录 |
| 聚合证据 | `.runtime/r2-avd-multi-20260903/two-baseline-15m-aggregate-20260903.json` |
| 代码/依赖 | 未修改源码、依赖、锁文件或运行时配置；离线门禁另见既有 R1 证据 |
| 网络/业务 | 未启动项目服务，未访问真实平台；ADB 查询使用已有 loopback daemon |

## Commands and evidence

使用显式 ADB 路径和已登记的实例映射运行：

```powershell
.\.runtime\r2-avd-multi-20260903\sample-resources.ps1 `
  -DurationSeconds 900 -IntervalSeconds 30 `
  -InstanceMapPath .runtime\r2-avd-multi-20260903\instances-two.json `
  -DataRoot E:\ticket-test `
  -OutputPath .runtime\r2-avd-multi-20260903\two-baseline-15m-20260903.samples.json
```

脚本实际分为两段：第一段 29 个样本、活动采样 882.1 秒；第二段 2 个样本、活动采样
32.1 秒。两段之间 104.9 秒间隔被保留，未用插值填充。聚合报告共 31 个样本，墙钟跨度
1019.0 秒，活动采样合计 914.2 秒。聚合 SHA-256：
`1b72737219fd934b9f196f21f5e747a0153d9086b45a24dc826b1810d1e68e5e`。

### Observed result

- 两台 serial 全程 `device`，`sys.boot_completed=1`，`mWakefulness=Awake`；采样期间
  qemu 均响应。
- 宿主可用物理内存 `12.303--13.055 GiB`，commit `81.446--83.260%`。
- qemu working set 合计 `3.393--4.176 GiB`；Private 合计 `7.478--7.480 GiB`。
  `ticket_test_1` Private `2.074--2.075 GiB`，`ticket_test_2` Private
  `5.404--5.406 GiB`；working set 的回收波动不等于 Private 释放。
- E: 剩余约 `386.693 -> 386.691 GiB`，窗口内变化约 `-0.001938 GiB`；这是逻辑剩余
  快照，不是写放大或部署容量测量。
- `nvidia-smi` 只提供主机级 GPU 显存/利用率/温度聚合，无法按 qemu 进程归因；未将其
  作为 GPU 安全预算。

## Decisions, risks and data handling

- 延长窗口通过只读健康门槛，但当前 profile 的第三实例探测此前已在 boot 前触发
  `commit=95.979%` 保护，因此不启动第四台，也不把双实例写成安全容量。
- 分段采样间隔、未执行人工业务操作、GPU/I/O 无按进程归因，均保留为限制；空系统结果
  不代表真实 APK、串流并发或平台兼容性。
- 不记录账号、手机号、身份证、验证码、支付信息、屏幕内容或真实平台流量。

## Rollback procedure

本阶段没有生产代码或配置回滚；原始采样、聚合和本 checkpoint 只追加保留。若后续发现
统计错误，在新 checkpoint 中追加更正并保留原文件哈希。不得停止或重启用户持有的
`ticket_test_1/2`，不得删除 AVD 目录/锁或重写 Git 历史。

## Next gate

1. 若目标仍为 3/4 台，先由用户选择真正生效的低 RAM/低图形 profile，或提供更大物理/
   提交内存的宿主机；在此前不继续当前 profile 的第三/第四台压力试验。
2. 低资源 profile 先做单实例 repeat/soak，再按同一保护线重新评估并发；GPU 温度、
   按进程显存、writable clone I/O 和目标宿主机专用 preflight 仍需独立证据。
3. 真实 provider/helper、SQLite 持久化、Console 受控实测和系统通知策略仍遵循既定顺序
   与用户决策闸门；本 checkpoint 不授权这些连接。
