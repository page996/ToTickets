# Checkpoint: module governance baseline

checkpoint_id: `CP-20260902-module-governance-baseline`
created_at_utc: `2026-09-02T10:29:58.474Z`
status: `in_progress`
base_git_commit: `bdf9a3f`

## Scope and non-goals

本阶段只把现有源码和高层规格映射为可审计的模块索引，并完成一个 API 模块和一个
Console 子模块的开发书示范。不会拆分生产类、改变 REST/WebSocket 合约、增加依赖、
启动系统 helper、启动 AVD/API、访问外部网络或推送远端。

## Planned deliverables

- `docs/modules/index.md`：稳定 module ID、源码边界、实现状态、契约、测试和连接门槛索引；
- 一个 API 模块开发书：记录变量、函数/端口、共享资源 owner、test-only 入口和证据；
- 一个 Console 子模块开发书：记录状态、transport/UI 边界、测试入口和证据；
- 本文件的结果追加段，记录实际偏差、验证和下一 gate。

## Decisions and approvals

- 用户已要求“继续推进”，并已授权仓库文档约束更新；本阶段选择低风险文档治理作为下一步。
- 真实设备、系统 helper、依赖变更和远端推送属于独立审批阶段，不在本 checkpoint 默认授权内。

## Known inputs

- 当前基线提交：`bdf9a3f`；工作树创建时 clean；
- `docs/03-module-specifications.md` 与 `docs/08-module-connection-matrix.md` 只有高层模块描述，
  尚不能替代递归模块开发书；
- 现有源码存在 CommonModule 全局共享、Device/Deployment 大类和测试直接实例化生产类等待登记边界。

## Rollback

若阶段失败，保留本 checkpoint 和失败证据，恢复到 `base_git_commit` 对应的文档状态；不删除
checkpoint、不重写历史、不影响运行配置或设备状态。

## Result append: 2026-09-02T10:55:00Z

status: `partial`（第一版索引和两个示范模块书已登记；递归书页、正式 test-only port、
helper manifest 和 HostPlannerPort 尚未完成）

### Affected modules and module books

- `M11-host-readiness` → `docs/modules/api-host-readiness.md`
- `CON-C3-control-plane-client` → `docs/modules/console-control-plane-client.md`
- registry/index → `docs/modules/index.md`

本轮将旧的 `api.host-readiness`、`console.control-plane-client` 作为迁移别名，canonical
ID 与索引统一。M12 deployment 在索引中明确为已实现扩展模块，而非声称来自旧版 M1-M11
规格。索引同时登记 API common、Console 递归边界和未完成的 composition owner。

### Files, dependencies, processes, devices

只写入上述三份模块文档和本 checkpoint；未修改 package manifest、锁文件、源码、配置、
SBOM 或依赖。未启动 API、Vite、Tauri、AVD、ADB、浏览器或系统 helper。未访问外部网络。
本轮曾发起一次递归 `.tools` 只读列举，因缓存规模过大留下 PID `33808`；已核对其命令行
确属该扫描并精确停止。历史待确认 PID `25000` 当前不存在；没有终止其他用户进程。

### Commands and evidence

已执行并通过：

- `git status --short --branch`：基线为 `main...origin/main [ahead 3]`，仅模块文档/ checkpoint 未跟踪；
- `git diff --check`：无空白错误；
- `rg` 窄范围路径、绝对路径、工具链和禁止能力扫描：模块文档未发现本机绝对路径、安装命令或可执行购票步骤；
- 源码/契约只读对照：`apps/api/src/hosts/*`、`apps/api/test/host-service.spec.ts`、`openapi-contract.spec.ts`、
  `apps/console/src/api/*`、`runtime-config.ts`、`use-control-plane.ts` 与 `docs/openapi.v1.json`。

未在本轮重新运行全量测试、构建、浏览器或设备检查；模块书引用的 API 18 suites/183 tests、
Console 9 files/81 tests 和 loopback 浏览器结果来自 `docs/12-final-release-audit.md` 的
2026-09-01 历史证据，不被本 checkpoint 重新声明为本轮实测。

### Decisions, risks and deviations

- 文档把 `HostService` 的 `PROVIDER_MANIFESTS` 明确为编译期冻结 registry；`requirements`
  尚未参与容量准入，`toolCheck` 尚未验证 executable/version/hash，均列为后续门槛。
- `scripts/load/mock-control-plane-load.mjs` 直接导入 `ws`，但根 manifest 未声明该依赖；
  这是后续依赖治理阶段的 phantom-dependency 修复项，本轮不修改 manifest/lock/SBOM。
- Console 文档区分设备安全命令的 confirmation、日程写操作的幂等键和 stop-all 的双 key，
  并注明 `write()` 未传 key 时自动生成 UUID，纠正了旧版过宽表述。
- `system-helper-manifest.v1` 当前没有可执行条目；本阶段不因用户已经创建 AVD 就启动任何
  helper。真实平台仍保持人工验收边界。
- `docs/12-final-release-audit.md` 与 `docs/13-host-preflight-and-deployment.md` 的历史
  AVD 快照不被覆盖；新的宿主机事实需在独立 host checkpoint 追加。

### Rollback and next gate

回滚只恢复到 `bdf9a3f` 的文档状态（保留本 checkpoint 和失败证据），不使用历史重写或删除
记录。下一 gate 是用户确认是否进入独立的工具链/test-only 治理阶段；该阶段若要新增依赖、
启动 helper/设备、改变协议或访问外部网络，须另建 R2 checkpoint 并在实施前说明权限、数据流、
停止方式和回滚。当前模块治理结论为 `partial`，不得作为真实 provider 部署授权。

`next_gate`: 用户确认是否进入独立的工具链/test-only 治理阶段；在确认前保持 loopback、
mock-only 和无外部进程状态。

## Result append: 2026-09-02T11:14:21Z

`result_status`: `verified`（本阶段计划中的索引、示范书和 checkpoint 记录均已写入并通过
文档/静态门禁）；`governance_status`: `partial`（这表示后续模块独立化工作仍未完成）。

审计并发线补充了 API 顶层 health/events/composition/bootstrap 边界、API common/errors
边界、Console 递归边界和逐项 checkpoint 映射；这些登记不等于新增生产端口或运行时行为。
`package.json`、锁文件和 SBOM 经只读 `git diff` 核对无差异；phantom `ws` 仍仅作为后续
依赖治理缺口记录。

本次最终验证命令及结果：

- `git diff --check`：通过；
- 模块文档相对链接解析：全部通过；
- module ID、canonical status、绝对路径/安装命令/禁止能力窄扫描：通过；
- `pwsh -NoProfile -File scripts/check-compliance.ps1`：通过（120 runtime/command files、
  3 Node manifests、1 Rust manifest、1 configuration template）；
- 未重新运行全量测试、构建、浏览器或设备检查；相关结果仍引用 `docs/12-final-release-audit.md`
  的 2026-09-01 历史证据。

工作树中仅保留本 checkpoint 与三份模块文档的新增内容，未启动或改变任何服务、设备、
helper、配置或外部账户。下一 gate 仍按 `next_gate` 字段执行；进入依赖/test-only 阶段前，
需单独记录依赖来源/许可证/SBOM 变化和回滚方式。

## Result append: 2026-09-02T11:19:17Z

按用户此前的远端同步授权执行 `git push origin main`。远端地址为项目已配置的
`https://github.com/page996/ToTickets.git`；Git 在约 21 秒后返回
`Failed to connect to github.com port 443`，未产生远端写入。当前本地提交链仍完整，推送可在
网络恢复后从 `eaf9e65` 继续；本次失败不改变代码、依赖、设备或配置状态，也没有再次尝试或
修改 VPN/代理设置。
