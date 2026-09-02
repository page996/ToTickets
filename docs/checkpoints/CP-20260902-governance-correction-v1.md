# Checkpoint: development-principles.v1 correction

checkpoint_id: `CP-20260902-governance-correction-v1`
created_at_utc: `2026-09-02T10:21:49.365Z`
status: `documented`
base_git_commit: `31395d8`

## Reason and scope

用户确认 `typer2` 属于其他项目，不是本仓库环境。本 checkpoint 将误引入的强制环境名称
改为“仓库内版本化、可复现的项目隔离环境”，并新增受控系统 helper 白名单约束。只修改
治理文档，不修改源码、依赖、运行配置、设备或进程。

## Changes

- `AGENTS.md`：移除 `typer2` 强制要求，加入项目内部工具链表述和系统 helper 白名单摘要；
- `docs/governance/development-principles.md`：重写运行环境章节，新增
  `system-helper-manifest.v1` 及能力/路径/数据/审计门槛；
- `docs/governance/approval-protocol.md`：把 helper 纳入 R2 审批并要求白名单字段；
- 新增本 checkpoint；上一份 `CP-20260902-governance-principles-v1.md` 保留为历史记录，
  不再作为当前环境规则的唯一依据。

## Helper boundary

helper 默认拒绝，只能以版本化条目和用户批准的显式路径接入；版本、哈希、许可证、能力、
参数/环境、数据流、资源、生命周期、撤销和回滚均需可审计。helper 不得增加设备输入、
真实平台自动化、凭据处理或风控规避能力。本阶段没有启用任何 helper。

## Evidence and result

- 修改前基线：`31395d8`，工作树 clean；
- 预期结果：仓库规范中不再把 `typer2` 作为当前项目的强制环境；
- 主代理本阶段未安装依赖、未启动 API/AVD/设备，也未主动访问外部网络；
- 并行宿主机审查曾调用 `sdkmanager --list`，工具自身尝试 analytics/网络访问并超时后停止；
  没有安装 APK、连接账号或修改项目文件。该偏差作为本 checkpoint 的实际结果保留；
- 检查时发现一个由先前审查遗留、归属未确认的只读 `pwsh` 扫描进程（PID 25000），本阶段
  未擅自终止，待单独确认后处理；
- 旧 checkpoint 未被覆盖，便于追溯误配来源。

## Known gaps

- 项目内部隔离工具链仍需补齐统一入口和启动校验；
- `system-helper-manifest.v1` schema、白名单存储位置和第一个批准 helper 尚未实现；
- 模块开发书、test-only 入口和历史阶段 checkpoint 的整改仍按前一 checkpoint 的下一门槛执行。

## Rollback and next gate

回滚只能通过新的文档 checkpoint 恢复到 `base_git_commit` 对应状态，不删除本记录或重写
历史。下一阶段先确定 helper manifest schema/owner 和项目内部工具链入口，再决定是否进行
任何 R2 helper、AVD 或 provider 操作。
