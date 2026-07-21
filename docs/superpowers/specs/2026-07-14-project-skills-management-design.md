# 项目技能管理设计

> 状态：修订候选 **v9.0**；产品决策：对齐业界技能管理**金标准**（vercel-labs/skills + Cursor/Codex/Claude 发现语义），**废除**本机内容批准账本作为投影/启动门控。不再以「比业界更严」为差异化目标。
>
> 日期：2026-07-14；修订：2026-07-21（v9.0）
>
> 定位：Pier 内嵌的**项目级**技能管理——查看、导入、启停、编辑、投影到智能体原生发现路径。心智与 `npx skills` / Cursor Skills 一致：**启用（或装入发现路径）即可用**；用户自己管理仓库与内容。

## 1. 目标和完成标准

Pier 为当前项目提供查看、搜索、添加（本地导入 / 收编仓库内技能 / 新建）、启用、禁用、编辑、删除和健康检查闭环；每次用户意图动作即落盘（协议层仍经 plan→apply）；并只读呈现用户全局技能与非托管项目技能对各智能体的实际影响。

### 1.0 金标准心智（v9.0 · 强制）

对齐 [vercel-labs/skills](https://github.com/vercel-labs/skills)、Cursor / Codex / Claude Code 的事实行为：

1. **发现路径里有技能 = 智能体可用**（新会话）。Pier 托管技能：`manifest.enabled=true` → 投影 symlink → 等同业界「已安装」。
2. **不设本机「内容批准 / 审阅门」**。不维护 `approvals.json` 授权投影或启动；Git 清单的 `enabled=true` **足以**驱动投影与 `ensureReady` 校正。
3. **导入/新建**可展示结构与风险**提示**（对齐 asm 装前扫描），确认后写入库并默认停用或按用户选择启用——提示不是持久批准账本，也不在内容变更后强制「重批准」。
4. **编辑保存 / 库被外部改写**：更新 `contentDigest`（或接受当前树写入清单）并按启用态重投影；不走「信任当前内容」安全仪式。
5. **项目级默认**（不写 `~/`）对齐 `npx skills` 默认项目安装，不是「比 -g 更安全」的差异化叙事。
6. **启动门**只保证投影与清单一致、处理冲突/损坏；**不得**因「未批准内容」阻断启动。

### 1.1 完成标准条目

1. 技能内容只在 `.pier/skills/library/` 保存一份；启用状态通过指向该只读快照的受管**相对目录符号链接**表达（对齐 skills「symlink 优先」；v1 不做 copy 投影兜底）。
2. **启用并提交投影后**，新会话能从目标智能体原生路径发现技能；停用并提交后不再发现。
3. 默认不写用户级发现目录；用户全局技能只读观察（与 skills 默认项目范围一致）。
4. Pier 只删除自己在本机创建且未被外部修改的投影；无法证明所有权的目标一律保留并报告冲突。
5. 项目清单、实际投影、设置界面和启动链路具有单向所有权；崩溃或部分失败后只能得到旧状态、完整新状态，或不猜测所有权的明确阻断态。
6. ~~本机批准账本授权投影~~ **已废除（v9.0）**。系统技能仍仅从受管供应链注入（第 8 节），与用户技能「启用即发现」同投影通道，但不引入用户内容批准仪式。
7. 内容变更收敛为「候选 → 同一次提交重发布」；界面不维护「待应用」第二宇宙。**无「重信任」产品步骤。**

完成标准：

- 项目清单是唯一的期望状态；renderer 只为一次用户动作持有瞬时意图。
- `{userData}` 下投影账本是删除投影的唯一证明。
- **`enabled=true` + 库内容有效 ⇒ 可投影、可参与 ensureReady**；无第二道内容授权。
- `skills.plan` / `skills.apply` 仍为唯一提交点；确认仅用于破坏性删除、非托管冲突等**操作风险**，不用于「接受技能正文」。
- 提交点前失败不改变期望状态；提交点后失败才是 `degraded`；`indeterminate` 禁止后续写入。
- `ManagedAgentLaunchGate` 同步校正投影；因投影缺失/冲突/损坏可阻断；**不因缺少内容批准阻断**。
- 生效矩阵由 main 派生；第 11 节矩阵按 v9.0 更新后全部通过。

### 1.2 生效边界

“启用”和“禁用”描述磁盘发现状态，不承诺撤回已进入会话上下文的内容：

- 新会话以应用后的投影为准。
- 已运行会话是否热更新只能作为适配器能力说明。
- 有相关活动会话时，变更发现状态后提示“现有会话可能保留旧内容，建议新建会话”。
- Pier 保证发起受管进程前投影已按清单收敛；不承诺冻结外部并发写。

### 1.3 状态边界摘要（v9.0）

| 事实 | 位置 | 作用 |
| --- | --- | --- |
| 期望启用集、Claude 投递开关 | `.pier/skills/manifest.json` | 唯一期望状态；**启用即授权发现** |
| 技能正文 | `.pier/skills/library/<id>/` | 内容单源；`contentDigest` 仅完整性/并发，**非批准门** |
| 投影链接 | `.agents/skills`、`.claude/skills` | 派生状态 |
| 非托管 / 用户全局 | 发现根真实目录 | 只读观察 + 可收编 |
| 投影所有权 | `{userData}/.../ownership.json` | 唯一删除授权 |
| ~~内容批准~~ | ~~approvals.json~~ | **v9.0 删除；迁移期忽略既有文件** |
| 系统技能期望态 | `{userData}/.../system-skills.json` | 本机启停 |
| 操作恢复 | `{userData}/.../operations/` | 精确重放 |

## 2. 技能分层全景、官方事实和范围

### 2.1 技能分层模型（六层）

对任意一个智能体，会话里最终“生效”的技能是多层目录扫描的并集。按定义者与作用范围分六层；Pier 对每层的权力不同且不可越界：

| 层 | 内容与位置 | 谁定义 | Pier 的权力 |
| --- | --- | --- | --- |
| 1 系统内置 | Claude Code bundled（`/code-review` 等，`disableBundledSkills` 可关，`/doctor` 需单独关）；Codex system skills（skill-installer / skill-creator，缓存于 `$CODEX_HOME/skills/.system`）；Cursor 内置（`/create-skill`、`/migrate-to-skills`） | 智能体产品自带 | 不触碰、不展示 |
| 2 企业托管 | Claude Code enterprise managed settings | 组织管理员 | 不触碰 |
| 3 用户全局 | `~/.agents/skills`（Codex 现行官方 + Cursor）；`~/.codex/skills`（Codex 弃用但仍加载，skill-installer 仍装此处）；`~/.claude/skills`；`~/.cursor/skills`；`~/.config/opencode/skills`（OpenCode 另兼容 `~/.claude`、`~/.agents`） | 用户本人，对所有项目生效 | 只读观察：全局清单 + 同名遮蔽/覆盖提示；承诺永不写入 |
| 4 插件携带 | Claude plugin skills（`plugin:skill` 命名空间，经 `/plugin` 管理，不受 `skillOverrides` 影响）；Cursor 插件内 skills | 插件作者 | 不触碰（Pier 自身插件贡献走第 8 节系统技能通道） |
| 5 项目非托管 | 仓库自带的 `.agents/skills`、`.claude/skills`、`.cursor/skills`、`.opencode/skills`、`.codex/skills` 真实目录 | 仓库 / 同事，随 Git 传播 | 只读观察 + 收编（只读复制，不覆盖不删除不认领） |
| 6 项目 Pier 托管 | 内容唯一存于 `.pier/skills/library/<id>/` + manifest；**启用即投影**为受管符号链接 | 用户经 Pier；系统技能经第 8 节 | 启停 / 编辑 / 删除 / 投影 / 启动校正 |

两个决定产品形态的关键事实：

1. **托管技能不是第七个发现层。** 投影之后它就出现在层 5 的扫描面里（`.agents` / `.claude`），智能体不区分“Pier 放的”和“用户放的”。因此层 5 与层 6 必须在同一张列表里呈现。
2. **生效 = 并集 + 各家同名语义。** Claude Code 同名优先级为企业 > 用户 > 项目（用户级遮蔽项目级）；Codex 同名不合并、可并存；OpenCode 同名跨根按优先级覆盖（项目 `.opencode` 最高），非硬冲突；Cursor 多根并扫且 `~/.agents` 实载有版本差异。因此“对哪些智能体生效”必须是 main 派生的事实矩阵。

### 2.2 官方发现事实（核验于 2026-07-19）

| 智能体 | 项目级扫描 | 用户级扫描 | 重要行为 | v1 决策 |
| --- | --- | --- | --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md`（从当前目录向上扫至仓库根）+ `.codex/skills` | `~/.agents/skills`（现行官方）+ `~/.codex/skills`（`$CODEX_HOME`，弃用但仍加载） | skills 已默认开启（experimental、default_enabled）；目录级符号链接各层均跟随（System 层除外）；文件级 `SKILL.md` 符号链接与 skills 根本身为符号链接不支持（官方 not_planned）；点开头隐藏条目跳过；同名不合并可并存；自动检测变化，必要时需重启 | 默认项目投影 |
| Claude Code | `.claude/skills/<name>/SKILL.md`（嵌套子目录同名以 `dir:name` 限定名共存，v2.1.203+） | `~/.claude/skills` + 企业层 + 插件层 | 官方支持技能目录符号链接（同一目标多处可达只加载一次）；同名优先级企业 > 用户 > 项目——**用户级遮蔽项目级**；任何层同名覆盖 bundled；`skillOverrides` 四态可见性（v2.1.129+，不适用插件技能）；会话启动时目录尚不存在则需重启；已调用内容保留在会话中 | 显式开启 Claude 适配；用户级同名产生 `shadowed-by-user-skill` 提醒 |
| OpenCode | `.opencode/skills`、`.claude/skills`、`.agents/skills`（walk up 至 git 根） | `~/.config/opencode/skills`、`~/.claude/skills`、`~/.agents/skills` | 同名跨根按优先级覆盖（项目 `.opencode` > 全局 opencode > `.agents` > `.claude` > 内置），非硬冲突；文档建议名字全局唯一；frontmatter `name` 与目录名不匹配报错 | 开启 Claude 适配时报告跨根同名的覆盖关系 |
| Cursor | `.agents/skills`、`.cursor/skills`；兼容 `.claude/skills`、`.codex/skills`；嵌套子目录自动限定作用域 | `~/.cursor/skills`、`~/.agents/skills`；兼容 `~/.claude`、`~/.codex` | 多根并扫；`~/.agents/skills` agent 自动调用可加载、CLI `/` 菜单部分版本不扫（官方确认 bug 修复中）——按版本探测 | v1 不创建额外 `.cursor/skills` 投影；`.agents` 探测不通过时报告不支持；重复发现检查覆盖 Cursor |

官方依据：[Codex](https://developers.openai.com/codex/skills)、[Claude Code](https://code.claude.com/docs/en/skills)、[Cursor](https://cursor.com/docs/skills)、[OpenCode](https://opencode.ai/docs/skills/)（注意 open-code.ai 为第三方镜像，不作权威来源）、[Agent Skills 规范](https://agentskills.io/specification)。适配能力必须同时具有官方文档和版本化探测证据，不能从第三方管理器的路径表推断，也不能在界面硬编码为健康。

2026-07-20 按 Pier 支持的全部 AgentKind 完成覆盖审计：凡有官方技能文档的智能体均已入注册表（Gemini CLI、Antigravity CLI、Amp、GitHub Copilot CLI、Kimi、Cline、Crush、Auggie、Command Code、Rovo Dev、Pi、Devin、Kilo、Codebuff、Mistral Vibe、Autohand、OpenClaw、MiMo Code、OMP、OpenClaude 等，逐条 `officialDocsUrl` + `verifiedOn` 见 `adapter-facts.ts`）；仅扫描产品私有根（Pier 从不投影）的智能体（Kiro、Qwen Code、CodeBuddy、Qoder、Grok、Droid、Ante、Hermes）登记为 `consumesProjectSkills: false` 的事实条目，不参与启动门与矩阵；查证不到官方支持或文档不稳定的（Aider、Goose、Continue）在注册表注释中记录结论，不臆造条目。

业界佐证（v9.0）：vercel-labs/skills、Cursor、Codex、Claude Code 均以**发现路径存在即加载**为主路径；Claude 社区要求的内容哈希重批准**未被官方采纳**。Pier **不再**以 direnv 式批准账本为产品目标；完整性用 `contentDigest` 做并发与漂移检测，不授权发现。

### 2.3 v1 范围

- 本地目录导入、收编、新建、列表、搜索、启用、禁用、编辑、删除。
- 非托管与用户全局只读呈现。
- `.agents/skills` 默认投影与 `.claude/skills` 显式开关。
- 应用、修复、健康检查；冲突、同名遮蔽/覆盖、重复发现（提醒）、会话刷新提示。
- 受管智能体入口的投影同步校正（启动门 = 投影收敛，非内容批准）。
- Pier 系统技能通道（第 8 节）。
- macOS 本地文件系统。

### 2.4 非目标

- 写用户级技能目录，或重定向配置根。
- 远程/marketplace/更新检查（无供应链设计前禁止）。
- 用户级中央技能库。
- **本机内容批准账本、direnv 式重批准、「需要审阅才能启用」**（v9.0 明确非目标）。
- 第三方插件贡献技能；复制型投影；Windows/Linux 未验证原语。
- 私有会话注入；自动认领/删除非托管目录。

远程来源与市场须另行设计。设置页可说明：技能管理默认只写项目发现路径（与 `npx skills` 默认一致）。

### 2.5 业界金标准对齐（v9.0 · 取代 v8.3「差异化」）

| 参照 | Pier 对齐 |
| --- | --- |
| vercel-labs/skills | symlink；项目默认；显式 agent 目标（Claude 开关）；装/启用即可用 |
| Cursor / Codex / Claude | 发现根有内容即加载；无第二道内容批准 |
| skills-manager | 列表含外部安装；徽章式可见性；adopt |
| asm | 导入时可提示风险（非持久授权） |

**禁止再写的叙事**：「比业界更严的信任门是差异化优势」。产品目标是**标准最佳实践**，不是安全差异化。

**交互（相对 v8.3 删除信任门）：**

| 主题 | v9.0 |
| --- | --- |
| 添加菜单 | 仅「从文件夹导入」「新建技能」 |
| 导入预览 | 可选展示构成与风险提示后「添加」；默认停用；**无批准账本** |
| 启用 | 行开关直接启用并投影（含 Git 声明的已启用技能 / 新 clone） |
| 编辑 | 「保存」更新库与摘要；已启用则重投影 |
| 库漂移 | 「采用当前内容」或「恢复/删除」——**完整性操作**，不是重审信任 |
| Claude 开关 | 「也提供给 Claude Code」 |

## 3. 状态和所有权

### 3.1 状态分层

| 层 | 位置 | 所有者 | 含义 |
| --- | --- | --- | --- |
| 技能库 | `.pier/skills/library/<skill-id>/` | 项目清单域 | 发布时生成的只读内容快照，是项目中的内容单源 |
| 期望清单 | `.pier/skills/manifest.json` | 项目清单域 | 用户技能的启用集、适配开关、内容摘要和来源快照 |
| 发现投影 | `.agents/skills/<id>`、`.claude/skills/<id>` | 校正服务 | 已启用技能的受管相对目录符号链接 |
| 投影账本 | `{userData}/project-skills/<root-key>/ownership.json` | main 持久化层 | 删除投影的唯一证明 |
| ~~内容批准~~ | ~~approvals.json~~ | — | **v9.0 废除；读写路径忽略** |
| 系统技能期望态 | `{userData}/project-skills/<root-key>/system-skills.json` | main 持久化层 | 本项目系统技能启停（本机，不进 Git），见第 8 节 |
| 操作状态 | `{userData}/project-skills/<root-key>/operations/<operation-id>.json` | main 持久化层 | 进行中恢复日志或已完成幂等结果，不进入 observed revision |
| 导入/编辑暂存 | `{userData}/project-skills/<root-key>/staging/` | main 持久化层 | 未消费候选（导入、收编、模板、内容更新），不是第二份期望状态 |
| 编辑草稿正文 | renderer 持久化（`{userData}` UI 状态域） | renderer | 纯数据防丢字；无授权含义；候选过期后可据此重新生成 |

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
  "delivery": { "agents": true, "claude": false },
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

清单 schema 与 v7 完全一致（strict、`version=1`、三种 source 类型：`local-import` / `project-discovery-import` / `git-declared`）。新建空白技能记 `local-import`；内容更新与「采用当前内容」只更新 `contentDigest`。系统技能不进清单（第 8 节）。`content-update` / `drift-accepted` / `pier-system` **不再**写入任何批准账本。

`id` 必须匹配 `^[a-z0-9]+(-[a-z0-9]+)*$` 且不超过 64 个字符；`id`、父目录名和 `SKILL.md` 的 `name` 必须一致；`description` 长度为 1 至 1024；`skills` 按 `id` 唯一。系统技能强制 `pier-` 前缀，用户技能禁止使用该前缀。

技能 frontmatter 按 Agent Skills 核心字段校验。库是逻辑只读快照。每次计划/应用/修复/启动校正核验实际树摘要。`library-drift`（实际树 ≠ 清单 `contentDigest`）时：阻断对该技能的模糊「保留旧摘要继续投影」——用户须**采用当前内容**（更新清单摘要并继续按启用态投影）、恢复已知好内容、或删除。这是**完整性收敛**，不是内容批准。普通启停不隐式改 `contentDigest`；摘要更新由内容更新候选或「采用当前内容」携带。

清单中的 `enabled=true` **即表示应投影并参与受管启动校正**（v9.0）。还须同时满足：库存在且结构有效；无非托管同名冲突；投影目标可安全写入或已是本机受管链接。

`contentDigest` / `riskFingerprint` 仅用于展示、并发与漂移检测，**不构成授权门**。新 clone / 切分支后，清单已启用的技能由 `ensureReady` / apply **直接投影**（业界金标准）。

摘要与并发：

- `tree-sha256-v1` 按规范化 POSIX 相对路径字节排序，摘要类型、路径、长度、内容与可执行位；拒绝符号链接、硬链接、特殊文件等。
- `riskFingerprint` 仅展示（脚本、动态命令、`allowed-tools`）；**不触发重批准**。
- `manifestRevision` / `observedRevision`：后者含 manifest、库摘要、ownership、系统技能期望态、投影身份；**不含 approvals**。
- renderer 不能提交 source、摘要、投影或健康结论；编辑字节经 main 全量限制与重算。

### 3.3 项目身份与共享索引

项目引用 `ProjectRootRef` 包含规范化 `realpath`、卷身份、目录文件身份。写入和删除必须同时匹配路径与稳定目录身份：

- 同卷改名只有在旧路径不可用且稳定身份唯一匹配时，才在持锁状态下原子重键本机状态。
- 跨卷复制、重新 clone、worktree 删除后重建，以及原路径删除后新建目录均视为新项目，绝不继承旧投影删除权限。
- 外置卷离线时长期保留 ownership 与恢复日志；不得按时间自动忘记项目。
- 操作期间项目根或任何受管祖先身份改变时立即停止，进入 `project-identity-changed` 阻断态。

项目入口复用共享本地项目索引：`skills.projects.snapshot` 合并共享索引与最近面板上下文；「添加项目」走环境域；技能页不提供「移除项目」。

**索引 ≠ 授权三不变量**：命令仍由 main 实时解析身份；索引不缓存可绕过校验的身份；移除索引不删 ownership/恢复日志。

### 3.4 本机内容批准 —— 已废除（v9.0）

**删除产品与运行时门控。** 既有 `{userData}/.../approvals.json` 在迁移期忽略，不参与 plan/apply/ensureReady；后续版本可物理删除。禁止 UI「需要审阅 / 批准并启用 / 信任当前内容」作为启用前置。

授权公式（金标准）：

```text
可投影 ⇔ enabled=true ∧ 库有效 ∧ 无阻断冲突
```

确认对话框仅用于：破坏性删除库、删除 Git 已跟踪投影、覆盖/冲突消解等**操作风险**——不是「接受 SKILL.md 正文」。

### 3.5 投影账本和删除

账本条目记录 schema 版本、generation、项目身份、相对目标、技能 id、预期相对链接目标、投影对象的卷/设备/inode/出生时间身份、创建操作 id 和时间。项目内诊断标记不能证明所有权。

删除前必须同时满足：

1. 可信账本存在该目标记录；
2. `lstat` 类型与账本一致；
3. 符号链接仍指向预期库目录；
4. 当前投影对象身份与创建后写入账本的身份完全一致。

账本缺失、损坏、版本未知或权限异常时一律保留目标；链接被改写或用户删除后重建相同链接时也保留，并报告 `managed-target-modified`。禁止仅凭路径、链接目标或项目内标记递归删除。

受管/非托管分类必须以账本为准：仅“链接目标指向 `.pier/skills/library`”不构成受管判定。

`ownership.json` 使用 strict schema，跨进程锁内按 generation 条件替换。损坏隔离顺序：`PREPARED` tombstone → 不覆盖移走损坏文件 → `QUARANTINED`。用户处理前持续返回 `ledger-corrupt` / `recovery-record-corrupt`。**不再有 `approval-ledger-corrupt`。**

本机所有权按 Pier profile 私有；另一 profile 遇已有投影按非托管处理。

### 3.6 对外数据结构

共享契约至少冻结以下结构：

| 结构 | 必要字段 |
| --- | --- |
| `ProjectSkillsProjectSummary` | `projectRef`、显示路径、来源、托管技能数、读取状态 |
| `ProjectSkillsSnapshot` | `projectRef`、revision、清单、技能视图、非托管、用户全局、系统技能、生效矩阵、健康、Git 建议、最近操作 |
| `ProjectSkillView` | id/name/description、来源、**期望启用态**、树摘要、规模、风险摘要（展示）、生效状态、问题 id；**无「本机批准态」字段** |
| `UnmanagedSkillView` / `UserGlobalSkillView` | 同前，只读 |
| `EffectiveMatrixCell` / `ProjectSkillsIssue` / `DiscoveryAdapterView` / `GitProjectionView` | 同前 |
| `ImportCandidateView` | token、元数据、构成、风险提示、来源、过期 |
| `ProjectSkillsPlan` | observedRevision、差异、目标操作、阻断问题、确认要求（**仅删除/冲突等操作风险**）、planDigest |
| `LaunchGateResult` | ready / blocked（投影冲突、损坏、缺失不可自动修等——**不含 approval-required**） |

### 3.7 代码所有权

| 层 | 所有权 |
| --- | --- |
| 契约 / L1 / FS 适配器 / 锁 / 矩阵 / frontmatter / Service | 同前；**批准模块删除或改为 no-op 迁移桩** |
| `ManagedAgentLaunchGate` | 投影收敛与冲突阻断；不查内容批准 |
| renderer | 动作即提交；无「批准并启用」主路径 |
| 测试 | 收敛、删除安全、**启用即投影**、启动校正；删除「未批准阻断」用例，改为「clone 启用即投影」 |
## 4. 命令和应用控制流

### 4.1 命令与权限

| 命令 | 行为 | 客户端 |
| --- | --- | --- |
| `skills.projects.snapshot` | main 合并共享项目索引与最近面板上下文，返回项目摘要（名称/路径/托管技能数/读取状态） | `desktop-renderer` |
| `skills.snapshot` | 一致读取两个 revision、技能视图（托管 + 非托管 + 用户全局）、生效矩阵、健康、Git 建议和最近操作；用户全局枚举遵守第 6.1 节约束 | `desktop-renderer`、`cli-local` |
| `skills.import.prepare` | main 内打开原生导入目录选择器并生成候选快照；取消返回 `null`；可携带预选目录（main 按白名单校验） | `desktop-renderer` |
| `skills.import.prepareFromDiscovery` | 从既有项目发现根中的真实非托管目录生成只读复制候选（收编） | `desktop-renderer` |
| `skills.import.prepareTemplate` | 生成新建空白技能的模板候选（`local-import` 来源） | `desktop-renderer` |
| `skills.import.prepareContentUpdate` | 以 renderer 提交的编辑字节生成内容更新候选（`content-update`，绑定 `baseSkillId` + `baseContentDigest`） | `desktop-renderer` |
| `skills.import.discard` | 幂等丢弃未消费候选 | `desktop-renderer` |
| `skills.plan` | 按瞬时意图只读计算差异、逐目标操作、阻断问题、操作确认要求和 `planDigest` | `desktop-renderer` |
| `skills.apply` | 重新验证计划并按整份草稿提交期望状态 | `desktop-renderer` |
| `skills.repair.plan` / `skills.repair` | 只读计算校正差异与操作确认 / 按磁盘清单重新校正投影 | `desktop-renderer` |
| `skills.doctor` | 只读检查，不自动修复 | `desktop-renderer`、`cli-local` |
| `skills.skill.read` | 读取单个已发现技能的 SKILL.md（只读详情 / 编辑预填）；ref 不携带路径——托管按 skillId 定位库目录，项目/用户全局按注册表白名单根 + 纯子目录名定位，1 MiB 截断，展示用途、无批准含义 | `desktop-renderer`、`cli-local` |
| `skills.operation.status` | 只读查询指定 operation 的持久化阶段和严格结果 | `desktop-renderer`、`cli-local` |
| `agent.launch.continue` | 继续被 `ManagedAgentLaunchGate` 阻断的受管启动 | `desktop-renderer` |

v7 的 `skills.project.pick` 删除；「添加项目」走环境域既有命令。v8.1 起独立的 `skills.global.snapshot` 命令随全局视图一并移除：用户全局枚举只作为 `skills.snapshot` 的内部输入。`skills:read` 授权项目列表、读取、计划、健康检查，`skills:write` 授权导入、应用、丢弃和修复。desktop renderer 默认拥有读写，`cli-local` v1 只读，并只允许 main 规范化后的 CLI cwd。所有项目读命令限制在共享索引、面板上下文、CLI cwd 或有效 `ProjectRootRef`；`skills.snapshot` 内部的用户全局枚举是唯一的用户目录读取例外，其安全边界见第 6.1 节。命令统一进入现有 `PIER.COMMAND_EXECUTE`。

草稿只是单次动作的瞬时协议载体：Claude 适配布尔值、既有技能 id 的期望启用态、待添加 import token（含模板与内容更新候选；同 skillId 候选表示内容更新），以及待删除技能 id。真正破坏性删除与「采用当前文件」不在 renderer 自行判定，而在 apply/repair 提交前按当前计划精确确认。漂移采用必须携带 main 提供的 `expectedActualTreeDigest` 作为并发前置条件。请求严格冻结为：

- `skills.plan({ projectRef, observedRevision, draft })`；
- `skills.apply({ projectRef, observedRevision, draft, planDigest, operationId, acknowledgements })`；
- `skills.repair.plan({ projectRef, observedRevision, continuationOf? })`；
- `skills.repair({ projectRef, observedRevision, operationId, repairPlanDigest, acknowledgements, continuationOf? })`；
- `skills.operation.status({ projectRef, operationId })`；
- `agent.launch.continue({ launchAttemptId, decision, acknowledgements? })`，`decision ∈ open-settings / degrade / cancel`。

计划的每个 `confirmationRequirement` 都包含稳定 id、kind（内容删除 / Git 已跟踪投影删除 / 漂移采用等完整性操作）、精确相对目标或实际树摘要，以及计划摘要。`acknowledgements` 必须逐项精确匹配 main 要求，并记录宿主确认交互生成的高熵 nonce；计划变化使全部确认失效。它是可信客户端的可审计操作意图，不是技能正文授权，也不是对恶意 renderer 的安全证明。

`planDigest` 只摘要规范化草稿、`observedRevision`、有序目标操作、逐目标 Git 五态、确认要求和安全前置条件。

**单动作快路径**：启用、停用或投递开关变化后，renderer 立即串行调用 `skills.plan → skills.apply`；`enabled=true` 本身不产生内容确认。若计划因 Git 已跟踪目标删除等操作风险返回确认要求，则在该动作内确认后继续。两条命令的全部校验、锁、planDigest 匹配与唯一提交点语义不变；界面不出现批量草稿或全局「应用更改」。

Git 确认时间边界与 v7 一致：确认耐久写入恢复日志之前，Git 状态变化使 `planDigest` 失效；确认已耐久写入且完成最终前置检查之后，后续 Git 变化不撤销对精确路径和对象身份的删除授权。

main 在应用、修复和恢复收敛后广播 `pier://project-skills:invalidated`，载荷只含项目身份和新 `observedRevision`。无未保存正文的窗口自动刷新；正在编辑的窗口保留本地正文、暂停保存并提示重新载入。

### 4.2 应用流程

1. `snapshot(projectRef)` 在项目读锁前有界等待已有恢复协调器；5 秒后仍未完成则返回带 operation id 的 `recovery-pending/operation-busy`。renderer 只保存请求代次、`observedRevision` 和草稿。
2. 各 `import.prepare*` 在 main 内生成候选并复制到 `{userData}` 私有暂存区，返回绑定项目、窗口、调用方和树摘要的单次 token；不修改项目。内容更新候选额外绑定 `baseSkillId + baseContentDigest`。
3. 用户动作触发 `plan(...)`。main 在读锁内重新核验根、库、清单、投影账本和目标，并按“拟议操作完成后的状态”判断 `applicable`。能够消解问题的停用、关闭适配或删除不应被问题本身阻断。
4. `apply(...)` 取得跨进程项目锁和共享 `FilePathTransactionLock`，再次计算 `observedRevision` 与 `planDigest`。任一不匹配均在项目写入前返回结构化冲突。
5. main 创建耐久恢复日志，在第一次项目写入前把所用候选从 `AVAILABLE` 耐久条件推进为 `CLAIMED(operationId)`，再发布内容。清单提交前做最后一次校验（清单对象身份和摘要、全部相关库摘要、受管祖先身份、待删除/待替换目标的前置条件与 Git 状态），随后按 `ExpectedFileState` 耐久发布清单。
6. 清单提交后，按 `enabled=true` 的期望集逐目标校正投影、提交投影账本，并按对象身份清理不再引用的库内容。
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

| 故障位置 | 对外结果 | 恢复动作 |
| --- | --- | --- |
| `MANIFEST_COMMITTED` 前且精确清理完成 | typed error，`not-applied` | 回滚日志能证明身份的新发布库对象，释放候选 claim，保留草稿和 token |
| `MANIFEST_COMMITTED` 前但清理结果不明或失败 | 即时 `indeterminate` | 保留非终态日志；恢复后只能终结为 `not-applied` 或 `recovery-blocked` |
| 提交点后，进程仍能确认部分目标失败 | 不可变终态 `degraded` 与已提交的新 revision | 后续由新的 repair operation 携带 `continuationOf` 校正 |
| 提交点后崩溃，尚未生成终态结果 | 查询为 `pending/recovering` | 恢复协调器在同一 operation 内向前重放，最终只生成一次不可变终态 |
| rename 已发生但父目录同步失败等无法判定场景 | `indeterminate` | 禁止第二次写；重新读取与恢复后只能归约为已提交、未提交或 `recovery-blocked` |
| 日志、投影账本或对象身份不一致 | 阻断态 | 隔离损坏本机记录；不覆盖、不采用、不删除项目目标 |

具体顺序和删除约束：

1. 项目库暂存与投影暂存都位于各自目标的同一父目录；暂存对象身份先写入恢复日志。
2. 新库目录以不覆盖方式发布。若提交点前崩溃，只有恢复日志精确匹配的对象可以回滚。
3. **库内容替换（内容更新 / 漂移采用）不引入新原语，由既有原语组合完成**：提交前重算目标库实际树摘要并要求等于候选记录的 `baseContentDigest`（编辑期间库被外部修改 → `content-conflict`，绝不把更新叠加在尚未采用的漂移之上）→ 按恢复日志记录的对象身份逐项清理旧树（复用库清理机制，禁止递归 `rm`）→ 以不覆盖方式发布新树 → 发布后复核。任一步同步结果不明归约为 `indeterminate`。
4. 清单条件前置为 `ExpectedFileState = absent | present(identity, digest)`：首次创建 no-clobber；已有清单使用“最终检查 + 原子替换 + 发布后复核”的保守模型；复核偏离进入 `indeterminate` 或阻断。
5. v1 的投影没有“覆盖更新”：目标缺失时 `publishNoReplace` 创建；目标是账本中完全相同的链接时 no-op；其他任何现存对象都阻断。删除只允许删除账本身份完全匹配的对象。
6. 账本提交后，才能按对象身份删除不再被引用的库内容。库清理不得递归 `rm`；目录非空则保留未知新增内容并报告 `cleanup-pending`/`degraded`。
7. `FINALIZED` 后操作记录改为不可变幂等结果；同 `operationId`、同请求摘要永远返回原终态，同 id 不同请求拒绝。

`operationId` 使用高熵随机标识。幂等与保留策略与 v7 一致：至少完整保留最近 128 条结果，tombstone 保留 30 天，过期返回 `operation-result-expired`，绝不重执行。`skills.operation.status` 只读；恢复协调器是唯一能在没有新写请求时推进已有事务的组件。

### 4.4 纯校正事务

`skills.repair` 和启动前 `ensureReady` 不改变清单，只把实际投影、系统技能期望态和 `ownership.json` 收敛到已提交状态。显式 repair 必须先取得 `skills.repair.plan`；后台 ensureReady 对所有库有效、无阻断冲突且 `enabled=true` 的技能执行无需新用户确认的校正。状态机、故障边界、`superseded` 语义与 v7 一致：

```text
PREPARED → MANIFEST_CONFIRMED → RECONCILING_TARGETS → OWNERSHIP_COMMITTED → FINALIZED
```

一致性规则（与 v7 一致，摘录不变量）：

- `revision-conflict`、`plan-stale`、`content-conflict`、`token-expired`、`operation-busy` 都是提交前 typed error；`ApplyResult` 只承载 `converged/degraded/indeterminate`。
- 进程内锁复用注入给文件服务的同一个 `FilePathTransactionLock`；跨进程锁位于固定的每用户共享锁根，交互等待 5 秒后返回 `operation-busy`，不得按超时强行破锁。
- snapshot、doctor、plan 与项目列表读取必须等待写事务或使用前后 generation 一致性重试；不得观察“新清单 + 旧投影 + 旧账本”。
- 只有应用、修复、启动前校正与恢复协调器可以改变磁盘；恢复不是 doctor 的隐式副作用。
- 窗口在提交点后关闭只脱离等待，不能取消 main 事务。
- 禁用保留库内容；删除在 apply/repair 前确认，并携带当前 `observedRevision`。漂移内容的删除或采用确认都回显 main 观察到的实际树摘要；确认后内容再变化触发 `content-conflict`。

## 5. 适配、健康和启动

### 5.1 投影、生效矩阵与健康

所有“清单启用 + 库有效 + 无阻断冲突”的技能投影到 `.agents/skills/<id>`；`delivery.claude=true` 时额外投影到 `.claude/skills/<id>`。v1 不额外创建 `.cursor/skills`。目标已存在非托管同名条目时跳过且不覆盖。**不要求本机内容批准。**

`SkillDiscoveryAdapterRegistry` 每个适配器必须声明：项目级发现根（含 Codex walk-up 语义——worktree/monorepo 中仓库根技能不得漏判）、用户级发现根（`userDiscoveryRoots`，供全局枚举白名单与遮蔽判定）、同名/去重语义（`duplicateSemantics`：Claude `user-shadows-project`；Codex `coexist`；OpenCode `priority-override`；Cursor `multi-root-scan` + 版本探测）、会话刷新语义、最低版本、核验日期与官方链接。

`effective-matrix.ts` 是纯派生器：输入文件系统快照（托管投影、非托管目录枚举、用户级白名单枚举、账本），输出 (技能 × 适配器 × 层) 生效矩阵与同名遮蔽/覆盖判定。受管/非托管分类必须 join `ownership.json`。

健康问题必须带 severity、`blockingScopes`、`degradePolicy`、repairable 和 scope。最低映射在 v7 基础上调整：

| 健康码 | 严重度 | 阻断与修复语义 | 默认 `degradePolicy` |
| --- | --- | --- | --- |
| `disabled`、`adapter-disabled`、`agent-not-installed`、`not-applicable` | 信息 | 不阻断 | `allowed` |
| `shadowed-by-user-skill`（新增） | 提醒 | 不阻断；说明该技能对特定智能体被用户级同名遮蔽、本项目版本不生效；提供跳转全局视图 | `allowed` |
| `new-session-recommended`、`git-visible-projection`、`git-tracked-projection`、`cleanup-pending` | 提醒 | 不阻断；tracked 目标的移除必须显式破坏性确认 | `allowed` |
| `projection-missing`、`projection-stale`、`recovery-pending` | 警告 | 可自动修则 ensureReady 修；否则阻断受影响启动 | `allowed` |
| `missing-source`、`invalid-skill`、`library-drift`、`content-conflict` | 错误 | 完整性：采用当前内容 / 恢复 / 删除（不叫重新批准） | `denied`（设置内处理） |
| `unmanaged-conflict`、`managed-target-modified` | 错误 | 阻断改写不确定目标的计划与启动 | `denied`（设置内处理） |
| `project-identity-changed` | 错误 | 当前 `ProjectRootRef` 全部读写失效 | `denied` |
| `ledger-corrupt`、`recovery-record-corrupt`、`recovery-blocked`、`durability-unknown` | 错误 | 阻断写入与启动 | `denied` |
| `filesystem-unsupported`、`permission-changed`、`insufficient-space`、`operation-busy` | 错误 | 当前操作阻断 | `denied` 或稍后重试 |
| `duplicate-discovery` | 提醒 | 不阻断；Claude 双根说明性后果 | `allowed` |
| `agent-version-unsupported`、`unknown-agent-behavior` | 错误 | 按适配器；消解性计划可应用 | `allowed` |

> v9.0：**删除** `approval-required`、`approval-ledger-corrupt`。

层 3（用户全局）事实永不产生阻断问题：遮蔽与覆盖只映射为提醒级说明。清单存在性三态语义与 v7 一致（有效空清单安全清理受管投影；无清单按账本处理残留；无效清单阻断，不得按空清单处理）。

**v8.2 计划侧目标语义补充**（真机验收回归）：

- **形状分类**：计划对每个投影目标做 `absent / pier-symlink / foreign` 分类；`pier-symlink` 必须同时命中所有权账本才算受管——「pier 形状但不在本机账本」（他人提交、跨 profile、账本丢失）一律按非托管处理。
- **创建预检**：目标被非托管对象占用时，计划直接产出 `unmanaged-conflict` 阻断（`applicable=false`），不进入 apply 后再降级；文案指向用户动作（移除原目录或撤销更改）。
- **删除授权**：仅所有权账本条目，或「目标在盘上不存在 + 清单条目存在」（幂等清理残留）可产生 delete 操作；非托管对象永不进入删除计划。收编（`prepareFromDiscovery`）是只读复制，绝不调度对原目录的任何操作。
- **确认边界**：只有 `tracked` 目标的投影删除需要破坏性确认（与修复计划器一致）；删除托管技能的库内容始终需要 `content-delete` 确认，确认绑定计划时的实际树摘要（`expectedActualTreeDigest`），apply 在锁内重比，不符即 `content-conflict`。
- **生效矩阵行归属**：每行单元格先看该行**自身**的存在（托管行=自有投影 join 账本；非托管行=真实目录），同名其它副本只能把状态修饰为遮蔽/覆盖/重复，绝不把未投影的托管行标成「可发现」。同一技能自己的双根投影不构成自我覆盖。

### 5.2 公共启动门

唯一硬门是 main 侧的 `ManagedAgentLaunchGate`：解析出 `agentId` 和规范化 `ProjectRootRef` 后、创建 native surface / spawn PTY / 启动一次性 CLI 前。所有受管入口（新建智能体终端、`terminal.open` launch、worktree 打开终端、重试/重启、恢复后重建、`AiService.generateText` 等一次性 CLI、以及第 8 节系统技能的编排启动）都必须汇入该边界，由架构测试锁定。

1. main 根据 `agentId` 查适配注册表；只有声明消费项目投影的适配器参与硬门，其余返回 `not-applicable`。
2. 公共边界生成高熵 `launchAttemptId`。`ensureReady` 在项目锁内收敛未完成事务，再按清单三态、系统技能期望态和投影账本校正；**不读取内容批准**。健康且一致时不写盘。项目身份来自 main，不信任 renderer 未校验 context。
3. 版本探测默认 2 秒，校正默认 10 秒；超时结构化阻断。
4. 可安全修复的投影缺失/陈旧，同一锁内同步校正；非托管冲突、未消解库漂移、ownership 损坏、未知耐久默认阻止启动。**「未批准内容」不是阻断原因。**
5. 阻断返回 `LaunchGateResult`；attempt 一次性消费。
6. 用户经 `agent.launch.continue` 三选：`open-settings` / `cancel` / `degrade`（仅对仍允许降级的投影/冲突类问题）。
7. 重试握手同前：continuation `launchAttemptId`。
8. 不在启动后后台补投影；降级不写持久忽略规则。

一次性智能体调用（如 `ai.generateText`）没有终端 panel 时：仍走启动门；blocked 时向原业务 UI 返回结构化错误，由调用方决定提示、打开设置或取消；**不得静默 fallthrough 到下一个 agent**（换 agent 绕门等同静默降级）；若业务允许降级必须显式走 `agent.launch.continue`。普通 shell 中用户手动运行智能体时，Pier 无法识别启动时刻，应用后的磁盘状态是主要一致性保证。

## 6. 安全约束

### 6.1 路径、导入与枚举

- `projectRootPath` 必须存在并经 `realpath` 规范化；所有命令重新核对 `ProjectRootRef`。
- `.pier`、`.pier/skills`、`.agents`、`.agents/skills`、`.claude`、`.claude/skills` 每级现存祖先都用 `lstat` 核对为真实目录，拒绝符号链接、reparse point 和非目录。每个发布边界再次核对项目根与祖先身份。
- 项目相对路径拒绝绝对路径、`..`、空段、NUL、控制字符、超长路径，以及大小写折叠或 Unicode 规范化后的重复目标。
- `skills.import.prepare` 自己打开 main 原生目录选择器；命令可携带的预选目录仍由 main 校验为白名单根下的真实目录。renderer 不提交任意导入绝对路径。
- 普通本地导入源不得位于当前项目的 `.pier/skills`、本机 staging 内，也不得与目标库目录是同一文件身份。
- `skills.import.prepareFromDiscovery` 是唯一允许从项目发现根导入的路径：源必须是真实目录、非符号链接、非受管投影，且只做只读复制。
- **编辑候选是新的信任边界**：`prepareContentUpdate` 的内容字节由 renderer 提交，main 必须重新执行全部导入限制（文件数/大小/深度/路径/frontmatter/id 与 name 一致性），摘要与风险一律 main 重算；候选绑定 `baseSkillId + baseContentDigest`，消费时三方一致（候选、草稿项、清单条目）才发布。
- 导入遍历逐项不跟随：`lstat` 后以 `O_NOFOLLOW` 打开普通文件并用 `fstat` 核对设备、inode 和类型。首次复制完成后对源树做第二次完整只读遍历，任一变化返回 `source-changed` 并销毁精确暂存对象。符号链接、硬链接、设备、FIFO、socket 一律拒绝；不保留时间戳、ACL、扩展属性、setuid/setgid。
- 默认限制集中定义在共享契约：最多 2,000 个文件、目录深度 32、单文件 16 MiB、总计 128 MiB、相对路径 UTF-8 长度 1,024 字节；候选暂存总配额 512 MiB。
- YAML frontmatter 最多 64 KiB、最大嵌套深度 16、禁止 alias/anchor、禁止自定义 tag，使用不构造任意对象的安全解析模式。
- apply 消费候选前重新计算暂存树摘要；与 `ImportCandidateView` 不符时返回 `content-conflict`。
- 投影只能是指向同一项目 `.pier/skills/library/<id>` 的相对目录符号链接；绝对链接和逃出项目根的链接拒绝。
- **用户全局枚举（`skills.snapshot` 内部输入）安全边界**：根集合从适配注册表 `userDiscoveryRoots` 派生的固定白名单，不接受调用方提交路径、不做任意遍历；每根 `lstat` 核验为真实目录；仅枚举一层子目录并解析 `SKILL.md` frontmatter（复用安全解析器），不读取脚本正文、不返回文件内容；每根条目数上限（默认 500）与总大小上限；结果不进入任何授权判断，永不触发写路径。这是第 4.1 节读边界的唯一显式例外。

### 6.2 导入提示、漂移完整性、覆盖和删除（v9.0）

技能可含脚本与工具提示；Pier 不做沙箱。导入/收编时可展示构成与风险**提示**（对齐 asm），用户点「添加」即写入库——**不写入批准账本，不作为日后启用门控**。健康检查可提示风险，不声称恶意代码检测完成。

**漂移（完整性）**：`library-drift` / `missing-source` 仍由实际树 vs 清单摘要判定，消费于快照徽标、计划阻断模糊保留、启动校正。消解动作文案：

- **采用当前内容**（更新 `contentDigest`，已启用则继续投影）
- 恢复 / 删除

不叫「重新批准 / 信任当前内容」。`ensureReady` 不自动改写清单摘要；用户采用后才更新。

删除与覆盖规则不变：不静默覆盖非托管；删除必须 join ownership；不覆盖发布。

### 6.3 资源、清扫和可观测性

- import token 高熵、单次消费，绑定 webContents、client instance、项目身份和候选摘要；固定有效期 30 分钟。编辑场景不放宽该约束：编辑草稿正文单独持久化（无授权含义），用户点击「保存」时生成候选并立即提交，候选过期后从草稿正文重新生成。
- 候选状态机为 `AVAILABLE → CLAIMED(operationId) → CONSUMED`，或在提交前失败后精确释放；discard 和 TTL 清扫只能删除 `AVAILABLE/RELEASED`。
- renderer 离开添加检查页、放弃编辑、重新载入或关闭设置时，对不再引用的候选调用 `skills.import.discard`；discard 失败不阻止离开（TTL 清扫兜底），短失败 `toast.error`，含技术详情 `showAppAlert`。
- 不可访问项目的投影账本和恢复日志长期保留。
- 空间预检只改善提示。`ENOSPC`、`EDQUOT`、`EACCES`、`EPERM`、`EROFS`、`EXDEV` 和目录同步失败映射为稳定错误码；旧内容和旧账本在新状态确认耐久前不得删除。
- 本机操作日志记录 operation id、阶段、revision、耗时、目标相对路径和 errno；不记录技能正文、token、绝对暂存路径或敏感 frontmatter。

## 7. 设置界面和 Git

### 7.1 信息架构

界面方向是“克制的桌面工具台”。**项目相关设置先收结构，再进配置**：侧栏只有「项目」一项；进入后先选项目，再在项目内切换环境 / 技能。深链别名 `environment` / `skills` 规范化为 `projects` + 对应 Tab（域服务仍分属 `local-environments` 与 `project-skills`）。

| 视图 | 进入方式 | 内容 |
| --- | --- | --- |
| 项目列表 | 设置侧栏「项目」；无已选项目时 | 共享环境索引中的项目行（名称 / 路径 / 当前徽标）；「添加项目」 |
| 项目详情壳 | 列表行进入；活动项目可直达；`openSection("environment"\|"skills")` / `pier.skills.open` | 顶栏返回 + 项目名；Tab：**环境 \| 技能 \| 常规**（下划线 line；第三 Tab 不用「设置」） |
| 环境 Tab | 默认或环境深链 | 既有环境编辑器（Setup / Cleanup / 复制模式 / 变量）；顶栏仅保存 |
| 技能详情（主线） | 技能 Tab；`pier.skills.open({ projectRootPath, focusIssueIds? })` | 托管 + 非托管统一技能列表；动作即提交；不含投放开关 |
| 常规 Tab | 项目内第三 Tab | 发现路径双开关（`.agents/skills` / `.claude/skills`，可全关）；从索引删除项目 |
| 技能页 | 列表行「打开」 | **同一页**：可编辑托管 = 正文编辑器 + 矩阵 + 保存；只读（仓库内 / 用户全局 / 系统 / 无写权限）= 同布局不可改 |
| 添加预览 | 「添加技能」导入/收编 | 可选构成与风险提示后添加；**非批准门** |

层 3（用户全局）事实不再有独立视图（业界无参照物）：`~` 级枚举只作为生效矩阵输入，遮蔽/覆盖以行内徽标与技能详情矩阵行呈现（参照 Claude 官方优先级文档 personal > project 与 Cursor 合并列表形态）。

当前工作区是默认上下文：进入项目设置且存在活动项目时，直接打开该项目详情（Tab 由深链或上次意图决定）；共享环境索引只用于项目列表与跨项目入口，不是访问当前项目技能的门槛。「添加项目」仍写共享索引；技能 Tab 不提供移除项目（移除在**常规** Tab）。设置外壳只在环境编辑器脏、写事务结果尚不明确或技能编辑器仍有未保存正文时阻止离开。

投影目标为清单 `delivery.agents` / `delivery.claude` 双开关（可全关 = 不投影）；旧清单仅有 `claude` 时读入补 `agents: true`。

设置 `Dialog` 外壳、28px 单行控件、12px 节奏、等宽字体用途、状态图标+文字双通道、`settings.skills.*` / `settings.projects.*` i18n、Alert 必须在 `Card`/`CardContent` 内等约束与 v7 相同。

### 7.2 项目列表

- 行展示项目名、完整路径、托管技能数；当前 `PanelContext` 项目带「当前」徽标并置顶，其余按最近使用排列。尾部只有进入箭头。
- 不展示健康摘要，无 stale/cached 新鲜度机制；健康进详情看。
- 首次加载用等高 `Skeleton`；无项目时 `Empty` 主动作「添加项目」；单项目读取失败保留行并显示「无法读取」。

### 7.3 项目详情：统一技能列表

托管（层 6）与非托管（层 5）技能在同一列表——它们是同一扫描面的受管/非受管条目：

- 工具栏筛选：「全部 / 我管理的 / 仓库内 / 本机全局」（§7.12）；启用看行内开关。
- **托管行**：名称、描述、来源徽标、**启用开关**（已打开/已关闭）、「打开」。
- **生效**：行内「N 个智能体可使用」或「未对智能体开放」；异常用短句徽标（遮蔽/重复等，§7.12）。
- **完整性**：内容已修改 / 内容缺失。
- **用词**：严格 §7.12；禁止批准/审阅/信任/待应用。
- **非托管 / 本机全局 / 系统**：只读打开；仓库内可「用 Pier 管理」。
- **发现路径**：在常规 Tab 配置 `delivery.agents` / `delivery.claude`（可全关）；技能列表不再放投递开关。
- 删除确认必须区分关闭 vs 删除（§7.12）。
- 动作即提交；协议层 plan→apply 不外露。
- `ItemGroup` 子元素为 `<li>`；`Switch` 不嵌套进整行 button。
- `duplicate-discovery` 仅提醒。

### 7.4 技能页：编辑即详情（v9.0）

**取消独立「详情 → 再点编辑」两步。** 列表「打开」进入的就是技能页；托管且可写时页面本身就是编辑器。

| 模式 | 何时 | 页面 |
| --- | --- | --- |
| **可编辑** | Pier 托管用户技能且可写 | 头部名称/来源/开关态/删除；正文 Textarea；脏时「放弃更改」+「保存」；下方「哪些智能体可以使用」；漂移横幅用 §7.12 |
| **只读** | 仓库内 / 本机全局 / 系统 / 项目只读 | 同壳；正文只读；说明「Pier 不会改动」；仓库内可「用 Pier 管理」 |

- 主按钮「保存」；**无「编辑内容」**。
- 漂移：「采用当前文件」；未处理前优先阻止继续保存歧义内容。
- 可写/只读共用一壳。

### 7.5 添加技能（v9.0 · 无信任门）

添加菜单：「从文件夹导入」「新建技能」。

- 导入/收编：预览（可选风险提示）→「添加技能」→ 列表默认**已关闭** + §7.12 导入后提示。
- 新建：表单 →「创建」→ 默认关闭。
- 无批准/审阅页。

### 7.6 层 3（用户全局）事实的呈现（v8.1 简化）

独立“全局技能视图”与行级“导入到项目”已移除——Cursor / Claude Code / skills CLI 均无此形态。保留：

- main 侧白名单枚举（注册表派生 `~` 级根）继续作为生效矩阵输入，驱动 `shadowed-by-user-skill` 通知与行内徽标；同一次枚举（含 frontmatter 元数据）也直接喂统一列表的用户全局行（§7.3），不再有独立命令或视图。
- 遮蔽事实在托管行徽标（「Claude · 被用户级同名遮蔽」）与技能详情矩阵行（附全局目录路径文本）呈现。
- 用户全局目录由用户在文件系统自行维护，Pier 永不写入；导入外部技能统一走「添加技能 → 从文件夹导入」（对话框可直接选任意目录，含 `~/.claude/skills`）。

### 7.7 动作即提交、确认与离开守卫

- 每次用户动作只携带一个产品意图；renderer 可用瞬时 `ProjectSkillsDraft` 作为协议载体，但界面不展示草稿、待应用更改或全局 Apply。
- 动作先调用 `skills.plan`。无确认要求则立即 `skills.apply`；有要求则在该动作上下文中按顺序展示用户可读确认，生成 acknowledgement 后立即 apply。取消确认不改变磁盘事实。
- 开关、投影设置等有强自然反馈的动作成功不 toast；失败回滚并用 `showAppAlert` 说明下一步。导入、采用当前文件、保存、删除成功以列表/详情变化作为完成信号，不重复 toast。
- `degraded` 显示「技能已保存，但部分智能体尚未就绪」与「重试」；repair 作为一次性动作独立收集确认，不依赖底栏。
- `indeterminate` 冻结写操作并显示「正在确认磁盘状态…」，按 operation id 轮询直到不可变终态；窗口关闭只脱离等待，不取消 main 事务。
- snapshot/doctor 按请求序号，动作内 plan 按意图指纹，apply/repair/operation.status 按 operation id 拒绝迟到结果。
- 设置离开守卫只覆盖两类状态：编辑器仍有未保存正文；或写入结果尚不明确。检查页未确认候选在离开时幂等 discard，不弹「应用或放弃」。

### 7.8 启动阻断界面

`ManagedAgentLaunchGate` 阻断时，交互式入口使用 `showAppChoice`（`confirm = 打开技能设置`、`alt = 仍然启动`、`cancel = 取消`；最严重策略为 `denied` 时隐藏或禁用「仍然启动」；`intent` 按最严重策略取 `default/destructive`）：

- 「打开技能设置」取消本次启动，调用 `pier.skills.open({ projectRootPath, focusIssueIds })` 并把问题 `Alert` 滚入可见区域。
- 「仍然启动」回传 `launchAttemptId + decision`，main 校验后按第 5.2 节降级；文案匹配真实风险，不得统一写成「可能缺少或重复技能」或「忽略错误」。
- 弹窗期间临时终端 panel 显示「等待技能投影确认」不接受输入；关闭/复用取消 attempt；降级成功经 continuation 握手复用同一 attempt 启动。`SPAWN_INTENT` 后结果不明显示不可重试错误并提供「新建终端」。
- 一次性 CLI 没有 panel 时由原业务 UI 展示等价选择或直接失败，不得静默降级或换 agent 绕门。

### 7.9 加载、空态、错误态和反馈清单

| 场景 | 页面状态 | 用户反馈 |
| --- | --- | --- |
| 首次读取快照 | 等高 `Skeleton`；写操作不可用 | 不显示 toast |
| 切换开关 / 投影设置 | 行内进行态 → 磁盘结果 | 成功不加 toast（开关状态即反馈）；失败 `showAppAlert` 并回滚 |
| 导入/收编/新建 | 预览或表单 → 列表 | 取消无反馈；失败 `showAppAlert` |
| 启用开关 | 行内 → 投影 | 列表变化即反馈；无「批准并启用」 |
| 健康事实 | 随快照自动计算并内联展示（无手动「检查健康」按钮——业界无此形态，快照本就内嵌 doctor）；`skills.doctor` 命令保留给 CLI | 无 toast |
| 单动作提交成功 | 快照与矩阵更新 | 依赖自然反馈，不额外 toast |
| 提交部分失败 | Card 顶部 `Alert` +「重试」 | `showAppAlert` 技术详情 |
| 耐久状态不明 | 冻结写操作并轮询恢复结果 | 持久 `Alert`，无成功/失败 toast |
| 项目/清单只读、项目消失 | 保留项目头，禁用写操作 | `Alert` 给下一步动作，不显示空技能页 |
| 没有技能 / 无筛选结果 | 两套不同 `Empty` | 分别提供「添加技能」/「清除筛选」 |
| 复制路径、摘要、错误或 Git 建议 | 页面无自然变化 | `toast.success`；失败按反馈规范分层 |
| 用户全局行 | 统一列表内只读行，无动作 | 无 toast |

### 7.10 响应式、键盘和组件约束

与 v7 §7.8 一致：低于 `md` 用完整栏目选择器；760px 以下技能行重排；路径可复制；搜索有 `sr-only`；只用 `@pier/ui`；不新增全局快捷键。

### 7.11 Git 协作

推荐提交 `.pier/skills/manifest.json` 与 `.pier/skills/library/**`，推荐不提交发现投影。Pier 不静默改 `.gitignore`。设置页展示受管目标 Git 五态并提供忽略建议复制。Git 状态不构成内容授权。

### 7.12 用户文案金标准（v9.0 · 主路径）

从用户目标出发，主路径只用下表。禁止「批准 / 审阅 / 信任 / 待应用 / 投影 / digest / Pier 托管（作筛选名）」出现在主路径。

| 场景 | 中文 | English |
| --- | --- | --- |
| Section 说明 | 管理此项目的智能体技能。不会改动本机全局技能文件夹。 | Manage agent skills for this project. Does not change your Mac-wide skill folders. |
| 空项目标题 | 此项目还没有技能 | No skills in this project yet |
| 空项目说明 | 从文件夹导入，或新建一个。添加后默认关闭——打开开关后智能体即可使用。若已用其他工具装进项目，会出现在「仓库内」。 | Import from a folder or create one. New skills stay off until you turn them on. Skills already installed by other tools show under “In project”. |
| 筛选 | 全部 / 我管理的 / 仓库内 / 本机全局 | All / Managed by me / In project / On this Mac |
| 添加菜单 | 从文件夹导入 / 新建技能 | Import from folder / New skill |
| 导入预览主按钮 | 添加技能 | Add skill |
| 导入后提示（列表内一行，可关） | 已添加「{{name}}」（已关闭）。打开开关后智能体即可使用。 | Added “{{name}}” (off). Turn it on when you want agents to use it. |
| 行状态 | 已打开 / 已关闭 | On / Off |
| 行次要 | N 个智能体可使用 / 未对智能体开放 | Available to N agents / Not available to agents |
| 发现路径（常规） | 项目共用路径（.agents/skills） / Claude Code（.claude/skills） | Project shared path (.agents/skills) / Claude Code (.claude/skills) |
| 发现路径说明 | 选择要把已打开的技能放进哪些发现目录。都不选时，智能体不会发现这些技能。 | Choose which discovery folders should include skills that are on. If none are selected, agents will not find these skills. |
| 技能页（可写）主按钮 | 保存 | Save |
| 放弃 | 放弃更改 | Discard changes |
| 删除 | 删除此技能 | Delete this skill |
| 删除确认说明 | 将从本项目移除该技能。关闭开关只会让智能体暂时看不到它。 | Removes the skill from this project. Turning the switch off only hides it from agents. |
| 只读角标说明 | 此技能由所在文件夹维护，Pier 不会改动。 | Maintained in its own folder. Pier never changes it. |
| 收编按钮 | 用 Pier 管理 | Manage with Pier |
| 收编说明 | 复制一份到 Pier 管理，原文件夹保持不动。 | Copies it into Pier. The original folder is left as-is. |
| 矩阵标题 | 哪些智能体可以使用 | Which agents can use this |
| 可用 / 未开放 | 可以使用 / 未启用 | Available / Not enabled |
| 遮蔽 | 被本机全局的同名技能挡住 | Hidden by a same-named skill on this Mac |
| 漂移标题 | 此技能已在 Pier 外被修改 | This skill was changed outside Pier |
| 漂移说明 | 磁盘上的文件与 Pier 里记录的不一致。可采用当前文件，或删除该技能。 | Files on disk no longer match what Pier recorded. Use the current files, or delete the skill. |
| 漂移主按钮 | 采用当前文件 | Use current files |
| 启动门标题 | 技能还没准备好 | Skills aren’t ready yet |
| 启动门说明 | 请先打开技能设置处理显示的问题，或仍然启动（可能缺少技能）。 | Open skill settings to fix the issues shown, or launch anyway (skills may be missing). |
| 部分未就绪 | 技能已保存，但有的智能体还用不了。请重试。 | Skills were saved, but some agents still can’t use them. Retry. |

停用 vs 删除（必须在删除确认中点明一次）：**关闭** = 智能体看不到，文件还在；**删除** = 从项目技能中移除。

### 7.13 设计验收（findings=0）

- [x] 主路径无批准/审阅/信任/待应用/「编辑内容」跳转
- [x] 打开托管技能 = 可写编辑器；只读仅仓库内/本机全局/系统
- [x] 导入/新建默认关闭，且空态或导入后提示说明要开开关
- [x] 常规 Tab 双开关配置发现路径（可全关）；主路径无「也提供给 Claude」单开关残留
- [x] 筛选四档用 §7.12 用词
- [x] 漂移用「采用当前文件」
- [x] 原型与 §7.12 一致

## 8. Pier 系统技能通道

Pier 系统技能 = Pier 本体或官方受管插件**随版本携带**的能力技能：教智能体使用 Pier 的 canvas、面板、文件工具，或注入多智能体互调协议。它不是用户资产，而是 Pier 能力面的一部分；受管启动前保证正确版本的能力技能已注入、再 spawn，是启动门语义的直接兑现。

| 维度 | 设计 | 与用户托管技能的差异 |
| --- | --- | --- |
| 来源与完整性 | 内容只来自 app 资源目录或官方受管插件包的不可变版本目录，绑定 `systemProvider{id,version}` + 树摘要；来源由 managed-plugins 签名管线或 app 版本证明 | 用户技能由项目 manifest + 库内容定义；两者都不写内容批准条目 |
| 期望态存放 | 不进 Git manifest。每项目启停存本机 `system-skills.json`（`{userData}` 项目域，generation 条件替换）；默认随能力开启（如项目启用 canvas 插件即注入） | 用户技能期望态在 manifest（团队共享）；系统技能绑定本机 Pier/插件版本，进 Git 会让不同版本成员互相覆盖 |
| 投影与清理 | 复用同一投影通道：内容快照发布进 `.pier/skills/library/<pier-id>/`，相对符号链接进 `.agents/skills`（按 targetAgents 需要时 `.claude`），ownership 照常记账；插件停用/卸载或项目停用时按对象身份精确清理 | 完全一致——删除安全、非托管不覆盖、Git 忽略建议全部继承 |
| 版本收敛 | app/插件升级 → 内容树摘要变化 → `ensureReady` 在下次受管启动前自动重发布 + 重投影；无需额外用户动作 | 用户技能摘要变化 = 完整性漂移，须「采用当前文件」/恢复/删除；系统技能版本变化 = 正常升级 |
| 贡献纪律链 | 与 `workbenchWidgets` 同款：plugin.json 声明 skills 贡献 → main 校验声明（`assertDeclaredContribution` 同构）→ 系统技能注册表 → 投影通道。贡献声明 `targetAgents`（全部/指定）与可选 per-agent 变体 | 只对 builtin 与官方受管插件开放；第三方插件贡献禁止（与插件边界纪律一致） |
| 命名与呈现 | 强制 `pier-` 前缀（如 `pier-canvas`、`pier-agent-relay`）；项目详情列表「Pier 系统」徽标；开关 = 本项目启停（本机）；不可编辑、不可删除；详情显示提供方与版本 | 对齐 Claude `plugin:skill` 命名空间先例；生命周期随版本走 |
| 多智能体互调 | 编排方（插件/宿主）为项目启动多个受管智能体前，经 `ensureReady` 确保互调协议技能已按 `targetAgents` 注入对应发现根；启动门保证注入完成才 spawn，失败默认不启动 | 无对应物 |

两条安全红线：

1. 系统技能来源仅限「经受管插件管线校验的不可变版本目录」与 app 自带资源；dev override / workspace 模式的插件技能在生产包按第三方拒绝。dev 运行时的系统技能注入必须在 UI 中显式标注开发来源。
2. 系统技能同样走投影 + ownership，绝不豁免删除安全；也绝不写用户级目录——注入范围永远是项目发现根，且对非受管启动只保证磁盘状态、不承诺时序。

## 9. 明确禁止的反模式

- 重新引入本机内容批准账本、`approval-required`、或「需要审阅才能启用」主路径（违背 v9.0 金标准）。
- 把「比业界更严的信任门」写成产品差异化目标。
- 仅凭链接目标判定投影所有权（必须 join ownership）。
- 内容常驻发现目录却只在清单标 `enabled: false`（应拆除投影）。
- spawn 后后台校正并声称本次会话已加载。
- 对非托管冲突静默覆盖或删除。
- 默认写入用户级技能目录（与 skills 默认项目范围不一致时须显式产品决策）。
- 无供应链设计时加入远程市场。
- 主路径使用 plan/digest/approval 等协议词。
- 设置 section 使用裸 `Alert`，或做只包 Alert 的空壳 Card。
- 为尚未验证的智能体展示可开启投递开关，或只用颜色表示生效/健康结论。
- 使用多层滚动容器，让固定操作栏遮住最后一项技能或错误详情。
- 只用清单摘要作为并发 revision，或在普通应用中隐式更新 `contentDigest`。
- 在目标校验后使用普通覆盖式 `rename` 发布投影；用递归 `rm` 清理或替换库目录。
- 为技能模块另建一把不与文件服务共享的进程内锁，或把 single-instance 当成跨 profile 项目锁。
- 把无清单、有效空清单和无效清单都当成 no-op，留下旧投影继续被发现。
- 声称对不合作外部写者提供真正的文件系统 CAS，或声称冻结智能体启动后的目录读取版本。

## 10. 最小实施方案

现状：S0（证据与原语）与 S1（main 事务底座、契约、命令、锁、投影账本/恢复）已实现并有单测覆盖；本修订在其上按以下阶段收敛。

- **阶段 A（并行）**：
  - A1 项目定位对齐环境模式（并入面板 roots；renderer 换共享索引 add；删除 pick 流程）。
  - A2 `effective-matrix.ts` 派生器 + snapshot 加宽（name/description：frontmatter 解析抽独立模块并按摘要缓存；(技能×适配器×层) 矩阵；非托管枚举；`isManagedProjection` join ownership 收紧）+ 注册表扩展（`userDiscoveryRoots` / `duplicateSemantics` / walk-up）+ 新健康码 `shadowed-by-user-skill`。
  - A3 启动门接通：blocked 结构化返回（`CreateTerminalResult` 扩展）+ 三选弹窗 + `agent.launch.continue` + continuation 握手；`ai.generateText` blocked 返回结构化失败不 fallthrough。
- **阶段 B**：项目详情页（统一列表、行内生效徽标、动作即提交、Claude「也提供给…」开关、收编入口）。依赖 A2。
- **阶段 C**：添加管线（两入口菜单；外来字节构成与风险提示；`prepareTemplate` 轻确认）。manifest schema 不动。
- **阶段 D**：技能页单页编辑（可写）/ 只读同壳；`prepareContentUpdate`；漂移「采用当前内容」；库替换事务。依赖 C。
- **阶段 E**（v8.1 改道）：用户全局事实并入统一列表（快照加宽 `userGlobalSkills` + 只读行）；不再有独立命令与视图。依赖 A2。
- **阶段 F**：Pier 系统技能通道（同上）。依赖 A2/C，可与 D、E 并行。
- **阶段 G（v9.0）**：与外部安装器共存验收（项目发现根内真实目录显示为仓库内；受管 symlink 不被外部改写时不静默认领）；添加菜单与启用即投影的 UI/组件测试；Claude 开关用户文案。
- **尾**：Git 五态生产接线（注入 `inspectGitState` + snapshot 消费）；Cursor 等版本探测框架（可后置）。
## 11. 需求到证据的验收矩阵

| 需求 | 验证方式 | 预期证据 |
| --- | --- | --- |
| 清单严格校验 | `project-skills-contract.test.ts` | 非法/重复 id、未知字段、name 不匹配拒绝；`pier-` 前缀保留给系统技能；厂商 frontmatter 保留但不执行 |
| 计划与磁盘权威 | `settings-dialog-skills.test.tsx`、路由测试 | 动作即提交；renderer 瞬时意图不展示为第二套状态；不能提交来源、摘要、内容授权位或投影结论；只有 apply 改变期望状态 |
| 统一列表与视图模式 | 组件测试 | 托管/非托管/系统/用户全局行正确；生效徽标密度；无待应用底栏 |
| 添加菜单与启用行为 | 组件测试 | 添加菜单仅导入+新建；新建轻确认；外来字节可展示构成与风险；新增默认关闭；打开开关立即 plan/apply 并投影 |
| 与外部安装器共存 | 枚举与收编测试 | 项目发现根真实目录为仓库内；收编只读复制；用户级根无 Pier 写入 |
| 项目定位与共享索引 | store 与命令测试 | 索引 ≠ 授权三不变量；当前项目直达；移除索引不删账本；技能页无移除项目 |
| 生效矩阵 | `effective-matrix` 单测 | 遮蔽方向正确（Claude 用户级遮蔽项目级）；OpenCode 覆盖语义；Codex 双根与 walk-up；受管分类 join ownership；层 3 永不阻断 |
| 用户全局只读行 | 枚举与快照测试 | 白名单根之外不枚举；仅 frontmatter、条目上限生效；无任何写副作用；统一列表行只读无动作 |
| 启用即投影 | 组件、apply 与启动测试 | `enabled=true` 不需要内容确认；新 clone 可由 apply/ensureReady 创建投影；失败回滚开关并给出下一步 |
| 单动作提交 | 组件与路由测试 | 开关变化走完整 plan/apply 校验；仅操作风险产生确认；界面无批量草稿和全局 Apply |
| 内容编辑 | 编辑候选测试 | renderer 字节经 main 全量限制与重算；`baseContentDigest` 失配返回 `content-conflict`；保存立即提交；本地草稿持久化与候选过期重生成 |
| 库替换事务 | apply/cleanup 故障注入 | 替换 = 身份清理 + no-replace 发布 + 提交前摘要前置；不递归 `rm`；同步不明归约 `indeterminate` |
| 漂移完整性采用 | apply 与内容更新测试 | 「采用当前文件」绑定 `expectedActualTreeDigest`；提交后更新 `contentDigest`，已启用技能继续投影；并发变化返回 `content-conflict` |
| 无批准账本 | store、plan 与启动测试 | 不读写 `approvals.json`；`observedRevision`、plan 和 ensureReady 不含批准谓词；迁移期遗留文件不影响结果 |
| 导入风险提示 | 组件与导入服务测试 | 外来字节可展示完整构成与风险；新建不进完整提示页；提示不授权启用；新技能默认停用；返回/取消 discard |
| 非托管呈现与收编 | 组件与服务测试 | 非托管行只读；收编只读复制不动原目录；不覆盖不删除不认领 |
| 多窗口并发 / 同项目计划竞态 / 分命令响应竞态 | store 与服务测试 | 与 v7 相同：observedRevision 覆盖全部本机状态；迟到 plan 按草稿指纹拒绝；apply 按 operation id 接收 |
| 跨进程并发 / 跨 profile 所有权 | 双进程/双 profile 集成测试 | 与 v7 相同 |
| 崩溃恢复 / 纯校正恢复 / 耐久与空间错误 / 请求幂等与保留 / 严格结果联合 | 故障注入与契约测试 | 与 v7 相同；新增库替换阶段的注入点 |
| 非托管与伪造标记 / 投影对象身份 / 内容并发 / 路径和导入竞态 / YAML 资源边界 / 不覆盖和保守发布 / 库清理对象身份 / 项目身份 / 账本与恢复损坏 / 清单三态 / 读一致性 / 只读权限无副作用 / 暂存与清扫 / 文件系统边界 | 既有测试集 | 与 v7 相同 |
| 新 clone 投影 | apply 与 `project-skills-launch.test.ts` | 仅凭有效 manifest + library 中的 `enabled=true`，apply/ensureReady 创建投影并允许启动；无本机内容状态前置 |
| 适配与同名语义 | `project-skills-adapters.test.ts` | 发现根（项目 + 用户级）、walk-up、duplicateSemantics 来自注册表；Claude/OpenCode/Codex/Cursor 语义与 §2.2 一致 |
| Codex、Claude Code 真实探测 | 集成探测 | 新会话启用可见、禁用不可见；Claude 适配控制 `.claude/skills`；用户级同名场景产生 `shadowed-by-user-skill` |
| 启动顺序与架构 | 架构测试、`project-skills-launch.test.ts` | 所有受管入口汇入启动门；ensureReady 后才 spawn；失败默认不启动 |
| 一次性 CLI 门控 | `ai-service-skills-gate.test.ts` | blocked 返回结构化错误；不静默 fallthrough 换 agent |
| 启动阻断与重试握手 | 启动集成测试 | attempt 一次性消费；denied 隐藏降级；continuation attemptId 放行 SPAWN_INTENT 且不 replay；intent 后崩溃不自动重放 |
| 系统技能通道 | 通道单测 + 架构测试 | 来源仅限受管供应链；dev override 拒绝；期望态不进 manifest；版本升级经 ensureReady 收敛；卸载按 ownership 清理；`pier-` 前缀强制 |
| 全局目录不变 | 集成测试 | 应用前后全部用户级发现根无 Pier 新增条目（含系统技能场景） |
| 命令治理 | `project-skills-command-router.test.ts` | 所有 `skills.*` 与 `agent.launch.continue` 均有 strict schema、capability 和 allowed client kinds |
| 健康与计划阻断 | 契约和启动测试 | 每个 code 的 severity、blockingScopes、degradePolicy、repairable 固定；消解性计划可应用 |
| Git 协作 | 组件、Git index 竞态、校正服务测试 | 与 v7 相同；忽略建议覆盖系统技能投影 |
| 操作反馈 | 组件测试 | 无静默失败、无重复 toast；快路径失败回滚并 `showAppAlert`；复杂风险留在页内 |
