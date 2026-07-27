# Git 能力清单：Vibe Coding 视角（Pier × Cursor × Codex）

> **修订：r3-audit（2026-07-26）**  
> 相对 r2 的修正：逐项对照 **本分支源码与既有 design**，禁止把「已交付能力」标成缺口；禁止用 Codex「隐式每线程 worktree」否定 Pier「显式创建 worktree」产品路径。  
> 路径：`docs/superpowers/specs/2026-07-26-git-capability-gap-analysis.md`  
> 分支：`feature/git-plugin-capabilities`

---

## 0. 怎么读这份文档

### 0.1 判定规则（避免再乱标）

| 标记 | 含义 | 判定依据 |
| --- | --- | --- |
| **● 已具备** | 产品主路径可用 | 有 UI 入口和/或完整 IPC+调用方；设计文档已落地 |
| **◐ 部分** | 有底座或半截 UX | 例如仅 list、仅检测冲突、仅 IPC 无产品入口 |
| **○ 不具备** | 代码/产品均无 | 检索无契约、无命令、无 UI |
| **✕ 有意不做** | 文档明确取消或范围外 | 如 Changes 侧栏 commit 表单 |

**不把下列情况当成缺口：**

- Cursor/Codex 有、但与 Pier 产品选型不同（例如每线程强制 worktree）  
- 仅「没有和 VS Code 同款 UI」但 Pier 已有等价主路径  
- 能力在 agent 终端里可用、宿主故意不做第二套（记分卡：AI 审查外置）

### 0.2 证据范围（本分支）

| 层 | 位置 |
| --- | --- |
| 契约 | `src/shared/contracts/git*.ts`、`worktree.ts`、`git-commands.ts` |
| 服务 | `src/main/services/git*`、`worktree-service.ts`、`git-review/`、`git-autofetch-service.ts` |
| 插件 | `src/plugins/builtin/git/**`（manifest、审查、状态栏、worktree 创建） |
| 文件装饰 | `src/plugins/builtin/files/**` gutter / 树装饰 |
| 设计 | worktree 创建、status bar、review、**已取消** commit mainline 等 |

### 0.3 三家角色（只作对照，不作「必须抄」）

| 产品 | Git 角色 |
| --- | --- |
| **Pier** | 工作台：隔离开工、变更审查、状态同步；写操作命令面板齐全；**交付确认流未产品化** |
| **Cursor** | 完整 IDE SCM + AI message / PR / agent worktree |
| **Codex** | 线程 worktree + 线程内 diff + 交付条（commit/push/PR） |

### 0.4 Vibe 主路径（Pier 实际已覆盖的一段）

```text
创建工作树（任务描述 → 分支名 → create → setup → 终端/agent）  ● 已有
    → agent 改代码
    → Changes 审查 + 文件级 stage/unstage/discard              ● 已有
    → 状态栏 pull/push/sync、暂停操作 continue/abort            ● 已有
    → 提交 / 发布分支 / 开 PR                                    ← 见 §3 真实缺口
```

---

## 1. 总表（逐项审计）

列说明：

- **Vibe 相关**：是否影响 vibe 日路径（高 / 中 / 低 / 无关）  
- **Pier**：● / ◐ / ○ / ✕ + **现状摘要（含入口）**  
- **对照**：Cursor / Codex 仅一句，防误判  
- **还要做吗**：无则写「无」；有则写**具体缺口**，禁止空泛「加强绑定」

| ID | 能力 | Vibe | Pier | 现状与证据 | Cursor | Codex | 还要做吗 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **ISO-WT-CREATE** | 创建工作树并开工 | 高 | **●** | `pier.worktree.create` + overlay：任务描述、AI 分支名、`worktrees.create`、setup、`openTerminal`（可 `agentId`+`taskPrompt`）。设计：`2026-07-02-worktree-creation-design.md`（vibecoding-first） | 有 agent worktree | 线程默认 worktree | **无。** 不是缺口。与 Codex 差异是「显式创建」vs「隐式线程」，属选型 |
| **ISO-WT-MANAGE** | 列表 / 删除 / 清理 | 中 | **●** | `pier.worktree.list\|delete\|prune`；状态栏可切工作树 | 有 | 有 | **无** |
| **ISO-WT-CONTEXT** | 面板路径 → git root | 高 | **●** | `panel-context-resolver`：`gitRoot` / `worktreeRoot` / `projectRootPath`；状态与 git 命令按 cwd/root | 有 | 有时不同步 | **无**（除非有具体错绑 bug，不属能力缺失） |
| **ISO-BRANCH** | 切换 / 新建并切换分支 | 中 | **●** | `pier.git.switchBranch`；`git.createBranch` / `createAndSwitchBranch` / `checkoutBranch` / `deleteBranch` | 有 | 有 | **无** 作为独立 P0 |
| **SEE-STATUS** | 分支/脏/操作中/± | 高 | **●** | `git.getStatus` + watch；状态栏 branch/changes；repoState（merge/rebase/…） | 有 | 弱 | **无** |
| **SEE-AHEAD** | ahead/behind | 高 | **●** | status.branch + 状态栏 sync 项 | 有 | 弱 | **无** |
| **SEE-AUTOFETCH** | 后台 fetch | 中 | **●** | `git-autofetch-service`；UI 有 fetch 新鲜度提示 | 有 | ◐ | **无**（用户「Fetch」菜单非必需） |
| **SEE-GUTTER** | 编辑器变更边条 | 中 | **●** | files 插件 git gutter + watch | 有 | 无 | **无** |
| **SEE-TREE** | 文件树装饰 | 中 | **●** | files 树 git 装饰 | 有 | 无 | **无** |
| **REV-PANEL** | Changes 审查面板 | 高 | **●** | `pier.git.changes`；`pier.git.viewChanges`；状态栏 ± 打开 | SCM | 线程 FileDiff | **无** |
| **REV-SCOPE** | 未提交 / 提交 / 相对分支 | 高 | **●** | `gitReviewTarget`：uncommitted \| commit \| branch；scope switcher | 有 | ◐ | **无** |
| **REV-DOC** | 大 diff 文档模型 | 高 | **●** | `git.getReviewIndex` / `getReviewFileDocument` / cancel；预算与 identity | multi-diff | FileDiff | **无** |
| **REV-FILE-OPS** | 文件 stage/unstage/discard | 高 | **●** | 树右键 + diff 头 +/−/restore；`git.stage`/`unstage`/`discardChanges`；设计已实现 header 操作 | 有 | 有 | **无** |
| **REV-HUNK** | Hunk stage | 中 | **●**（2026-07-27） | 对齐 Codex：hunk 工具条 + `git.applyPatch`（`git apply --cached`/`-R`）；见 `2026-07-26-git-review-hunk-stage-design.md` | ● | ● | **已按 Codex 重做** |
| **REV-AI** | AI 找问题 / Agent Review | 中 | **○ 宿主** | 记分卡：展示现场，AI 审查交 agent；无 Bugbot 内嵌 | ● | ● | **无宿主必做**；靠终端 agent / 外置即可 |
| **SHIP-COMMIT-IPC** | commit 执行能力 | 高 | **◐** | **`git.commit` IPC 有**（message/allowEmpty/signoff）；**插件 UI 无调用方**（renderer 无 commit 入口） | ● SCM | ● 交付 | 见 **SHIP-FLOW** |
| **SHIP-FLOW** | 交付确认流（说明+文件+提交/推） | 高 | **○** | 无「审查后确认交付」产品流；**✕** 经典 Changes 底栏输入框（`2026-07-22-git-commit-mainline` 已取消） | SCM+AI message | 交付条 | **真缺口（若要宿主交付）**：应做确认卡/命令/技能，**不是**复活输入框表单 |
| **SHIP-AI-MSG** | 由 diff 生成提交说明 | 高* | **○** | 无；AI `generateText` 仅用于 **worktree 分支命名** | ● | ● agent | 仅当做 SHIP-FLOW 时一并做；单独无入口无意义 |
| **SHIP-PUSH** | 推送（已有 upstream） | 高 | **●** | `git.push`；命令 `pier.git.push`；状态下拉/同步项 | ● | ● | **无**（有 upstream 时） |
| **SHIP-PUBLISH** | 首次发布 `push -u` | 高 | **○** | `pushBranch` 固定 `git push`；无 upstream 时下拉仅 **灰字「无上游分支」**（`noUpstream` 不可点），无 Publish | ● Publish | ● | **真缺口**：新分支常见；应用可点「发布」→ `push -u` |
| **SHIP-PULL** | 拉取 | 中 | **●** | `pull --ff-only` + 脏工作区拦截文案；`sync` = rebase+push | 多策略 | ◐ | **无** vibe 阻塞；分叉用 sync |
| **SHIP-SYNC** | 一键同步 | 高 | **●** | `git.sync`；状态栏确认可配；in-flight 去重 | ● | 弱 | **无** |
| **SHIP-PR** | 创建 PR/Draft | 中–高 | **○** | 无 gh/API 封装、无命令 | ● | ● | **可选**；团队场景有价值；个人可 agent `gh pr create`。记分卡不要求宿主重复造 GitHub 中心 |
| **OPS-STASH** | 贮藏全家桶 | 中 | **●** | 命令面板 stash/pop/apply/drop/includeUntracked；list | ● | ◐ | **无** |
| **OPS-MERGE** | merge + abort | 中 | **●** | 面板命令 + 服务；冲突计数结果 | ● | agent | **无** |
| **OPS-REBASE** | rebase + abort/continue | 中 | **●** | 同上 | ● | agent | **无** |
| **OPS-SEQ** | cherry-pick / revert + 继续中止 | 中 | **●** | 命令面板全套 | ● | agent | **无** |
| **OPS-UNDO** | 撤销最近提交 | 中 | **●** | `pier.git.undoLastCommit` | ● | ◐ | **无** |
| **OPS-PAUSE-UI** | 暂停操作继续/中止 | 高 | **●** | 状态下拉 `continueOperation` / `abortOperation` | ● | ◐ | **无** |
| **OPS-CONFLICT-AWARE** | 冲突可见 | 高 | **●** | status counts、review conflict 组、文案引导去编辑器 | ● | ◐ | **无** |
| **OPS-CONFLICT-EDITOR** | 块级 accept / merge editor | 低 | **○** | 无 accept current/incoming；无三方 editor | ● | ○ | **非 vibe P0**；可 agent 解或编辑器手改 |
| **OPS-FETCH-CMD** | 用户触发 Fetch | 低 | **◐** | 仅 autofetch，无独立 Fetch 命令 | ● | ◐ | **不必做** |
| **OPS-FORCE-PUSH** | force-with-lease | 低 | **○** | 无 | ● | 有 force 痕迹 | **非必须** |
| **OPS-AMEND** | amend/no-verify/sign | 低 | **○** | commit options 无 amend/noVerify | ● | ◐ | **非必须** |
| **LEG-BLAME** | blame | 低 | **○** | 无 | ● | ◐ | **不做也可** |
| **LEG-TIMELINE** | timeline/graph UI | 低 | **○** | 无（有 log/search API） | ● | ◐ | **不做也可** |
| **LEG-TAG** | tag 创建/推送 | 低 | **◐** | 仅 `git.listTags` | ● | ○ | **不做也可** |
| **LEG-REMOTE** | remote 增删 | 低 | **○** | 无 | ● | ○ | **不做也可** |
| **LEG-CLONE** | clone/init UI | 低 | **○** | 工作台假设已打开目录 | ● | ◐ | **不做也可** |
| **LEG-STAGE-ALL-UI** | Changes 顶栏 Stage All | 低 | **✕** | 提交 mainline 设计已取消 | ● | ○ | **禁止按旧设计回补** |
| **LEG-COMMIT-FORM** | Changes 侧栏 commit 输入框 | 低 | **✕** | 同上 | ● | 形态不同 | **禁止**；与 SHIP-FLOW 确认卡不是同一东西 |
| **CI-CARD** | 构建/测试结果卡 | 中 | **○** | 非 git 插件职责；任务/通知层 | ◐ | ◐ | 另项；**不是 git porcelain 缺口** |

\*SHIP-AI-MSG 的「高」仅在「宿主要做交付」时成立；当前靠 agent 在终端 commit 则中/低。

---

## 2. 分类结论（给排期用）

### 2.1 已具备 — 不要再写进缺口清单

| 域 | 能力 |
| --- | --- |
| 隔离 | 创建工作树并开工、列表删除清理、面板 root 解析、分支切换 |
| 可见 | status/watch、autofetch、±、ahead/behind、gutter、树装饰 |
| 审查 | Changes 多 scope、document 模型、文件级 stage/unstage/discard |
| 同步 | push / pull ff-only / sync、暂停 continue/abort |
| 进阶操作 | stash、merge/rebase、cherry-pick/revert、undo commit |

**特别澄清（曾误标）：**

| 误标 | 正确 |
| --- | --- |
| 「要做任务↔worktree 绑定」 | **ISO-WT-CREATE 已是 vibe 入口**；create 后终端/agent 在 `targetPath` |
| 「要做创建 worktree」 | **已做完** |
| 「审查弱」 | **审查是 Pier 强项** |

### 2.2 真实缺口（有代码证据）

| 优先级 | ID | 缺什么 | 证据 | 建议形态（vibe） |
| --- | --- | --- | --- | --- |
| **P0** | **SHIP-PUBLISH** | 无 upstream 时无法产品化发布 | `push` 无 `-u`；`noUpstream` 行 `action: null` | 状态下拉/交付流：「发布分支」→ `push -u origin HEAD`（或配置 remote） |
| **P0\*** | **SHIP-FLOW** + **SHIP-COMMIT-IPC 产品入口** | 有 IPC 无宿主交付 UX | renderer 无 commit 调用 | **确认卡**（AI 说明草稿 + 文件清单 + 提交/推送），入口：命令面板 / 任务完成 / agent 技能；**禁止** Changes footer 输入框 |
| **P1** | **SHIP-PR** | 无开 PR | 无集成 | 可选 `gh pr create`；默认可 draft |
| ~~**P1**~~ | ~~**REV-HUNK**~~ | ~~不能只 stage 一段~~ | **已交付** | 见 `2026-07-26-git-review-hunk-stage-design.md` |
| **P2** | OPS-CONFLICT-EDITOR 等 | 无块级冲突 UI | — | 非 vibe 主路径；优先 agent |
| **P2** | LEG-* | 传统 SCM 广度 | — | 默认不做 |

\*P0 是否排期取决于产品是否要「宿主交付」；若明确 **只允许 agent 终端 commit**，则 SHIP-FLOW 可降为 P1，但 **SHIP-PUBLISH 仍建议做**（push 按钮对新分支基本不可用）。

### 2.3 有意不做（保持）

| 项 | 依据 |
| --- | --- |
| Changes 侧栏 commit 表单、Stage All 工具条、面板内 AI commit 主价值链 | `2026-07-22-git-commit-mainline-design.md` **已取消** |
| 宿主内嵌完整 AI Code Review 中心 | 能力记分卡：审查展示在 Pier，AI 审交给 agent |
| 为对齐 Cursor 做 100+ git 设置 / blame / 多仓 SCM | 超出工作台定位 |

### 2.4 不是缺口的「差异」

| 差异 | 说明 |
| --- | --- |
| Codex 线程自动 worktree | Pier 用**显式创建**，且创建即开工，能力等价于隔离目标 |
| Cursor 完整 merge editor | Pier 有冲突感知 + continue/abort；解冲突靠编辑器/agent |
| Cursor Generate Commit Message 按钮 | 无 SHIP-FLOW 时单独做按钮无挂载点 |

---

## 3. 真实缺口的细说（仅这几条）

### 3.1 SHIP-PUBLISH（建议优先）

**现状：**

```text
新分支 fix/foo，从未 push
→ 状态下拉显示灰字「无上游分支」
→ 点 Push / Sync：底层 git push 易失败（无 upstream）
→ 用户只能去终端 git push -u
```

**建议：**

```text
无 upstream 且有可推送提交时：
→ 可点行「发布分支」
→ git push -u <defaultRemote> HEAD
→ 成功后出现 ↑↓ 同步项
```

### 3.2 SHIP-FLOW（宿主交付，若产品要做）

**现状：**

- agent 可在终端自己 commit（常见 vibe）  
- 宿主 **不能** 在审查后一键「确认说明并提交/推送」  
- **正确不是** 做回 Changes 底栏空输入框  

**建议形态（与取消设计不冲突）：**

```text
入口：命令「交付当前更改」/ 任务完成态 / /ship 技能
内容：
  1. AI 根据将提交 diff 生成说明（可编辑）
  2. 文件清单（默认与审查 stage 集合一致，可取消勾选）
  3. 动作：仅提交 | 提交并推送 | 提交并发布（无 upstream）| 可选开草稿 PR
调用：已有 git.stage / git.commit / git.push（+ publish）
失败：showAppAlert 或结果卡，不塞长 toast
```

### 3.3 REV-HUNK / 选区暂存（已按官方标准交付）

**现状（2026-07-27）：**

- 文件头 +/−：整文件  
- **Pierre annotations + hunk 工具条**（Codex 同款）：`renderAnnotation` + Stage/Unstage/Revert  
- **后端**：`git.applyPatch` → temp file + `git apply [--cached] [-R]`  

**未做：** discard 所选行；AI accept/reject 内容流。

### 3.4 SHIP-PR（可选）

无官方封装。vibe 可用 agent + `gh`。宿主封装的价值是：**交付确认流最后一步少跳终端**。

---

## 4. 与 Cursor / Codex 对照（压缩）

| 主链 | Pier（审计后） | Cursor | Codex |
| --- | --- | --- | --- |
| 隔离开工 | **● 创建 worktree 闭环** | ● agent worktree | ● 线程 worktree |
| 审 diff | **● Changes** | ● SCM | ● FileDiff |
| 文件整理 | **●** | ● + hunk | ● + hunk |
| 状态同步 | **● 状态栏** | ● | 弱 |
| 宿主交付 | **○ 真缺口** | ● | ● |
| 发布 -u | **○ 真缺口** | ● | ● |
| 开 PR | ○ 可选 | ● | ● |
| 传统 SCM 广度 | 中（够用） | 最强 | 弱 |

**一句话（纠正后）：**  
Pier Git **不是「弱」**，隔离/审查/同步/操作命令 **已经强**；相对 vibe 闭环，主要欠的是 **无 upstream 发布** 和（若要宿主完成交付）**确认式交付流**，而不是再做 worktree 创建或 IDE 全量 SCM。

---

## 5. 建议排期（仅真实项）

| 序 | 项 | 依赖 | 说明 |
| --- | --- | --- | --- |
| 1 | SHIP-PUBLISH | 低 | 补 `push -u` + 下拉可点；立刻改善新分支 |
| 2 | SHIP-FLOW（产品决策后） | 中 | 新设计；复用 commit IPC；不碰已取消 footer |
| 3 | SHIP-AI-MSG | 挂在 2 | 确认卡内生成说明 |
| 4 | SHIP-PR | 可选，可挂 2 | gh/API |
| 5 | ~~REV-HUNK~~ | 已交付 | 选区右键 + `git.applyHunkPatch` |

**明确移出缺口清单：** ISO-WT-\*、SEE-\*、REV-PANEL/SCOPE/DOC/FILE-OPS、OPS-\*（除冲突 editor）、LEG-\*。

---

## 6. 端到端（按 **当前已具备** 能力）

```text
1. 命令面板 / UI → 创建工作树
2. 输入任务 → AI 分支名 → 创建 → setup → 开 agent 终端（taskPrompt）
3. agent 改完 → 状态栏 ± → 打开 Changes → 文件级整理
4. 有 upstream：状态栏同步 / 推送
5. 提交：今日多在终端由 agent 完成（宿主无确认卡）
6. 无 upstream：今日需终端 push -u（宿主缺口 SHIP-PUBLISH）
```

---

## 7. 相关文档

| 文档 | 关系 |
| --- | --- |
| `2026-07-02-worktree-creation-design.md` | **隔离开工已设计且落地** — 勿再标缺口 |
| `2026-07-01-git-status-bar-design.md` 等 | 状态栏 ● |
| `2026-07-14-git-diff-review-polish-design.md` 等 | 审查 ● |
| `2026-07-22-git-diff-header-stage-checkbox-design.md` | 文件头 stage **已实现** |
| `2026-07-22-git-commit-mainline-design.md` | 经典提交表单 **✕ 取消** |
| `2026-06-25-ai-workbench-capability-scorecard.md` | AI 审查外置 |

---

## 8. 修订记录

| 版本 | 说明 |
| --- | --- |
| r1 | 偏 IDE SCM 对照（弃用其 P0） |
| r2 | 改 vibe 坐标系，但仍误标 worktree 绑定为缺口 |
| **r3** | **源码审计**：worktree/审查/同步等改回 ●；仅保留 publish / 交付流 / hunk / PR 等有证据缺口 |
