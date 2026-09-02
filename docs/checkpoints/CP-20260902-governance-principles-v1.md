# Checkpoint: development-principles.v1

checkpoint_id: `CP-20260902-governance-principles-v1`  
created_at_utc: `2026-09-02T10:07:35.273Z`  
status: `documented`  
base_git_commit: `ed2edaf0a8ef8a7ada14db84aa35e4d0e13152fd`

## Scope and non-goals

本 checkpoint 只持久化用户确认的开发流程原则和记录规范。它不修改 API、Console、设备
适配器、依赖锁文件、运行配置、Android SDK 或任何外部进程。

## Affected documents

- `AGENTS.md`：加入 `project-governance.v2` 和五条开发流程原则；
- `docs/governance/development-principles.md`：新增模块开发书、typer2、专用测试入口、
  checkpoint 和重大决策闸门的详细规则；
- `docs/governance/approval-protocol.md`：要求 R1/R2 关联模块书和 checkpoint；
- `docs/checkpoints/CP-20260902-governance-principles-v1.md`：本记录。

## Evidence

- 变更前工作树：clean；基线提交如上；
- 本阶段预期验证：文本引用、版本标识、路径存在性和 Git diff 检查；
- 未启动服务、设备或测试进程，未安装依赖，未访问外部网络。

## Decisions and approvals

- 用户已授权将新约束同步到仓库文档；
- 隐藏 system prompt 不在代理可修改范围，采用仓库 `AGENTS.md` + governance 文档持久化；
- `typer2` 被记录为开发/测试环境边界，不被引入为正式后端运行时依赖。

## Known gaps

- 当前仓库尚无 `typer2` 的版本化声明和启动校验；
- `docs/03-module-specifications.md` 是高层规格，不替代逐模块/递归模块开发书；
- 现有测试入口尚未按新模板逐模块登记；
- 这些缺口属于后续独立 checkpoint，不在本次文档变更中隐式解决。

## Rollback

若本次规则需要回退，恢复到 `base_git_commit` 对应的文档状态，并保留本 checkpoint 作为
历史记录；不得删除本文件或重写已有 Git 历史。任何回退动作需在新的 checkpoint 中说明。

## Next gate

下一阶段开始前，先建立 `docs/modules/` 索引/模板并完成一个 API 模块和一个 Console 子
模块的示范登记；随后再决定是否改造工具链以声明 `typer2`，不因本文件的落盘而默认放宽
现有 loopback、人工验收或真实平台安全边界。
