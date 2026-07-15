# 项目技能管理设计

> 状态：候选终态 v6；S0 证据与契约、文件系统原语通过后方可进入实现
>
> 日期：2026-07-14
>
> 定位：Pier 主体平台能力，统一管理项目级智能体技能（Agent Skills），并安全投递到各智能体的原生发现路径。

## 1. 目标和完成标准

Pier 为当前项目提供查看、搜索、本地导入、启用、禁用、删除、应用和健康检查闭环：

1. 技能内容只在 `.pier/skills/library/` 保存一份；启用状态通过指向该只读快照的受管相对目录符号链接表达。
2. 启用并应用后，新会话能从目标智能体的原生路径发现技能；禁用并应用后，新会话不再发现该技能。
3. 默认不写 `~/.claude`、`~/.codex`、`~/.agents`、`~/.cursor` 等用户级发现目录，也不重定向整棵配置目录。
4. Pier 只删除自己在本机创建且未被外部修改的投影；无法证明所有权的目标一律保留并报告冲突。
5. 项目清单、实际投影、设置界面和启动链路具有单向所有权；崩溃或部分失败后只能得到旧状态、完整新状态，或不猜测所有权的明确阻断态。

完成标准：

- 项目清单是唯一的期望状态；renderer 只持有可丢弃草稿，不维护第二份已应用状态。
- `{userData}` 下已提交的可信账本是删除投影的唯一证明；进行中的恢复日志只能恢复其精确操作，项目内文件不能授权删除。
- `skills.plan` 以观察 revision 预检草稿；`skills.apply` 在同一锁内重新验证并以清单耐久发布为唯一提交点。
- 提交点前失败不改变期望状态；提交点后失败才是 `degraded`；耐久性无法判断时进入 `indeterminate` 并禁止后续写入。
- Pier 已知的受管智能体启动入口全部在 main 最后公共 spawn 边界完成同步校正；校正失败时默认不启动，降级启动必须消费一次性授权。
- 每个支持的智能体都有核验日期、版本、官方来源和真实探测证据。
- 第 10 节的需求到证据矩阵全部通过。

### 1.1 生效边界

“启用”和“禁用”描述磁盘发现状态，不承诺撤回已进入会话上下文的内容：

- 新会话以应用后的投影为准。
- 已运行会话是否热更新只能作为适配器能力说明，宿主不推断某个技能是否已被调用。
- 只要项目仍有相关活动会话，应用发现状态变更后统一提示“现有会话可能保留旧内容，建议新建会话”；不得显示“已经从当前会话移除”。

## 2. 当前结构为什么不足、设计依据和范围

把技能长期放在 `.agents/skills` 或 `.claude/skills`，会混合“内容存在”“用户启用”和“智能体可发现”三个事实。若文件仍在扫描目录，仅在 Pier 清单里写 `enabled: false`，禁用对原生扫描者无效；若直接管理用户全局目录，又会把项目选择扩散到其他项目，并与账号、hooks 和用户自有技能发生冲突。

因此采用“项目技能库 + 期望清单 + 受管发现投影 + 本机可信账本”，不使用配置根重定向模拟隔离。

### 2.1 官方事实


| 智能体         | 已确认的项目发现路径                                           | 重要行为                                                          | v1 决策                                              |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Codex       | `.agents/skills/<name>/SKILL.md`                     | 从当前目录向仓库根扫描；支持技能目录符号链接；同名技能不会合并；自动检测变化，必要时需重启                 | 默认项目投影                                             |
| Claude Code | `.claude/skills/<name>/SKILL.md`                     | `v2.1.203+` 支持技能目录符号链接；监听既有技能目录变化；会话启动时目录尚不存在则需重启；已调用内容保留在会话中 | 显式开启 Claude 适配                                     |
| OpenCode    | `.agents/skills`、`.claude/skills`、`.opencode/skills` | 同时扫描多个兼容路径；要求技能名唯一                                            | 开启 Claude 适配时检查重复发现                                |
| Cursor      | 官方列出 `.agents/skills`、`.cursor/skills`               | 编辑器、CLI 和远程运行形态的发现与注入行为需按版本探测                                 | v1 不创建额外 `.cursor/skills` 投影；`.agents` 探测不通过时报告不支持 |


以上事实核验于 2026-07-14。官方依据：[Codex](https://developers.openai.com/codex/skills)、[Claude Code](https://code.claude.com/docs/en/skills)、[Cursor](https://cursor.com/docs/skills)、[OpenCode](https://opencode.ai/docs/skills)、[Agent Skills 规范](https://agentskills.io/specification)。适配能力必须同时具有官方文档和版本化探测证据，不能从第三方管理器的路径表推断，也不能在界面硬编码为健康。

### 2.2 v1 范围

- 本地目录导入、列表、搜索、启用、禁用和删除。
- `.agents/skills` 默认相对目录符号链接投影与 `.claude/skills` 显式适配。
- 应用、修复、只读健康检查，以及冲突、漂移、重复发现和会话刷新状态。
- Pier 已知智能体启动入口的同步校正。
- macOS 本地文件系统；文件系统必须通过目录同步、对象身份和不覆盖发布原语探测。网络盘、云盘和语义不可靠的 FUSE 只读诊断，不执行写入。

### 2.3 非目标

- 写用户级技能目录，或通过 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 重定向配置根。
- 远程地址导入、Git 安装、更新检查、预设或市场。
- 技能内容在线编辑、覆盖导入和版本更新；库内容是导入时生成的只读快照，外部修改一律视为漂移，v1 不提供“接受当前内容”。
- 官方插件贡献技能；`bundled-snapshot` 和插件贡献 API 必须在出现明确消费者时另行设计用户确认、项目授权、升级和卸载生命周期。
- 复制型投影以及 Windows、Linux 文件系统兼容层；没有对应平台原语与探测证据前不得提前保留伪兼容分支。
- Pier 私有会话注入，或为任意未知智能体承诺可见性。
- 修改现有 hooks 安装器，或把技能内容当作安全沙箱执行。

远程来源、更新和市场必须另行设计签名、不可变版本、摘要校验、差异预览、回滚和恶意脚本风险提示，不能直接扩展本地导入接口。设置页只保留一次说明：技能管理不写用户级技能目录；Pier 既有状态 hooks 可能写入智能体配置，二者相互独立。

## 3. 状态和所有权

### 3.1 状态分层


| 层     | 位置                                                                    | 所有者       | 含义                                    |
| ----- | --------------------------------------------------------------------- | --------- | ------------------------------------- |
| 技能库   | `.pier/skills/library/<skill-id>/`                                    | 项目清单域     | 导入时发布的只读内容快照，是项目中的内容单源                |
| 期望清单  | `.pier/skills/manifest.json`                                          | 项目清单域     | 启用集、适配开关、内容摘要和来源快照                    |
| 发现投影  | `.agents/skills/<id>`、`.claude/skills/<id>`                           | 校正服务      | 仅承载已启用技能的受管相对目录符号链接                   |
| 所有权状态 | `{userData}/project-skills/<root-key>/ownership.json`                 | main 持久化层 | 只保存可信投影账本和独立 generation               |
| 操作状态  | `{userData}/project-skills/<root-key>/operations/<operation-id>.json` | main 持久化层 | 进行中恢复日志或已完成幂等结果，不进入 observed revision |
| 导入暂存  | `{userData}/project-skills/<root-key>/staging/`                       | main 持久化层 | 未消费导入候选，不是第二份期望状态                     |


项目目录中的清单和内容按不可信声明读取。本机状态不进入项目、不提交 Git，也不由 renderer 或插件直接写入。

```text
<projectRootPath>/
  .pier/skills/{manifest.json,library/<skill-id>/...}
  .agents/skills/<skill-id>       # 默认受管投影
  .claude/skills/<skill-id>       # 开启 Claude 适配后存在
```

### 3.2 清单

所有内容都先快照到 `library/<id>`；`source` 只记录来源类别，不作为运行时地址。

```json
{
  "version": 1,
  "delivery": { "claude": false },
  "skills": [
    {
      "id": "review-guide",
      "enabled": true,
      "contentDigest": "sha256:...",
      "source": { "type": "local-import" }
    }
  ]
}
```

清单使用 strict schema。`id` 必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*$` 且不超过 64 个字符；`id`、父目录名和 `SKILL.md` 的 `name` 必须一致；`description` 长度为 1 至 1024；`skills` 按 `id` 唯一。

技能 frontmatter 按 Agent Skills 核心字段校验，同时保留 Claude Code 等厂商扩展字段；未知扩展字段不能被 Pier 执行。库是“逻辑只读快照”，不依赖 POSIX 权限阻止用户修改：目录规范化为 `0755`、普通文件 `0644`、可执行文件 `0755`，保证 Git checkout、切分支和恢复内容可用。每次计划、应用、修复和启动校正都重新核验实际树摘要。出现 `library-drift` 时阻断保留或启用该技能以及受管启动，v1 只能恢复原内容或显式删除，普通应用绝不顺带更新 `contentDigest`。

摘要与并发版本必须冻结算法版本：

- `tree-sha256-v1` 按规范化 POSIX 相对路径字节排序，使用无歧义长度编码摘要条目类型、路径、文件长度、文件内容和可执行位；拒绝符号链接、硬链接、特殊文件、大小写折叠冲突和 Unicode 规范化冲突，不使用 mtime。
- `manifestRevision` 是规范化清单 JSON 的摘要，只表示期望状态。
- `observedRevision` 是 `manifestRevision`、全部实际库摘要、`ownership.json` generation、投影对象身份与状态的摘要，是 `plan` 和 `apply` 的并发前置条件；幂等结果和展示缓存不参与该摘要。
- renderer 不能提交 `source`、摘要、文件规模、投影路径或健康结论；这些权威字段全部由 main 从 token 和磁盘派生。

### 3.3 项目身份

项目引用 `ProjectRootRef` 包含规范化 `realpath`、卷身份、目录文件身份和可选的 main 授权 token。写入和删除必须同时匹配路径与稳定目录身份：

- 同卷改名只有在旧路径不可用且稳定身份唯一匹配时，才在持锁状态下原子重键本机状态。
- 跨卷复制、重新 clone、worktree 删除后重建，以及原路径删除后新建目录均视为新项目，绝不继承旧账本的删除权限。
- 外置卷离线时长期保留账本和恢复日志；不得按时间自动忘记项目。
- 操作期间项目根或任何受管祖先身份改变时立即停止，进入 `project-identity-changed` 阻断态。

`ProjectRootRef` token 使用高熵随机值，绑定签发窗口、client instance、项目身份和用途；临时选择的项目 token 在设置窗口关闭或 30 分钟后失效。renderer 仍可展示路径，但所有读写命令都由 main 重新授权和规范化。

### 3.4 可信账本和删除

账本条目记录 schema 版本、generation、项目身份、相对目标、技能 id、预期相对链接目标、投影对象的卷/设备/inode/出生时间身份、创建操作 id 和时间。项目内诊断标记不能证明所有权；“可信”只表示相对于不可信项目内容的本机权威状态，不防同一操作系统用户下的恶意进程篡改。

删除前必须同时满足：

1. 可信账本存在该目标记录；
2. `lstat` 类型与账本一致；
3. 符号链接仍指向预期库目录；
4. 当前投影对象身份与创建后写入账本的身份完全一致。

账本缺失、损坏、版本未知或权限异常时一律保留目标；链接被改写或用户删除后重建相同链接时也保留，并报告 `managed-target-modified`。恢复日志只可重放或回滚其记录的精确对象身份，不能提升为对任意现存目标的删除授权。禁止仅凭路径、链接目标或项目内标记递归删除。

`ownership.json` 使用 strict schema，在跨进程项目锁内按预期 generation 做耐久条件替换；这不是“不覆盖发布”，而是只允许从已读取的旧代次原子推进到下一代。恢复日志使用独立 strict schema 和耐久条件更新。损坏状态的隔离顺序固定为：先耐久写入 `PREPARED` tombstone（`root-key`、原路径、原对象身份、计划隔离路径），再以不覆盖方式移动损坏文件，最后耐久推进为 `QUARANTINED`。tombstone 写失败时原文件留在原位；移动结果不明时保留 tombstone 并阻断。用户明确处理前，即使原路径已空也持续返回 `ledger-corrupt` 或 `recovery-record-corrupt`，绝不能把“隔离后的缺失”解释成空账本。旧备份只用于诊断，不能自动恢复删除权限。

本机所有权状态按 Pier profile 私有，跨 profile 的共享锁只负责串行化磁盘操作，不共享或收养删除权限。另一个 profile 遇到已有投影时按非托管目标处理：可以只读诊断，但不能采用、替换或删除；这会牺牲跨 profile 的自动接管，换取可证明的所有权边界。

### 3.5 对外数据结构

共享契约至少冻结以下结构，字段名称可在 S0 调整，但信息和所有权不能缺失：


| 结构                            | 必要字段                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ProjectSkillsProjectSummary` | `projectRef`、显示路径、来源、最近时间、技能数、最严重健康摘要、读取状态                                                                                   |
| `ProjectSkillsSnapshot`       | `projectRef`、两个 revision、清单、`ProjectSkillView[]`、健康、Git 建议、最近操作、`checkedAt`                                                  |
| `ProjectSkillView`            | `id/name/description`、来源类别、期望启用态、实际树摘要、规模、风险、投影状态、问题 id                                                                      |
| `ProjectSkillsIssue`          | 稳定 id、code、severity、scope、技能/适配器/相对目标、`blockingScopes`、repairable、证据、检查时间                                                    |
| `DiscoveryAdapterView`        | `agentKind`、适用性、探测状态、实测版本、活动发现根、重复策略、会话刷新语义、汇总状态、问题 id、`checkedAt`                                                           |
| `GitProjectionView`           | 相对目标、`absent/ignored/untracked/tracked/unknown`、忽略建议、删除将产生 Git 变化的警告                                                         |
| `ImportCandidateView`         | 单次 token、候选元数据、规范化目录构成、规模、树摘要、风险、过期时间                                                                                        |
| `ProjectSkillsPlan`           | `observedRevision`、规范化差异、逐目标操作、阻断问题、`confirmationRequirements[]`、`planDigest`、是否可应用                                          |
| `ProjectSkillsRepairPlan`     | `observedRevision`、`continuationOf?`、逐目标校正、Git/对象身份前置条件、`confirmationRequirements[]`、`repairPlanDigest`、是否可执行                |
| `ConvergedResult`             | `status: converged`、operation id、已提交 revision、逐目标结果、权威新快照                                                                    |
| `DegradedResult`              | `status: degraded`、operation id、已提交 revision、逐目标结果、权威新快照和待校正问题                                                               |
| `IndeterminateResult`         | `status: indeterminate`、operation id、最后确认的旧 revision、可能的新 `manifestRevision`、查询状态所需信息；不得携带伪权威新快照                             |
| `SupersededReconcileResult`   | `status: superseded`、operation id、`hadDurableTargetChanges: true`、原基准 revision、当前 revision、当前权威快照和逐目标结算结果                    |
| `ReconcileResult`             | `converged/degraded/indeterminate/superseded` 严格联合；字段规则与应用结果一致，但不声称提交了新清单；尚未写目标的 superseded 仍是 `not-applied` 原因码             |
| `OperationStatus`             | operation id、请求摘要、当前事务阶段；非终态 `pending/recovering`，或不可变终态 `converged/degraded/not-applied/superseded/recovery-blocked` 及其严格结果 |


`ProjectSkillsProjectSummary` 必须区分缓存摘要与实时摘要，并携带 `checkedAt` 和 `stale`；缓存不得伪装成当前健康。以上结果都用可辨识联合（discriminated union），禁止以大量可空字段表达互斥状态。绝对暂存路径、账本原文、token 内容和未筛选的 frontmatter 不返回 renderer。

### 3.6 代码所有权


| 层                                        | 所有权                                                              |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `src/shared/contracts/project-skills.ts` | 严格数据结构校验、请求、快照、报告、健康码和错误码                                        |
| main L1 持久化                              | 原子读写清单与本机状态，不依赖策略和 UI                                            |
| `ProjectSkillsFileSystemAdapter`         | macOS 对象身份、目录同步、不覆盖发布、逐段安全解析和文件系统能力探测                            |
| `ProjectSkillsLock`                      | 与现有 `FilePathTransactionLock` 共用的进程内层级锁，以及跨 Pier profile 的每用户项目锁 |
| `ProjectSkillsService`                   | 项目根授权、校验、计划、事务、恢复、修复、项目汇总和健康检查                                   |
| `SkillDiscoveryAdapterRegistry`          | 发现根、版本证据、重复策略和会话刷新语义                                             |
| 命令路由与 preload                            | `skills.*` 授权和类型化调用，不包含 UI 或文件策略                                 |
| renderer store 与设置界面                     | 保存请求代次、revision 和可丢弃草稿，展示 main 计划、健康与反馈，不直接碰文件系统                 |
| 测试                                       | 证明状态收敛、删除安全、进程边界、启动顺序和用户反馈                                       |


项目入口统一从 `PanelContext.projectRootPath` 解析 `ProjectRootRef`。`skills.projects.snapshot` 在 main 合并最近面板上下文和本地环境索引，不新增 `Project` 注册表或 `projectId` 外键；renderer 不自行拼接第二份项目来源。

## 4. 命令和应用控制流

### 4.1 命令与权限


| 命令                         | 行为                                     | 客户端                            |
| -------------------------- | -------------------------------------- | ------------------------------ |
| `skills.projects.snapshot` | main 有界聚合已知项目和最近摘要；实时健康按可见行懒加载         | `desktop-renderer`             |
| `skills.project.pick`      | 打开原生项目目录选择器，返回临时 `ProjectRootRef`      | `desktop-renderer`             |
| `skills.snapshot`          | 一致读取两个 revision、技能视图、健康、Git 建议和最近操作    | `desktop-renderer`、`cli-local` |
| `skills.import.prepare`    | 在 main 内打开原生导入目录选择器并生成候选快照；取消返回 `null` | `desktop-renderer`             |
| `skills.import.discard`    | 幂等丢弃未消费候选                              | `desktop-renderer`             |
| `skills.plan`              | 按草稿只读计算差异、逐目标操作、阻断问题和 `planDigest`     | `desktop-renderer`             |
| `skills.apply`             | 重新验证计划并按整份草稿提交期望状态                     | `desktop-renderer`             |
| `skills.repair.plan`       | 只读计算校正差异、确认要求和 `repairPlanDigest`      | `desktop-renderer`             |
| `skills.repair`            | 按磁盘清单重新校正                              | `desktop-renderer`             |
| `skills.doctor`            | 只读检查，不自动修复                             | `desktop-renderer`、`cli-local` |
| `skills.operation.status`  | 只读查询指定 operation 的持久化阶段和严格结果           | `desktop-renderer`、`cli-local` |


`skills:read` 授权项目列表、选择、读取、计划和健康检查，`skills:write` 授权导入、应用、丢弃和修复。desktop renderer 默认拥有读写，`cli-local` v1 只读，并只允许 main 规范化后的 CLI cwd。所有读命令也限制在当前/最近面板上下文、本地环境索引、CLI cwd 或有效 `ProjectRootRef`，避免借读取接口遍历任意目录。命令统一进入现有 `PIER.COMMAND_EXECUTE`，不新增平行 IPC 体系。

草稿只包含用户意图：Claude 适配布尔值、既有技能 id 的期望启用态、待添加 import token，以及待删除技能严格联合。普通删除为 `{ id }`；漂移内容删除必须为 `{ id, expectedActualTreeDigest }`，摘要由 main 快照提供并在确认后成为必填并发前置条件，不是 renderer 声明的新权威摘要。请求严格冻结为：

- `skills.plan({ projectRef, observedRevision, draft })`；
- `skills.apply({ projectRef, observedRevision, draft, planDigest, operationId, acknowledgements })`；
- `skills.repair.plan({ projectRef, observedRevision, continuationOf? })`；
- `skills.repair({ projectRef, observedRevision, operationId, repairPlanDigest, acknowledgements, continuationOf? })`；
- `skills.operation.status({ projectRef, operationId })`。

计划的每个 `confirmationRequirement` 都包含稳定 id、kind、精确相对目标和计划摘要。`acknowledgements` 必须逐项精确匹配 main 要求，并记录宿主确认交互生成的高熵 nonce；不接受自由文案或宽泛的“全部同意”。它是可信客户端的可审计用户意图，不是对恶意 renderer 的安全证明。`continuationOf` 只建立与同项目旧操作的因果关系；repair 始终使用新的 operation id，不能改变旧操作的幂等结果。main 必须从磁盘与 token 重新派生其余字段，renderer 不能覆盖。

`planDigest` 只摘要规范化草稿、`observedRevision`、有序目标操作、逐目标 Git 五态、确认要求和安全前置条件，不包含本地化文案、检查时间或其他易变展示字段。Git 项目中的任何投影删除都必须取得绑定精确路径和当前计划摘要的破坏性 acknowledgement，而不只针对 tracked/unknown；文案明确该路径若在应用前被跟踪会产生 Git 删除状态。apply 必须重新计划并比较摘要，清单提交前和实际 unlink 前还要重查并记录 Git 状态；最后检查后的状态瞬变仍由这份状态无关的精确路径删除授权覆盖。plan 不是可绕过最终校验的授权 token。

main 在应用、修复和恢复收敛后广播 `pier://project-skills:invalidated`，载荷只含项目身份和新 `observedRevision`。干净窗口自动刷新；有草稿的窗口保留草稿、禁用应用并提示重新载入。窗口重新聚焦时补做 revision 检查，以覆盖外部文件修改。

### 4.2 应用流程

1. `snapshot(projectRef)` 在项目读锁前有界等待已有恢复协调器；5 秒后仍未完成则返回带 operation id 的 `recovery-pending/operation-busy`。它本身不执行写恢复，取消读等待也不取消恢复事务。renderer 只保存请求代次、`observedRevision` 和草稿。
2. `import.prepare(projectRef)` 在 main 内选择目录并复制到 `{userData}` 私有暂存区，返回绑定项目、窗口、调用方和树摘要的单次 token；不修改项目。
3. 草稿变化后防抖调用 `plan(...)`。main 在读锁内重新核验根、库、清单、账本和目标，并按“拟议操作完成后的状态”判断 `applicable`。能够消解问题的停用、关闭适配或删除不应被问题本身阻断；只有计划会保留或扩大阻断状态时才禁止应用。
4. `apply(...)` 取得跨进程项目锁和共享 `FilePathTransactionLock`，再次计算 `observedRevision` 与 `planDigest`。任一不匹配均在项目写入前返回结构化冲突。
5. main 创建耐久恢复日志，在第一次项目写入前把所用候选从 `AVAILABLE` 耐久条件推进为 `CLAIMED(operationId)`，再发布导入内容。清单提交前做最后一次比较交换校验：清单对象身份和摘要、全部相关库摘要、受管祖先身份、待删除目标的 Git 状态，以及计划要替换或删除的目标前置条件必须仍与计划相同；随后按 `ExpectedFileState` 耐久条件发布清单。任一条件变化都返回提交前冲突，不能覆盖外部编辑。
6. 清单提交后逐目标校正投影、提交所有权状态和清理不再引用的库内容。
7. main 持久化幂等结果、清理精确暂存对象并广播失效事件。renderer 收到服务端新快照后更新界面。

### 4.3 耐久事务状态机

清单耐久发布是唯一提交点；恢复日志必须在第一次项目写入前写入并同步文件与父目录。

```text
PREPARED
  → CONTENT_PUBLISHED
  → MANIFEST_COMMITTED       # 唯一提交点
  → RECONCILING_TARGETS
  → OWNERSHIP_COMMITTED
  → FINALIZED
```

恢复日志记录 schema、operation id、项目身份、前后 revision、请求摘要、计划摘要、暂存对象身份、目标前置条件和逐项阶段。每次阶段推进都使用耐久写入；项目内容和清单发布后同步文件及相关父目录。


| 故障位置                             | 对外结果                             | 恢复动作                                                            |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `MANIFEST_COMMITTED` 前且精确清理完成    | typed error，`not-applied`        | 回滚日志能证明身份的新发布库对象，释放候选 claim，保留草稿和 token                         |
| `MANIFEST_COMMITTED` 前但清理结果不明或失败 | 即时 `indeterminate`               | 保留非终态日志；恢复后只能终结为 `not-applied` 或 `recovery-blocked`，不能假装项目完全未变化 |
| 提交点后，进程仍能确认部分目标失败                | 不可变终态 `degraded` 与已提交的新 revision | 结束原 operation；后续由新的 repair operation 携带 `continuationOf` 校正     |
| 提交点后崩溃，尚未生成终态结果                  | 查询为 `pending/recovering`         | 恢复协调器在同一 operation 内向前重放，最终只生成一次不可变终态                           |
| rename 已发生但父目录同步失败等无法判定场景        | `indeterminate`                  | 禁止第二次写；重新读取与恢复后只能归约为已提交、未提交或 `recovery-blocked`                 |
| 日志、账本或对象身份不一致                    | 阻断态                              | 隔离损坏本机记录；不覆盖、不采用、不删除项目目标                                        |


具体顺序和删除约束：

1. 项目库暂存与投影暂存都位于各自目标的同一父目录；暂存对象身份先写入恢复日志。
2. 新库目录以不覆盖方式发布。若提交点前崩溃，只有恢复日志精确匹配的对象可以回滚。
3. 清单条件前置为 `ExpectedFileState = absent | present(identity, digest)`：首次创建使用 absent + 不覆盖发布，已有清单使用 present + `publishReplaceIfUnchanged`，耐久成功后进入 `MANIFEST_COMMITTED`。S0 必须证明两类线性化点、冲突回滚、同步和回滚失败语义；若无法对不合作外部写者提供强条件替换，必须收窄承诺并停在 S0。
4. v1 的投影没有“覆盖更新”：目标缺失时使用保留暂存对象身份的 `publishNoReplace` 创建；目标是账本中完全相同的链接时 no-op；其他任何现存对象都阻断。删除只允许删除账本身份完全匹配的对象。普通覆盖式 `rename` 禁止使用。
5. 账本提交后，才能删除不再被清单或任何未完成投影引用的库目录。投影删除失败时宁可保留库孤儿，不制造悬空链接。
6. `FINALIZED` 后操作记录改为不可变幂等结果；同 `operationId`、同请求摘要永远返回原终态，同 id 不同请求拒绝。`degraded` 也是终态，不能被恢复协调器改写为 `converged`；IPC 响应丢失不会导致重复提交。

Git 项目投影删除的确认必须在提交点前耐久写入 apply 日志，绑定 `planDigest`、精确相对目标、确认 nonce 和当时对象身份。已提交 apply 若在删除前崩溃，恢复协调器可以且必须重放这项已确认的精确删除；这不是产生新的删除决策。对象身份或确认记录无法证明时保留目标并终结为 `recovery-blocked`；否则 Git 状态后来改变也不撤销用户对该精确路径的删除授权。后续残留由新的显式 `skills.repair.plan → skills.repair` 重新取得确认。

已提交 apply 在恢复前若发现清单又被 Git 或编辑器改成另一 revision，不再执行旧清单尚未完成的目标操作；先按恢复日志精确对象身份结算已发生变化和所有权，原 operation 终结为 `degraded`，再由新 repair operation 按当前清单重计划。只有对象身份或耐久结果无法证明时才进入 `recovery-blocked`。

`operationId` 使用带时间的高熵 UUIDv7；首次提交只接受签发时间前后 5 分钟内的新 id，允许的本机时钟偏差为 30 秒。检测到超过该范围的时钟回拨或跃迁时暂停接受新 id，提示校正系统时间。每个项目至少完整保留最近 128 条结果；更旧结果可压缩为只含 id、请求摘要、终态和完成时间的已使用 tombstone，tombstone 保留 30 天，远长于首次接受窗口。未完成或被恢复引用的记录不参与清理；写入速率和本机状态总配额共同保证 30 天 tombstone 集合有界。已用但完整结果过期时返回 `operation-result-expired`，无记录且超出首次提交窗口的 id 也返回该错误，绝不因清理旧结果而重新执行。`skills.operation.status` 只读，不触发恢复；恢复协调器是唯一能在没有新写请求时推进已有事务的组件。

### 4.4 纯校正事务

`skills.repair` 和启动前 `ensureReady` 不改变清单，只把实际投影和 `ownership.json` 收敛到已提交清单。显式 repair 必须先取得 `skills.repair.plan`；后台 ensureReady 只执行不需要新用户确认的校正。它们同样必须持跨进程项目锁、使用 operation id、在第一次目标写入前写耐久日志，并采用独立状态机：

```text
PREPARED
  → MANIFEST_CONFIRMED
  → RECONCILING_TARGETS
  → OWNERSHIP_COMMITTED
  → FINALIZED
```

`MANIFEST_CONFIRMED` 固定项目身份、清单身份/摘要、库摘要和目标前置条件。校正中崩溃不允许回写清单，也不能把旧计划套到新清单；`ownership.json` 只在目标结果耐久后按预期 generation 条件推进。

纯校正故障边界：首次目标写入前失败是 `not-applied`；任一目标已耐久变化但未完全收敛时可生成不可变终态 `degraded` 和当前权威快照；同步结果不明时即时返回 `indeterminate`，operation 查询表现为 `pending/recovering`，最终归约为不可变终态。若恢复前清单已经变化：尚未写目标的旧操作终结为 `not-applied`，原因是 `superseded`；已经写过目标的操作只按日志精确对象身份结算当前所有权，不再执行旧计划，终结为 `superseded` 并携带 `hadDurableTargetChanges: true` 和当前权威快照，随后由新 repair operation 按新清单重计划。只有对象身份无法证明时才是 `recovery-blocked`。

一致性规则：

- `revision-conflict`、`plan-stale`、`content-conflict`、`token-expired`、`operation-busy` 和校验失败都是提交前 typed error，项目状态不变；`ApplyResult` 只承载 `converged/degraded/indeterminate`。
- `converged` 和 `degraded` 必须携带已确认 revision 与权威快照；`indeterminate` 是写调用的即时非终态结果，只携带最后确认的旧 revision、可能的新清单 revision 和 operation id。随后 `skills.operation.status` 只显示 `pending/recovering`，直到生成一个不可变终态；renderer 不能把猜测的快照展示为已应用状态。
- 进程内锁必须复用 app-core 注入给文件服务的同一个 `FilePathTransactionLock`，一次取得项目根和本机状态相关路径，禁止嵌套反序获取。跨进程锁位于固定的每用户共享锁根，不随 stable/dev `userData` profile 变化，以稳定项目身份为键。
- 跨进程锁记录随机进程实例、PID、进程启动身份和心跳；只有能证明原进程已不存在才能接管。交互等待 5 秒后返回 `operation-busy`，不得按超时强行破锁。
- snapshot、doctor、plan 与项目列表懒加载也必须等待写事务，或使用前后 generation 一致性重试；不得观察“新清单 + 旧投影 + 旧账本”。
- `skills.doctor` 和 snapshot 始终只读。只有应用、修复、启动前校正，以及继续已提交操作的恢复协调器可以改变磁盘；恢复不是 doctor 的隐式副作用。
- 窗口在提交点后关闭只脱离等待，不能取消 main 事务；重新打开通过 operation id 和快照恢复结果。
- 禁用保留库内容；删除经过破坏性小确认，并携带当前 `observedRevision`。若库已经漂移，确认文案必须明确“将删除导入后被外部修改的当前内容”，删除意图回显 main 观察到的实际树摘要；确认后内容再变化会触发 `content-conflict`，不能递归删除新内容。

## 5. 适配、健康和启动

### 5.1 投影与健康

所有 `enabled=true` 技能投影到 `.agents/skills/<id>`；`delivery.claude=true` 时额外投影到 `.claude/skills/<id>`。v1 不额外创建 `.cursor/skills`；Cursor 对 `.agents` 的实测不通过时报告版本不支持，不猜测补路径。

目标已存在非托管同名条目时跳过且不覆盖。Claude 适配开启后，OpenCode 等同时扫描两个根的智能体可能重复发现，必须报告 `duplicate-discovery`，不能显示全绿。

健康问题必须带 severity、`blockingScopes`、repairable 和 scope，不能让 renderer 自行猜测。健康描述当前事实，计划再根据拟议操作后的状态计算是否可应用；“阻断启用或启动”不等于“阻断用于消解问题的停用、关闭适配或删除”。最低映射如下：


| 健康码                                                                                           | 严重度 | 阻断与修复语义                                                                            |
| --------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------- |
| `disabled`、`adapter-disabled`、`agent-not-installed`、`not-applicable`                          | 信息  | 不阻断；不创建投影或不参与该智能体启动门                                                               |
| `new-session-recommended`、`git-visible-projection`、`git-tracked-projection`、`cleanup-pending` | 提醒  | 不阻断；给出会话或 Git 行为说明。tracked 目标的移除必须进入显式破坏性确认，不能由校正自动执行                              |
| `projection-missing`、`projection-stale`、`recovery-pending`                                    | 警告  | 阻断受影响智能体启动；仅在身份和前置条件匹配时可自动修复                                                       |
| `missing-source`、`invalid-skill`、`library-drift`、`content-conflict`                           | 错误  | 阻断启用、保留和受管启动；不得静默采纳当前内容，但允许显式删除来消解问题                                               |
| `unmanaged-conflict`、`managed-target-modified`                                                | 错误  | 阻断需要创建、保留或删除不确定目标的计划；仅当停用或清单清理完全不触碰该目标时允许，不可强制修复                                   |
| `project-identity-changed`                                                                    | 错误  | 当前 `ProjectRootRef` 的全部读写失效；只能重新定位项目或返回列表                                          |
| `ledger-corrupt`、`recovery-record-corrupt`、`recovery-blocked`、`durability-unknown`            | 错误  | 阻断项目全部写入和受管启动，保留所有项目目标                                                             |
| `filesystem-unsupported`、`permission-changed`、`insufficient-space`、`operation-busy`           | 错误  | 当前操作阻断；前两者保持只读，空间与忙碌可在条件改变后重试                                                      |
| `duplicate-discovery`、`agent-version-unsupported`、`unknown-agent-behavior`                    | 错误  | 阻断会保留该行为的计划和对应智能体启动；关闭 Claude 适配等能消解问题的计划允许应用；未声明适用的 AgentKind 使用 `not-applicable` |


只有真实启动探测才能证明智能体行为；目录存在只能证明磁盘状态。适配注册表必须记录发现根、同名处理、刷新方式、最低版本、核验日期、官方链接和实测版本。

清单存在性采用严格三态，不能把“不存在”与“空”混为一谈：

- 有效清单且启用集为空：安全删除账本证明且未修改的全部投影；保留库内容和非托管目标。
- 无清单且无账本、无恢复日志：no-op。
- 无清单但存在账本或恢复日志：视为分支切换或派生残留，按可信记录安全清理；任何身份不确定项阻断并报告。
- 清单语法或 schema 无效：阻断，不得按空清单处理。

### 5.2 启动链路

技能硬门不放在只收到 `agentId` 的 `agents.prepareLaunch`，也不散落在 renderer 动作中。唯一硬门位于 main 的终端创建公共链路：此时已经从 launch 请求解析出 `agentId`，也已经从 panel context 解析出规范化 `ProjectRootRef`，但尚未注册 native launch 或 spawn。

所有能产生智能体 launch 的受管入口都必须汇入该边界，包括新建智能体终端、`terminal.open` launch、worktree 打开终端、重试/重启和恢复后重新创建；普通 shell、无 launch 的终端和用户在 shell 中手动运行智能体不属于受管入口。新增入口必须通过架构测试证明没有绕开公共边界。

1. main 根据 `agentId` 查适配注册表。只有明确声明消费 `.agents` 或 `.claude` 投影的适配器参与硬门；其余现有 `AgentKind` 返回 `not-applicable`，不阻断也不承诺可见性。
2. 公共边界先生成稳定且高熵的 `launchAttemptId`，并把规范化 launch 参数留在 main；恢复后重新创建也生成新的 attempt。`ensureReady(projectRef, agentId, launchAttemptId)` 在项目锁内先由恢复协调器收敛未完成事务，再按清单三态校正；健康且实际状态一致时不写盘。
3. 版本探测默认 2 秒超时，整个启动校正默认 10 秒；超时返回结构化阻断，不能无限挂起。
4. 可安全修复的投影缺失或陈旧在同一锁内同步校正；非托管冲突、内容漂移、账本/恢复损坏和未知耐久状态默认阻止启动。
5. 最后一次目标与 revision 核验通过后，main 持锁调用 native 注册/spawn；spawn 明确接受后才释放，禁止在检查和 spawn 之间留下可写竞态窗口。
6. 启动硬门只返回严格联合 `LaunchGateResult = { status: "ready" } | { status: "blocked", launchAttemptId, challenge, issueSummary, expiresAt }`。`challenge` 是 main 保存的待启动记录句柄，不暴露规范化命令；记录绑定项目身份、agent id、发起窗口/client、`panelId`、renderer route identity、预期 surface generation/lifecycle、规范化 launch 参数、健康 revision 和有序问题集合摘要。
7. 阻断结果返回 renderer 等待用户时释放项目锁。用户只能调用 `terminal.launch.continue({ launchAttemptId, challenge, decision })`，其中 `decision` 为 `open-settings/degrade/cancel`。`open-settings` 和 `cancel` 都耐久标记该 attempt 已取消并清除待启动记录；`degrade` 才签发并在同一 main 调用内消费 `LaunchDegradeToken`，renderer 永远拿不到可重用 token。
8. `degrade` 重新取得锁并核对项目身份、agent id、attempt id、窗口/client、panel/surface 代次、健康 revision、问题集合和待启动参数完全一致。随后先耐久条件推进 `PENDING → SPAWN_INTENT`，再 spawn，最后记录 `SPAWN_ACCEPTED` 或 `SPAWN_FAILED`；`SPAWN_INTENT` 后任何重放都拒绝。若在 intent 后、确认 spawn 结果前崩溃，不自动再次 spawn，返回“启动结果不确定”，用户只能新建 attempt。native terminal 注册表也以 attempt id 去重。
9. challenge 默认 2 分钟过期且单次消费；状态变化、超时、窗口/panel 销毁、panel 复用、surface generation 改变、重放、换项目或换 agent 都使其作废并返回最新阻断结果。`SPAWN_INTENT` 诊断记录不参加普通过期清扫。
10. main 不在 spawn 后后台补投影。降级选择写入本机操作日志，但不成为持久忽略规则。

`terminal.launch.continue` 使用严格 schema，只允许 `desktop-renderer` 和原发起 client 调用，复用既有 terminal launch 写权限，不归入 `skills:read`。blocked 期间 provisional panel 显示不可交互等待态；取消或打开设置后关闭尚未创建 native surface 的临时 panel，降级成功才在同一 panel/surface 代次完成创建。

普通 shell 中用户稍后手动运行智能体时，Pier 无法识别启动时刻，因此应用是主要一致性保证。文案不得声称所有外部启动都经过 Pier 校正，也不得为技能设置配置根重定向变量。

## 6. 安全约束

### 6.1 路径和导入

- `projectRootPath` 必须存在并经 `realpath` 规范化；所有命令重新核对 `ProjectRootRef`，不能只在目录选择时校验一次。
- `.pier`、`.pier/skills`、`.agents`、`.agents/skills`、`.claude` 和 `.claude/skills` 每级现存祖先都用 `lstat` 核对为真实目录，拒绝符号链接、reparse point 和非目录。每个发布边界再次核对项目根与祖先身份。
- 项目相对路径拒绝绝对路径、`..`、空段、NUL、控制字符、超长路径，以及大小写折叠或 Unicode 规范化后的重复目标。
- `skills.import.prepare` 自己打开 main 原生目录选择器；renderer 不提交导入绝对路径或中间“源 token”。
- 导入源不得位于当前项目的 `.pier/skills`、任一发现投影根或本机 staging 内，也不得与目标库目录是同一文件身份，防止递归导入和自覆盖。
- 导入遍历逐项不跟随：`lstat` 后以 `O_NOFOLLOW` 打开普通文件并用 `fstat` 核对设备、inode 和类型；平台没有该标志时使用 `lstat → open → fstat` 等价校验。每个文件在复制前后比较 `dev/ino/type/size/mtimeNs/ctimeNs`，每个目录比较身份、元数据和排序后的条目集合。
- 首次复制完成后必须对源树做第二次完整只读遍历；路径集合、对象身份、元数据和逐文件摘要必须与首次遍历完全相同，才发布候选。任一变化返回 `source-changed` 并销毁精确暂存对象，避免把一次持续变化的目录拼成从未真实存在过的混合快照。
- 符号链接、硬链接、设备、FIFO、socket 和其他特殊文件一律拒绝；不保留时间戳、ACL、扩展属性、setuid 或 setgid，只保留“可执行/不可执行”语义。
- 默认限制集中定义在共享契约：最多 2,000 个文件、目录深度 32、单文件 16 MiB、总计 128 MiB、相对路径 UTF-8 长度 1,024 字节。候选暂存总配额 512 MiB；达到上限先回收已过期且有可信记录的候选，否则拒绝新导入。
- YAML frontmatter 最多 64 KiB、最大嵌套深度 16、禁止 alias/anchor、禁止自定义 tag，并使用不构造任意对象的安全解析模式；Pier 不执行未知字段、标签、表达式或动态代码。
- apply 消费候选前重新计算暂存树摘要；与 `ImportCandidateView` 不符时返回 `content-conflict`。同样的无链接、无特殊文件和树摘要检查也用于项目库。
- 投影只能是指向同一项目 `.pier/skills/library/<id>` 的相对目录符号链接；绝对链接和逃出项目根的链接拒绝。

### 6.2 内容信任、覆盖和删除

技能可能包含脚本、动态命令和工具权限提示，Pier 不把它们变成沙箱。导入确认必须展示来源、文件数、摘要以及 scripts、动态命令、`allowed-tools` 等风险；用户确认只表示接受内容风险。健康检查可以提示风险，但不能声称完成恶意代码检测。

防护范围是恶意或意外的项目内容、普通外部编辑、竞态、Pier 多实例、崩溃和误操作；不防同一操作系统用户下的恶意进程、已获得 renderer 任意代码执行的攻击者或被攻破的操作系统。capability 和账本是工程与所有权边界，不是恶意代码沙箱。

不静默覆盖、采用或删除非托管目标。新增目标必须使用真正的不覆盖发布；删除必须同时核对账本、对象身份、链接目标、项目身份和当前 revision。任一检查失败都保留用户文件。远程技能和市场不得复用本地导入的信任模型。

### 6.3 资源、清扫和可观测性

- import token 高熵、单次消费，绑定 webContents、client instance、项目身份和候选摘要；固定有效期 30 分钟。设置窗口存活不自动无限续租，过期后必须重新选择。
- 候选状态机为 `AVAILABLE → CLAIMED(operationId) → CONSUMED`，或在提交前失败后从原 operation 精确释放为 `AVAILABLE/RELEASED`。claim、discard、TTL 清扫和 apply 受同一项目锁及条件 generation 约束；discard 和清扫只能删除 `AVAILABLE/RELEASED`，绝不删除 `CLAIMED`。清单提交后，候选只能由原 operation 的恢复流程标记消费和清理。
- `skills.import.discard` 幂等。renderer 崩溃或迟到响应产生的候选由 main 清扫器按可信 token 记录回收；项目内临时项只按恢复日志的精确路径和对象身份清理，禁止按名称前缀扫描后递归删除。
- renderer 从草稿移除待导入项、放弃/重新载入草稿、返回导入检查或关闭设置时，都必须对不再引用的候选调用 `skills.import.discard`。discard 失败不阻止离开，因为 TTL 清扫仍会回收；短失败用 `toast.error`，含技术详情用 `showAppAlert`，并记录待清扫状态。
- 不可访问项目的账本和恢复日志长期保留；只有用户未来通过独立设计的“忘记项目”动作才能删除，本版不提供该动作。
- 空间预检只改善提示，不是保证。`ENOSPC`、`EDQUOT`、`EACCES`、`EPERM`、`EROFS`、`EXDEV` 和目录同步失败都映射为稳定错误码；旧内容和旧账本在新状态确认耐久前不得删除。
- 本机操作日志记录 operation id、阶段、revision、耗时、目标相对路径和 errno；不记录技能正文、token、绝对暂存路径或敏感 frontmatter。日志轮转不能删除仍被恢复记录引用的事件。

## 7. 设置界面和 Git

### 7.1 界面方向和信息架构

界面方向是“克制的桌面工具台”：以项目、技能和健康事实为主，不做数据看板、插画首屏或装饰性卡片。视觉记忆点来自清晰的状态轨道和固定操作栏，而不是新增颜色、渐变或动效体系。

- 设置 `Dialog` 继续使用现有 `90vw × 90vh`、最大 `1200 × 900` 的外壳；`md` 及以上使用左侧 160px 静态导航，在“环境”后新增“技能”；低于 `md` 时设置壳在内容上方提供完整栏目 `Select`，不能只隐藏侧栏。右侧只保留一个纵向滚动容器。
- 复用“环境”的一级项目列表 → 二级项目详情模式，不增加独立 dockview panel、项目注册表或多栏资源管理器。
- 项目详情固定为“投递路径 → 技能 → 发现健康 → Git 协作”的阅读顺序；顶部回答“正在管理哪个项目”，底部回答“有哪些未应用更改”。
- 12px 是区块间的基本节奏，单行控件统一为 28px；项目路径、技能 id、摘要和发现路径使用既有等宽字体，其余文字使用产品字体。
- 状态必须同时使用图标和文字，不得只靠颜色表达；所有颜色来自 `globals.css` 语义令牌和 `@pier/ui` 组件变体。
- 页面文案统一使用 `settings.skills.*` i18n key。“启用”表示下一次应用后的磁盘期望状态；涉及当前会话时始终写“新建会话后生效”。

界面只有三种页内模式，避免弹窗套弹窗：


| 模式   | 进入方式                                                                     | 退出规则                                             |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 项目列表 | 设置侧栏进入“技能”，且没有明确项目上下文                                                    | 选择已知项目，或用原生目录选择器临时打开其他项目                         |
| 项目详情 | 选择项目；`pier.skills.open({ projectRootPath, focusIssueIds? })` 时直接进入并可定位问题 | 无草稿直接返回；有草稿先经过三选离开守卫                             |
| 导入检查 | 项目详情点击“从本地导入”，main 返回有效暂存 token                                          | “添加到草稿”后返回详情；取消、超时或离开时调用 `skills.import.discard` |


删除确认、技术错误和启动阻断使用宿主 `AppDialogHost`。结构化内容较多的导入风险不能压成一段确认文案，因此使用页内“导入检查”，不新增业务 `Dialog`。

### 7.2 设置外壳和项目列表草图

`pier.skills.open` 优先打开当前面板的 `projectRootPath`；没有面板上下文时停留在项目列表。列表数据只来自 `skills.projects.snapshot`：main 将最近面板上下文与本地环境索引按项目身份去重，并以有界并发读取最近摘要；可见行的实时健康再懒加载。`skills.project.pick` 选中的其他目录只在本次设置会话中存在，不写成新的项目档案。

```text
┌────────────────────────────── 设置 ──────────────────────────────┐
│ 外观            │ 技能                              [选择其他项目] │
│ 终端            │ 管理项目级技能；不会写入用户级技能目录。        │
│ 工作区          │                                              │
│ 环境            │ ┌ 提示：应用后，新建智能体会话才能稳定生效 ─┐ │
│ 技能  ← 当前    │ └──────────────────────────────────────────┘ │
│ 快捷键          │                                              │
│ 智能体          │ 项目（3）                                    │
│ 插件            │ ┌ [当前] pier                    5 个 · 正常 ┐ │
│ 更新            │ │ /Users/xyz/ABC/pier                      › │ │
│                 │ ├ loomdesk                     2 个 · 1 警告 ┤ │
│                 │ │ /Users/xyz/ABC/loomdesk                  › │ │
│                 │ ├ scratch                        尚未配置     ┤ │
│                 │ │ /Users/xyz/ABC/scratch                   › │ │
│                 │ └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

项目列表使用 `ItemGroup`，其直接子元素必须是 `<li>`；每个 `<li>` 内的项目 `Item` 才以按钮呈现，避免生成 `<ul><button>`。行展示项目名、完整路径、清单中的技能数、最严重健康摘要和必要的“缓存/检查于”新鲜度；缓存摘要不能显示成实时正常。当前 `PanelContext` 项目带“当前”徽标并排在首位，其余项目按最近使用时间排列。尾部只有进入箭头，不放开关或写操作。

项目列表状态不能省略：

- 首次加载使用与最终列表同高的 `Skeleton`，避免内容跳动。
- 没有已知项目时使用 `Empty`，主动作是“选择项目目录”，说明该操作不会建立项目注册表。
- 单个项目读取失败仍保留该行并显示“无法读取”；进入后显示错误详情，不能让一个坏项目阻断整个列表。
- 原生目录选择器取消属于无操作，不显示 toast；返回无效或未授权目录时使用 `showAppAlert`。

### 7.3 项目详情草图

详情页是单列纵向布局。顶部项目标题随页面滚动；底部操作栏在右侧内容区内吸附，不能遮挡最后一项内容。页面不使用左右主从栏，避免在设置窗口较窄时压缩路径和错误说明。

```text
┌────────────────────────────── 技能 / pier ───────────────────────┐
│ [←] pier                                             [检查健康] │
│     /Users/xyz/ABC/pier                 上次检查：14:32 · 正常   │
│                                                                  │
│ ┌ 警告 / 错误（仅有问题时出现）───────────────────────────────┐ │
│ │ OpenCode 会从两个路径发现 review-guide。         [查看详情] │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 投递路径                                                         │
│ ┌ Codex / 通用路径 ─ .agents/skills ─────────── [默认，始终开启]┐ │
│ ├ Claude Code      ─ .claude/skills ──────────────── [Switch] ┤ │
│ │ 开启后可能被 OpenCode 重复发现；应用后写入受管投影。          │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 技能（5）                                      [从本地导入]      │
│ [搜索名称、描述或 id____________] [全部][启用][停用][有问题]   │
│ ┌ ● review-guide         本地导入       正常     [Switch] [⋯] ┐ │
│ │   Review changes against project rules                       │ │
│ │   .pier/skills/library/review-guide                         ▼ │ │
│ ├ ! deploy-helper         本地导入       1 个冲突  [Switch] [⋯] ┤ │
│ │   目标 .agents/skills/deploy-helper 已被其他工具占用。        │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 发现健康                                                         │
│ ┌ Codex       0.42.0  .agents/skills      正常                 ┐ │
│ ├ Claude Code 2.1.203 .claude/skills      正常                 ┤ │
│ ├ OpenCode    1.2.3   两个兼容路径         需要处理重复项        ┤ │
│ └ Cursor      未探测   .agents/skills      无法确认             ┘ │
│                                                                  │
│ Git 协作                                                          │
│ 版本化：.pier/skills/manifest.json、library/**                    │
│ 本机派生：2 个精确投影目标                    [复制忽略建议]      │
│                                                                  │
│ 更改检查（3）                                           [收起]   │
│ ┌ 启用 review-guide                                             ┐ │
│ ├ 停用 deploy-helper                                            ┤ │
│ └ 删除 tracked 投影 .agents/skills/deploy-helper     [需确认] ┘ │
│                                                                  │
│ ═ 3 项未应用：启用 1 · 停用 1 · 新增 1   [放弃更改] [应用更改] ═ │
└──────────────────────────────────────────────────────────────────┘
```

#### 顶部和全局状态

- 返回按钮回到项目列表；项目名截断但完整路径可选中复制，不用 Tooltip 承载唯一信息。
- “检查健康”只调用 `skills.doctor`，不写盘。检查中保留旧结果并显示进行状态；响应接收统一遵循第 7.5 节的分命令规则。
- 最近一次检查时间来自当前快照，不能用 renderer 当前时间伪造。
- `degraded`、`indeterminate`、revision 冲突、清单无效、项目只读和非托管冲突使用页面顶部 `Alert`。Alert 只展示状态和详情，不放第二个“修复”主动作。
- 清单无法解析时进入只读故障态：保留项目头和错误 `Alert`，隐藏编辑控件，只提供“重新检查”和“复制错误详情”。项目根在打开期间消失、移动或卸载时同样保留项目头，显示“项目不可用”，提供“返回项目列表”和“重新选择目录”，不得伪装成没有技能。

#### 投递路径

- `.agents/skills` 是固定默认路径，以只读 `Item` 展示“始终开启”，不渲染一个不可操作的假开关。
- `.claude/skills` 是唯一可编辑适配开关；副文案同时说明新增投影和潜在重复发现。
- 开关只更新草稿。关闭 Claude 适配时，受管 Claude 投影在下一次应用中安全删除；非托管冲突继续保留并报告。
- v1 不展示可开启的 Cursor 或 OpenCode 投递开关。这两类智能体只在“发现健康”中展示实际探测结果，防止界面暗示不存在的投递能力。

#### 技能工具栏和列表

- 搜索使用 `InputGroup`，匹配 `id`、`name` 和 `description`；清除按钮有可访问名称。筛选使用单选 `ToggleGroup`：“全部 / 启用 / 停用 / 有问题”。搜索和筛选只改变当前视图，不改变草稿。
- 工具栏下方始终显示“当前结果数 / 总数”；没有技能时使用带“从本地导入”动作的 `Empty`，没有搜索结果时使用带“清除筛选”的 `Empty`，两者文案不得混用。
- 技能 `ItemGroup` 的直接子元素也必须是 `<li>`；`Item` 是非按钮容器。名称区域是 `CollapsibleTrigger`，`Switch` 和菜单是同级交互控件，禁止把开关或菜单嵌套进整行 `<button>`。
- 主行依次展示状态图标、名称、来源、健康摘要、启用开关和菜单。描述与库相对路径在第二行；名称或描述缺失时显示明确的校验问题，不用 `—` 掩盖。
- 展开区展示来源类型、短摘要、文件数与总大小、frontmatter 风险和各投影目标状态。项目级说明已经覆盖新会话语义，只有该技能存在 `new-session-recommended` 时才在行内重复。摘要可复制，完整内部账本和绝对暂存路径不暴露给 renderer。
- 开关的可访问名称为“启用/停用 {skillName}”。`invalid-skill`、`missing-source` 等不能安全启用的条目禁用开关，并在同一行给出原因，不能只放在 Tooltip。
- 菜单 v1 只含“复制库路径”和“删除”。删除先调用 `showAppConfirm({ size: "sm", intent: "destructive" })`；漂移技能的 body 必须额外说明会删除外部修改后的当前内容。确认后标记为待删除并从默认列表移出，底部更改摘要提供“撤销删除”。真正删除发生在应用阶段，main 仍重新核对确认时的实际摘要。
- 每次草稿变化都由 `skills.plan` 返回新的问题、差异、确认要求和 `planDigest`。计划进行中显示短状态，旧计划不得标为当前；“应用更改”只由与当前草稿匹配的最新 `plan.applicable` 决定是否可用。原始健康问题只决定提示和具体控件，不能自行否决一个会消解问题的计划。

#### 发现健康和 Git 协作

- 发现健康按适配注册表稳定排序，每行展示智能体、探测版本、实际扫描路径、健康文字和会话影响。未安装、未探测、版本不支持和行为未知是不同状态。
- 一个技能在多个活动根被同一智能体发现时，智能体行显示汇总警告；展开后列出具体技能和路径，不用一个泛化的“异常”。
- 普通 `projection-missing`、`projection-stale` 在健康区提供一个“检查并修复”入口；它先调用 `skills.repair.plan`，如有 tracked 删除等确认要求，则在正常文档流的更改检查区展示精确路径并取得破坏性确认，再调用 `skills.repair`。`degraded` 时由固定操作栏持有唯一主修复动作，两者共享同一个 pending 状态。存在草稿、导入候选、过期候选或任一写操作 pending 时，所有修复入口禁用并说明先应用或放弃当前更改；非托管冲突没有“强制修复”。
- Git 区块只在 Git 项目显示版本化文件、投影当前 absent/ignored/untracked/tracked/unknown 状态和精确忽略建议；非 Git 目录显示“此项目未使用 Git”，不显示无效复制动作。

### 7.4 导入检查草图

点击“从本地导入”调用 `skills.import.prepare`；该命令在 main 内打开原生目录选择器并生成候选。成功后切换到页内检查模式；此时项目没有任何变化。

```text
┌────────────────────────── 检查导入内容 ──────────────────────────┐
│ [←] review-guide                                                 │
│     来源：/Users/xyz/Downloads/review-guide                       │
│                                                                  │
│ ┌ review-guide · Review changes against project rules ────────┐ │
│ │ 18 个文件 · 84 KB · sha256:8ea7…91c2                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 内容                                                             │
│ SKILL.md · scripts/ 3 · references/ 9 · assets/ 5                │
│                                                                  │
│ ┌ 风险提示 ────────────────────────────────────────────────────┐ │
│ │ • 声明 allowed-tools: Bash, Read                            │ │
│ │ • 包含 3 个脚本和 1 处动态命令                              │ │
│ │ Pier 只检查结构，不保证这些内容安全。                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 初始状态：停用；添加后可在项目详情中启用。                       │
│                                      [取消] [添加到草稿]          │
└──────────────────────────────────────────────────────────────────┘
```

- 检查页展示规范化 id、名称、描述、用户选择的来源路径、文件数、总大小、短摘要、目录构成和全部已识别风险；长文件清单不在 v1 展开成文件浏览器。
- 新导入技能默认停用，避免“检查内容”和“允许新会话加载”被一次点击合并。按钮必须写“添加到草稿”，不能写“安装完成”或“立即生效”。
- 结构无效、大小超限、含符号链接或特殊文件时显示错误 `Alert`，禁用“添加到草稿”，保留“取消”。
- 与技能库 id 冲突时不提供覆盖或自动改名；展示现有技能名称并允许返回详情定位该条目。与发现目标的非托管冲突可以添加为停用草稿，但启用时必须显示冲突计划。
- 添加成功返回项目详情，新条目带“待添加”状态并出现在更改摘要中；已有明显列表变化，不显示 toast。
- 进入检查页前已有的项目草稿继续保留。候选只有在导入检查页存活；返回详情或取消检查必须先幂等丢弃候选，并保留进入检查前的原草稿。“应用并离开”只应用原草稿并丢弃候选；候选过期后保留检查摘要、禁用“添加到草稿”，提供“重新选择”。

异步组合状态固定如下：


| 状态                          | 离开或迟到结果规则                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dirty + candidate`         | 只允许在导入检查页短暂共存；返回详情、取消或离开先 discard candidate，再保留并处理原草稿                                                        |
| `dirty + candidate-expired` | 保留原草稿；候选只能重新选择或丢弃                                                                                            |
| `prepare-pending + leave`   | 记录请求代次并允许离开；迟到候选立即调用 discard，不进入已卸载页面                                                                        |
| `apply-pending + leave`     | 不发起第二次 apply；`converged` 才执行已请求导航，`not-applied/degraded/indeterminate` 取消离开并留在详情；只有操作系统强制销毁窗口时脱离等待，main 继续事务 |


### 7.5 固定操作栏、离开守卫和异常恢复

底部操作栏是草稿的唯一提交入口：

- 无草稿时显示“没有未应用更改”和最近应用结果；“应用更改”禁用，“放弃更改”隐藏。
- 有草稿时按“新增 / 启用 / 停用 / 删除 / 投递设置”汇总数量；完整的逐项检查与撤销区放在正常文档流、紧邻操作栏之前，按类别折叠。固定栏只显示计数和“查看更改”锚点，不能无界展开成第二滚动区。
- 逐项检查区同时承载 `confirmationRequirements`：Git 项目中的每个投影删除都逐条显示精确相对路径、当前 Git 五态及“应用前被跟踪也会删除”的说明，漂移删除显示当前实际摘要。点击“应用更改”时只对尚未确认的要求弹出一次破坏性小确认；确认结果生成逐项 acknowledgement，计划变化后全部失效。repair 计划复用同一区域，不新增第四种页面。
- 应用中冻结所有写控件，按钮显示进行状态；搜索、展开详情和复制仍可用。不能通过关闭页面发起第二次应用。
- `converged` 后以服务端新快照替换草稿，清除 dirty，并使用 `toast.success(t("settings.skills.applySuccess"))`。
- `degraded` 后保留服务端返回的新 revision，清除已经落盘的草稿，顶部显示持久 `Alert` 和逐目标结果；技术详情走 `showAppAlert`，操作栏主按钮改为“检查并修复”。点击后创建新的 repair operation，并用 `continuationOf` 关联原操作；原 degraded 结果永不变化。不得把原草稿原样重试成第二次期望写入。
- `indeterminate` 时保留 operation id，冻结全部写操作并显示“正在确认磁盘状态”；只有 main 恢复为明确结果后才能重新计划。
- revision、plan 或内容冲突时保留本地草稿但禁止应用，顶部提供“重新载入”。重新载入会丢失草稿，必须确认；v1 不做自动合并。
- 修复成功会明显更新健康列表，不加 toast；失败使用 `showAppAlert` 并保留原健康结果。

每类命令维护独立请求序号，不能用一条统一 revision 规则吞掉合法的新状态：

- plan/repair.plan：项目身份、该命令最新请求序号、请求基准 revision、`draftGeneration/draftFingerprint`（repair 无草稿时省略后两项）全部匹配才接收；
- snapshot/doctor：项目身份和该命令最新请求序号匹配即可；无草稿时采纳新 revision，有草稿时保留草稿并进入 stale/重新载入状态；
- apply/repair/operation.status：按项目身份和 operation id 接收严格结果，允许服务端返回新的权威 revision；
- prepare：按项目身份和 prepare 请求序号接收，迟到候选立即 discard。

读请求可以用 `AbortController` 取消展示，但 main 写事务不随 renderer 取消。所有写按钮共享单一 pending 状态。

临时 `ProjectRootRef` 授权过期时，页面显示“项目授权已过期”，保留 renderer 草稿但冻结写操作；用户重新选择到同一稳定项目身份后可重新签发引用并重新计划。若选择结果不是同一身份，则先丢弃未消费候选，再按离开守卫处理旧草稿，绝不把草稿移植到另一个项目。

从项目详情返回列表、切换设置栏目、关闭设置窗口或按 Escape 时，如果存在草稿，统一使用：

```ts
showAppChoice({
  size: "sm",
  intent: "destructive",
  confirmLabel: t("settings.skills.applyAndLeave"),
  altLabel: t("settings.skills.discardAndLeave"),
  cancelLabel: t("dialog.cancel"),
  // body 和 title 使用 settings.skills.*
})
```

“应用并离开”只有在 `converged` 后才继续导航；`degraded`、`indeterminate`、冲突或失败都留在详情页。“放弃并离开”丢弃 renderer 草稿和所有未消费导入 token。

设置外壳新增窄离开守卫接口，而不是让 section 在卸载后补救：

- `requestSectionChange(nextSection)` 和 `requestSettingsClose(reason)` 是侧栏、窄宽 Select、关闭按钮、Escape 与外部 `openSection` 的唯一入口。
- 当前 section 注册 `canLeave()` 与异步 `leave(intent)`；守卫完成前不得改变 `activeSection/isOpen`。
- 外壳只保留一个 `pendingDestination` 和 `leavePending`。连续点击不并发弹窗，后续目标按最后一次意图更新；apply 已在进行时只能等待或取消离开，绝不再次提交。
- section 只有在守卫完成后才能卸载；token discard 失败按第 6.3 节反馈和清扫，不阻止离开。

### 7.6 启动阻断界面

`ensureReady` 发现无法安全校正的问题时，不能只向终端打印错误。启动入口使用 `showAppChoice({ size: "default", intent: "default" })` 展示简短汇总：

```text
技能投递尚未就绪
2 个问题会影响新会话：1 个非托管目标冲突，1 个投影已被修改。

                         [        打开技能设置        ]
                         [          仍然启动          ]
                         [            取消            ]
```

- 按现有 macOS sheet 布局纵向排列：`confirm = 打开技能设置`、`alt = 仍然启动`、`cancel = 取消`。
- “打开技能设置”是主动作：取消本次启动，调用 `pier.skills.open({ projectRootPath, focusIssueIds })` 并把问题 `Alert` 滚入可见区域。
- “仍然启动”是显式降级动作：renderer 只回传 `launchAttemptId + challenge + decision`，由 main 在一次调用内签发并消费不可见的一次性 `LaunchDegradeToken` 后继续 spawn；文案说明本次会话可能缺少或重复技能，不能写“忽略错误”。按钮等待期间防重复提交，challenge 过期或状态变化时原弹窗关闭并展示最新阻断结果。
- “取消”和 Escape 都不启动。意外异常只显示本地化摘要；原始技术详情进入 `showAppAlert` 或日志，不塞进 toast。
- 弹窗期间对应 provisional terminal panel 显示“等待技能投递确认”，不接受输入；关闭/复用该 panel 会取消 attempt。打开设置或取消后关闭临时 panel；降级成功才把同一 surface 代次切换为真实终端。`SPAWN_INTENT` 后结果不明时显示不可重试错误，并提供“新建终端”以生成全新 attempt。

### 7.7 加载、空态、错误态和反馈清单


| 场景                 | 页面状态                       | 用户反馈                                                              |
| ------------------ | -------------------------- | ----------------------------------------------------------------- |
| 首次读取快照             | 与详情结构等高的 `Skeleton`；写操作不可用 | 不显示 toast                                                         |
| 切换技能或 Claude 适配    | 立即更新行状态和底部更改摘要             | 强自然反馈，不显示 toast                                                   |
| 导入准备               | 原生目录选择器后进入导入检查页            | 取消无反馈；失败用 `showAppAlert`                                          |
| 删除或撤销删除            | 列表与更改摘要同步变化                | 删除前破坏性小确认；不显示 toast                                               |
| 复制路径、摘要、错误或 Git 建议 | 页面没有自然变化                   | 成功使用 i18n `toast.success`；短失败用 `toast.error`，技术详情用 `showAppAlert` |
| 健康检查               | 保留旧结果，显示检查中；完成后更新状态与时间     | 成功无 toast；失败用 `showAppAlert`                                      |
| 应用成功               | dirty 清零、快照和健康更新           | `toast.success` 使用 i18n 短标题                                       |
| 应用部分失败             | 顶部 `Alert`、逐目标结果、操作栏改为修复   | `showAppAlert` 展示技术详情                                             |
| 耐久状态不明             | 页面冻结写操作并轮询恢复结果             | 持久 `Alert`，不显示成功或失败 toast                                         |
| 项目或清单只读            | 编辑、导入、删除和应用禁用；健康检查可用       | `Alert` 解释具体不可写路径                                                 |
| 项目消失、移动或离线         | 保留项目头，禁用写操作                | `Alert` 提供返回与重新选择，不显示空技能页                                         |
| 没有技能 / 没有筛选结果      | 两套不同 `Empty`               | 分别提供“从本地导入”/“清除筛选”                                                |
| 外部修改造成 revision 冲突 | 保留草稿，禁止继续应用                | 内联 `Alert`；确认后重新载入                                                |


### 7.8 响应式、键盘和组件约束

低于 `md` 时不是把左侧导航简单隐藏，而是使用完整栏目选择器；技能行和操作栏按以下顺序重排：

```text
┌────────────────────── 设置 ──────────────────────┐
│ 栏目 [技能                                      ▾] │
├──────────────────────────────────────────────────┤
│ [←] pier                              [检查健康] │
│ /Users/xyz/ABC/pier                              │
│                                                  │
│ [搜索名称、描述或 id__________________________] │
│ [全部] [启用] [停用] [有问题]                    │
│ ┌ review-guide                         [Switch] ┐ │
│ │ 本地导入 · 正常                         [⋯] │ │
│ │ Review changes against project rules         │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ 3 项未应用 · [查看更改]                           │
│ [        放弃更改        ] [       应用更改      ] │
└──────────────────────────────────────────────────┘
```

- 右侧内容宽度不小于 760px 时，技能主行使用“名称与描述 / 来源 / 健康 / 操作”四段布局；低于 760px 时来源和健康移到第二、三行，操作保持右上，不产生横向滚动。
- 固定操作栏在宽布局为单行；窄布局先显示变更摘要，下一行放等宽“放弃更改 / 应用更改”。导入检查页按钮同样允许换行。
- 项目路径、发现路径和错误文本允许换行或中间省略，完整值必须能复制；不能用扩大窗口作为查看完整信息的唯一方法。
- 搜索置于 `Field` 并具有可见或 `sr-only` 标签；筛选 `ToggleGroup` 具有组 `aria-label`。进入详情后程序化聚焦带 `tabIndex={-1}` 的项目标题；返回列表后恢复到原项目行；导入检查取消后恢复到“从本地导入”。折叠行通过 `aria-expanded` 表达状态。
- 页面只设置一个短文本 `role="status" aria-live="polite"`，列表本身不设 live，避免重复朗读。检查和应用中的按钮带进行状态并防止重复提交。图标按钮必须有 `aria-label`，Button 图标声明 `data-icon`。
- 滚动容器设置与固定操作栏实际高度一致的 `scroll-padding-bottom` 和内容尾部留白，键盘聚焦项、错误详情和深链问题不得被遮挡。
- 使用 `FieldSet` / `FieldGroup` / `Field`、`ItemGroup` / `Item`、`InputGroup`、`ToggleGroup`、`Collapsible`、`Alert`、`Empty`、`Skeleton`、`Switch`、`Badge`、`Separator` 和 `Button`。不直接渲染原生表单控件，不手写卡片、徽标、加载占位或固定色阶。
- 页面内部不新增全局快捷键。Tab 顺序遵循视觉顺序；Tooltip 只补充说明，不承载错误原因、路径或状态等必要信息。

### 7.9 Git 协作

推荐提交 `.pier/skills/manifest.json` 和 `.pier/skills/library/**`，推荐不提交发现投影。v1 不自动执行 Git 操作，因此用户采用忽略建议前，投影会真实出现在 Git 状态中；界面不得把“推荐”写成“已经忽略”。

Pier 不静默修改 `.gitignore`、`.git/info/exclude` 或 Git 索引，也不使用笼统的 `.agents/skills/**` 规则隐藏用户自有技能。设置页显示每个受管目标当前是 absent、ignored、untracked、tracked 还是 unknown，只对未跟踪的受管目标生成精确忽略建议，并提供一次复制全部建议的按钮；建议中不得包含非托管同名目标。

Git 状态不改变账本所有权，但 Git 项目中的任何投影删除都必须在现有逐项检查区列出精确路径和当前状态，并取得绑定当前计划摘要的破坏性 acknowledgement；计划变化后确认失效，单纯 Git 状态变化不撤销对该精确路径的删除授权。ensureReady 和没有 acknowledgement 的普通 repair 不得作出新的 Git 项目投影删除决定。唯一例外是恢复已提交 apply：其耐久日志已经包含仍匹配对象身份的原确认时，恢复协调器必须继续该精确删除。若清单/分支变化产生没有现存确认的残留，即使没有普通草稿，用户也可从健康区发起 `repair.plan`，确认后用新的 repair operation 收敛。

Git 区块同时说明：新 clone 只有技能库和清单，首次应用前，Pier 外启动的智能体可能看不到技能。该说明只出现一次，不在每个技能行重复。

若用户主动提交投影，另一台机器 clone 后没有对应本机账本，该链接会按非托管目标处理并阻断应用；Pier 不自动“认领”它。这也是推荐只提交清单和技能库的原因。

## 8. 明确禁止的反模式

- 内容常驻发现目录，只在 Pier 清单中标记 `enabled: false`。
- 仅凭项目内标记删除目录。
- renderer 逐项持久化开关，同时又保留应用草稿。
- spawn 后后台校正，并声称本次会话已经加载技能。
- 用文件消失证明已经从当前会话撤回技能。
- 对多个发现根重复投影，却不检查同名和去重语义。
- 把第三方工具的路径表当成智能体官方事实。
- 对非托管冲突静默覆盖、采用或删除。
- 把部分成功包装成完整成功。
- 自动修改用户 Git 忽略规则或用户级智能体配置。
- 在没有供应链设计时加入远程导入、更新或市场。
- 把整行 `Item` 做成按钮，再在其中嵌套 `Switch`、菜单或删除按钮。
- 为导入风险另开业务弹窗，或绕过 `AppDialogHost` 直接使用 `AlertDialog`。
- 为尚未验证的智能体展示可开启投递开关，或只用颜色表示健康结论。
- 使用多层滚动容器，让固定操作栏遮住最后一项技能或错误详情。
- 只用清单摘要作为并发 revision，或在普通应用中静默采纳库漂移。
- 在目标校验后使用普通覆盖式 `rename`，或只凭链接目标判定投影所有权。
- 为技能模块另建一把不与文件服务共享的进程内锁，或把 single-instance 当成跨 profile 项目锁。
- 把无清单、有效空清单和无效清单都当成 no-op，留下旧投影继续被发现。
- 在没有消费者闭环时预留插件贡献 API，或为未支持平台保留复制投影伪分支。

## 9. 最小实施方案

### S0：证据与契约

- 固化 Codex、Claude Code、Cursor、OpenCode 的官方发现记录和本机探测脚本。
- 枚举全部受管 launch 入口，证明 main 终端创建链路存在唯一最后公共硬门。
- 冻结严格数据结构、健康严重度、typed error、结果 union、草稿、计划、失效广播和幂等语义。
- 以原型和故障注入证明 macOS `publishNoReplace` 能保留暂存符号链接对象身份，`publishReplaceIfUnchanged` 能在外部编辑竞态下拒绝覆盖，并证明条件发布、文件同步和父目录同步的失败语义；不通过则不得进入 S1。
- 冻结树摘要、项目身份、可信账本、恢复状态机、导入上限、跨进程锁和清扫策略。

### S1：main 闭环

- 实现清单、本机状态、导入暂存、计划、应用、修复和只读健康检查。
- 从现有 durable I/O 先例提取 L1 通用原语，不从项目技能服务反向依赖文件草稿业务模块。
- 接入命令路由、权限、共享 `FilePathTransactionLock`、跨 profile 项目锁和失效广播。
- 先完成安全、并发、幂等、账本损坏和逐阶段崩溃恢复测试。

### S2：设置界面

- 按第 7 节实现项目列表、项目详情、导入检查、固定操作栏和窄离开守卫。
- 补齐窄宽设置栏目选择器、草稿计划、撤销、健康展开、Git 建议、请求代次和异常恢复。
- 完成操作反馈、i18n、键盘焦点、窄宽布局、shadcn 治理和组件测试。

### S3：启动闭环

- 在 main 终端创建最后公共边界接入 `ensureReady`，并以架构测试覆盖所有受管入口。
- 完成阻止启动、一次性降级 token、保守会话提示、超时和真实探测。
- Cursor 仅在版本证据充分时纳入健康承诺。

S0 至 S3 全部完成后才称为 v1 闭环。非目标能力必须分别经过架构与安全审查。

## 10. 需求到证据的验收矩阵


| 需求                | 验证方式                                       | 预期证据                                                                                                               |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 清单严格校验            | `project-skills-contract.test.ts`          | 非法或重复 id、未知清单字段、name 不匹配均拒绝；厂商 frontmatter 保留但不执行                                                                  |
| 草稿和计划权威           | `settings-dialog-skills.test.tsx`、路由测试     | Switch 只调用 `skills.plan`；renderer 不能提交来源、摘要或投影结论；只有 apply 改变期望状态                                                   |
| 三种页内模式            | `settings-dialog-skills.test.tsx`          | 项目列表、项目详情和导入检查的进入、返回、焦点恢复与 token 清理均可复现                                                                            |
| 项目定位和汇总           | renderer store 与命令测试                       | main 合并项目来源并有界摘要；当前项目直达；临时 `ProjectRootRef` 不建立项目注册表                                                               |
| 技能列表布局            | 组件测试、无障碍查询                                 | 搜索和四种筛选正确；技能行无嵌套交互元素；状态、描述、路径和操作不缺失                                                                                |
| 导入风险检查            | renderer 组件测试、导入服务测试                       | 导入前展示来源、摘要、规模、目录构成和风险；新技能默认停用；无效候选不能加入草稿；返回/取消会丢弃候选而保留原草稿                                                          |
| 离开守卫              | `settings-dialog-skills.test.tsx`          | 返回、换栏目、关闭、Escape、外部深链和重复点击都先经过单一异步意图队列；只有 converged 才按请求离开，其他 apply 结果留在详情                                         |
| 响应式和键盘            | 组件测试与 Playwright                           | `< md` 可切换设置栏目；760px 两侧布局无溢出或遮挡；焦点、单一 live status 和图标名称正确                                                          |
| 多窗口并发             | `project-skills-service.test.ts`           | `observedRevision` 覆盖清单、库、账本和投影；另一窗口变化会广播失效并阻止脏草稿应用                                                                |
| 同项目计划竞态           | renderer store 与路由测试                       | 同项目内旧 `draftGeneration/draftFingerprint` 的迟到 plan 不能覆盖新草稿计划                                                        |
| 分命令响应竞态           | renderer store 与路由测试                       | snapshot/doctor 可报告新 revision；plan 按草稿指纹拒绝迟到结果；apply/repair 按 operation id 接收新权威 revision；迟到候选被 discard            |
| 跨进程并发             | 两个独立 Pier 进程集成测试                           | 不同 userData profile 同时 apply/repair/ensureReady 时只有一方持锁；不能强行接管活锁                                                   |
| 跨 profile 所有权     | 两个独立 Pier profile 集成测试                     | 共享锁只串行化；另一 profile 不采用、不覆盖、不删除首个 profile 的私有受管投影                                                                   |
| 崩溃恢复              | 每个文件系统边界的 main 故障注入                        | 重启后只能得到完整旧状态、完整新状态或明确阻断态；提交点前不是 `degraded`                                                                         |
| 纯校正恢复             | repair/ensureReady 逐阶段故障注入                 | 校正事务不写清单；清单变化时先按精确身份结算旧 operation，再以新 operation 重计划；只有身份不明才永久阻断                                                    |
| 耐久与空间错误           | APFS/HFS+ 集成测试                             | 提交点前后注入 `ENOSPC/EDQUOT/EACCES/EROFS` 和父目录同步失败，结果符合 `not-applied/degraded/indeterminate`                            |
| 请求幂等与保留           | IPC 响应丢失、时间和配额测试                           | apply/repair 响应丢失后同 operation id 返回不可变原终态；degraded 由新 repair operation 继续；UUIDv7 时间窗、未来时间、时钟回拨、tombstone 过期均不导致重执行 |
| 严格结果联合            | 契约与 renderer store 测试                      | converged/degraded 才有权威新快照；indeterminate 只能按 operation id 查询；已写目标后清单变化返回字段完整的 superseded，renderer 穷尽处理全部分支         |
| 非托管与伪造标记          | `project-skills-security.test.ts`          | 不覆盖无账本目标；仅有项目内标记时绝不删除                                                                                              |
| 投影对象身份            | `project-skills-security.test.ts`          | 改写链接，或删除后重建同目标链接，均因对象身份变化而保留                                                                                       |
| 内容并发              | `project-skills-security.test.ts`          | 快照后修改库或删除内容时返回 `content-conflict/library-drift`，普通应用不更新摘要                                                          |
| 路径和导入竞态           | `project-skills-security.test.ts`          | `..`、父级/内部符号链接、特殊文件、超限、遍历中替换、两次源树遍历不一致和 apply 前篡改暂存均拒绝                                                             |
| YAML 资源边界         | 契约和模糊测试                                    | 64 KiB、深度 16、禁 alias/anchor/tag 的限制生效；病态输入不导致无界 CPU/内存占用                                                           |
| 不覆盖和条件发布          | 平台文件系统集成测试                                 | 首次清单创建竞态使用 absent/no-clobber；已有清单在最终校验后被外部编辑时强 CAS 拒绝覆盖；冲突后新库清理失败进入非终态恢复；投影发布后对象身份与账本一致                            |
| 项目身份              | `project-skills-project-identity.test.ts`  | 同卷移动可安全重键；跨卷复制、同路径重建、worktree 重建和离线不会继承或丢失删除权限                                                                     |
| 账本与恢复损坏           | `project-skills-recovery.test.ts`          | tombstone 必须先于隔离移动耐久；两步间崩溃、截断、未知版本、权限错误和隔离失败均阻断；绝不回退到空账本                                                           |
| 清单三态              | `project-skills-reconcile.test.ts`         | 有效空清单安全清理受管投影；无清单按账本处理残留；无效清单阻断                                                                                    |
| 读一致性              | 并发 snapshot/doctor/plan 测试                 | 读操作最多等待 5 秒，不观察混合事务代次；超时带 operation id 返回且取消等待不取消恢复                                                                |
| 只读权限无副作用          | capability 与文件监视集成测试                       | 仅有 `skills:read` 时 projects.snapshot/snapshot/plan/doctor/operation.status 不产生任何项目或本机状态写入；恢复只被写入口或 main 恢复协调器推进    |
| 暂存与清扫             | 时间、并发和配额测试                                 | AVAILABLE/CLAIMED/CONSUMED 状态正确；discard、TTL 清扫和双 apply 不能删除或重复消费已 claim 候选；不扫描删除未知路径                               |
| 文件系统边界            | 能力探测测试                                     | macOS 可靠本地文件系统可写；网络盘、云盘和不支持原语的文件系统只读并报告                                                                            |
| 适配与重复发现           | `project-skills-adapters.test.ts`          | 发现根、版本和刷新语义来自注册表；多活动根报告 `duplicate-discovery`                                                                      |
| Codex、Claude Code | 真实集成探测                                     | 新会话启用可见、禁用不可见；Claude 适配控制 `.claude/skills`                                                                         |
| 会话语义              | `project-skills-session-semantics.test.ts` | 不依赖 transcript 或技能调用记录；有相关活动会话时只显示保守的 `new-session-recommended`                                                    |
| 启动顺序              | 架构测试、`project-skills-launch.test.ts`       | 所有受管入口汇入 main 最后公共硬门；ensureReady 后才 native launch，失败默认不 spawn                                                      |
| 启动阻断选择            | renderer 与启动集成测试                           | 待启动参数留在 main；challenge 绑定 panel/surface 代次；打开设置、降级和取消明确；重放、panel 关闭/复用、换窗口/项目/agent、状态变化、过期均不能绕过                   |
| 降级启动至多一次          | native launch 故障注入                         | PENDING→SPAWN_INTENT 先耐久再 spawn；intent 后崩溃不自动重放；native 以 attempt id 去重并报告结果不确定                                     |
| 全局目录不变            | 集成测试                                       | 应用前后全部用户级发现根无 Pier 新增条目                                                                                            |
| 项目与进程边界           | 架构和依赖测试                                    | 只用 `projectRootPath`；无新项目注册表；main、preload、renderer 依赖方向正确                                                          |
| 命令治理              | `project-skills-command-router.test.ts`    | 所有 `skills.*` 与 `terminal.launch.continue` 均有 strict schema、capability 和 allowed client kinds                      |
| 健康与计划阻断           | 契约和启动测试                                    | 每个 code 的 severity、blockingScopes、repairable 和 scope 固定；能消解问题的计划可应用；无关 AgentKind 为 `not-applicable`                |
| 计划确认契约            | 契约与组件测试                                    | apply/repair 的 confirmationRequirements 与 acknowledgements 精确匹配当前计划摘要；漂移删除摘要必填；计划变化使确认失效                           |
| Git 协作            | renderer 组件测试、Git index 竞态测试、校正服务测试        | 五态进入 planDigest；Git 项目每个投影删除均有精确路径确认，因此最终检查后被 git add 也不越权；已提交确认可恢复，无确认残留可由 repair.plan 闭环；不改用户 Git 配置             |
| 操作反馈              | renderer 组件测试                              | 无静默失败、无重复 toast；复制有反馈；复杂导入风险留在页内，技术错误走 `showAppAlert`                                                              |


