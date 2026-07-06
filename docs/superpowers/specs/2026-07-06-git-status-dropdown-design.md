# Git 状态下拉面板设计

日期：2026-07-06

## 背景

当前终端状态栏的 Git 状态项已经能显示工作树、分支、仓库操作态、领先/落后、脏文件计数、行数增减、stash、远端同步状态、远端分支已删（`upstreamGone`）和已合入默认分支（`mergedIntoDefault`）。问题不在状态数据缺失，而在点击行为过窄：点击状态项直接打开工作树列表，用户无法从同一入口进入 Git 变更审查、stash、冲突处理等高频后续动作。

本设计新增一个轻量下拉面板（dropdown）：点击 Git 状态项后打开“状态摘要 + 少量安全动作”的分诊入口。完整文件列表、差异（diff）审查、暂存、提交和冲突解决仍由 `Git Changes` 面板或编辑器承载。

## 业界调研结论

调研来源：

- VS Code Source Control：状态栏显示分支和同步状态；文件变更、暂存、diff 和冲突处理在 Source Control view / editor 中完成。
  - https://code.visualstudio.com/docs/sourcecontrol/overview
  - https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees
  - https://code.visualstudio.com/docs/sourcecontrol/staging-commits
- JetBrains VCS widget：状态栏部件显示当前分支、incoming/outgoing；点击后主要是分支弹窗、fetch、checkout、compare 等分支相关动作。Pull/Update 进入明确的操作流程。
  - https://www.jetbrains.com/help/idea/manage-branches.html
  - https://www.jetbrains.com/help/idea/sync-with-a-remote-repository.html
- GitHub Desktop：Changes 左栏负责选择文件、审查、提交和 stash，不把这些能力塞进小浮层。
  - https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop
- Sublime Merge：pending changes 和每个文件 diff 在主界面 details 区完成。
  - https://www.sublimemerge.com/docs/getting_started
- Zed：点击状态栏 Git icon 打开 Git Panel；Git Panel 展示仓库、分支、变更文件和暂存状态，Project Diff 负责完整变更审查。
  - https://zed.dev/docs/git

稳定模式：

1. 状态栏负责常驻信号和快速入口。
2. 小弹窗负责选择、分流和少量安全动作。
3. 文件级审查、暂存、提交、冲突解决进入完整面板或编辑器。
4. 会改写工作区的同步动作需要明确能力、授权、失败处理和反馈，不能只靠前端按钮补出来。

## 目标和完成标准

目标：

- 点击 `pier.worktree.status` 打开轻量 Git 状态下拉面板。
- 下拉面板显示当前工作树和分支上下文、状态摘要、少量高频动作。
- 普通脏状态、冲突/变基状态、干净且已合并状态有清晰不同的信息优先级。
- 保留右键状态栏管理菜单；右键仍打开原生菜单。
- 不新增状态旁路。状态仍以 `git.getStatus` 和 `git.watch` 快照为唯一来源。
- 任何会丢弃进度或改变工作树结构的动作必须先确认，并给出失败反馈。

完成标准：

- 默认宽度控制在 `320-360px`，高度随内容但普通态不超过约 `260px`。
- 默认态只有一个主操作：打开 `Git Changes`。
- 次操作最多两个：切换工作树、stash。
- 文件列表、diff 预览、暂存、提交表单不进入下拉面板。
- 冲突/变基时优先显示阻塞态和对应动作，隐藏或弱化 stash / 同步。
- 通过组件测试覆盖三种核心状态，通过现有检查保证架构边界。

## 当前结构为什么不足

当前结构优点：

- `git-status-item.tsx` 已经有 `useGitStatus`，通过 `getStatus` 初始拉取和 `watch` 广播更新状态，并用递增序号避免旧响应覆盖新状态。
- `StatusBody` 已经把状态栏内容拆成 `BranchLabel`、`RepoStatePill`、`SyncCounts`、`WorkingTreeCounts`、`LineDelta`、`StashBadge` 等可复用展示块。
- `GitStatus.branch` 已包含 `upstreamGone` 与 `mergedIntoDefault`，属于 `getStatus` 快照内事实，不需要 renderer 新增状态来源。
- `RendererPluginContext.git` 已暴露 `stash`、`abortMerge`、`abortRebase`、`continueRebase`、`popStash`、`applyStash`、`dropStash` 等能力；这些动作已有 main 侧 Git 服务和命令路由承载，不需要 renderer 直接执行 git。
- `RendererPluginContext.git` 未暴露 cherry-pick / revert / bisect 的 continue、abort 或 skip 能力；首版下拉面板不能臆造这些按钮。
- `git-changes-panel.tsx` 已经负责完整变更文件树和 diff 预览。
- `@pier/ui/popover` 已通过 `useTerminalOverlay()` 接入终端 overlay 层，可避免普通 web 浮层被终端原生视图遮挡。

不足：

- 状态项点击行为只有“切换工作树”，没有根据 Git 状态分流。
- 状态栏一行信息密度高，但不能解释“下一步应该做什么”。
- Git Changes 面板入口在命令面板里，状态栏用户不能从当前上下文直接进入审查。
- 普通未提交变更、冲突、干净且已合并 / 远端已删三类场景需要不同下一步，但当前点击行为相同。

## 所有权划分

- 数据：`main/services/git-service` 和 `git-watch-service` 继续生成 `GitStatus`；renderer 不自行派生新事实。
- 策略：Git 插件 renderer 内新增轻量视图模型（view model），把 `GitStatus + PanelContext` 派生成下拉面板的状态、动作和文案。
- 执行：复用 `RendererPluginContext` 的 `git`、`panels`、`worktrees`、`notifications`、`dialogs` 能力。
- UI：新增 Git 插件内部组件，例如 `git-status-dropdown.tsx`；由 `git-status-item.tsx` 组合。
- 状态：Popover open/close 为组件本地状态，不写入 userData。
- 测试：组件测试覆盖 view model 和渲染；端到端测试只覆盖关键点击链路。

### 已验证可复用能力

首版下拉面板只接入仓库里已经存在的 renderer 插件能力：

| 能力 | Renderer API | 说明 |
| --- | --- | --- |
| 打开审查面板 | `context.panels.open("pier.git.changes")` | 已由 Git 插件声明面板贡献点 |
| 切换工作树 | `openWorktreeListQuickPick(context, path)` | 复用现有工作树列表 quick pick |
| stash 当前已跟踪变更 | `context.git.stash(cwd, { includeUntracked: false })` | 复用现有 stash 反馈模式；成功后必须提示如何恢复 stash |
| 继续变基 | `context.git.continueRebase(cwd)` | `ok` / `conflict` / `unavailable` / `error` 都必须有反馈 |
| 中止变基 | `context.git.abortRebase(cwd)` | 下拉内必须先二次确认；确认后所有结果分支都必须有反馈 |
| 中止合并 | `context.git.abortMerge(cwd)` | 下拉内必须先二次确认；确认后所有结果分支都必须有反馈 |

不在此表中的 Git 写能力不能出现在首版下拉面板。尤其是 cherry-pick / revert / bisect 的 continue、abort、skip，目前没有 renderer 能力，首版只能展示阻塞态和审查入口，收尾动作留给终端或后续专门命令设计。

## 数据流

```text
terminal panel context
  + gitRoot / worktreeRoot
        |
        v
useGitStatus(pluginContext, gitRoot)
  初始 getStatus + watch 快照
        |
        v
deriveGitStatusDropdownModel(status, panelContext)
        |
        v
GitStatusDropdown
  - 展示状态摘要
  - 调用 panels.open("pier.git.changes")
  - 调用 worktree quick pick
  - 调用安全 Git 动作
```

不新增 main → renderer 状态通道。同步、stash、rebase continue/abort 等写操作完成后，仍通过仓库变化 → watch 签名 → status 快照更新 UI。

## 信息分层

### 留在状态栏

- 工作树 / 分支短摘要。
- repoState 胶囊：MERGING、REBASING、CHERRY-PICK、REVERTING、BISECT。
- ahead/behind。
- 未提交变更聚合数字。
- 行增删。
- stash 数。
- 远端同步年龄的 tooltip。

### 放入下拉面板

- 完整一点的上下文：分支名、工作树名、远端同步年龄。
- 一行状态摘要：
  - 未提交变更：`6 changed · +128 -42 · ↑2 ↓1`
  - conflict：`Rebase paused · 3 conflicts`
  - clean：`Clean · merged · upstream gone`
- 主操作：
  - 未提交变更：`Open Git Changes`
  - conflict：`Open Git Changes`
  - clean/merged：`Switch Worktree`
- 次操作：
  - `Switch Worktree`（无进行中操作时）
- `Stash`（仅有已跟踪未提交变更且无冲突）
- `Continue Rebase` / `Abort Rebase`
- `Abort Merge`
- cherry-pick / revert / bisect 进行中：只显示阻塞摘要和 `Open Git Changes`，不显示不存在的 continue / abort / skip 动作。

### 不放入下拉面板

- 变更文件列表。
- diff 预览。
- 单文件 stage / unstage / discard。
- commit message 输入。
- push/pull/fetch 详细选项。
- 分支全量列表。
- stash 列表详情。
- worktree prune 或删除工作树流程。

这些内容分别进入 `Git Changes` 面板、命令面板、工作树 quick pick 或后续专门流程。

### 工作树清理语义

`upstreamGone` / `mergedIntoDefault` 表示“当前分支可能已完成，可以考虑切换或后续清理”。它不等价于 `git worktree prune`。

- `git worktree prune` 清理的是目录已不存在但 Git 元数据仍残留的陈旧工作树记录，只能在检测到 `WorktreeItem.prunable` 时通过现有 `Prune Stale Worktrees` 命令处理。
- 当前工作树的删除也不能直接放在此下拉面板中，因为当前终端面板通常正锚定这个工作树。删除当前工作树需要先切换到其它工作树，并走现有删除工作树流程。
- 因此 clean + merged/upstream gone 场景只提示状态，并提供 `Switch Worktree` 与 `Open Git Changes`，不提供 `Prune Worktrees`。

## 同步动作边界

当前 renderer Git API 没有手动 `fetch` / `pull` / `push` 能力。已有设计中自动同步由 main 侧 `git-autofetch-service` 通过仓库 refs 变化进入 watch 管道。

因此首版下拉面板：

- 可以展示 `fetched 1m ago`、`↑2 ↓1`。
- 不放可点击 `Sync Changes`，避免 UI 暗示已有能力。
- 如果后续要做 `Fetch`，必须先新增 main 侧 command、权限、超时、鉴权失败处理、通知反馈，再把按钮接入。
- `Pull` / `Push` / `Sync` 属于写操作，需单独设计，不作为本次下拉面板的隐含能力。

## UI 线框

### 普通未提交变更

```text
┌──────────────────────────────────┐
│ feature/terminal-status          │
│ pier.worktree · fetched 1m ago   │
├──────────────────────────────────┤
│ 6 changed · +128 -42 · ↑2 ↓1     │
│ Staged 2 · Modified 4 · ? 1      │
├──────────────────────────────────┤
│ [ Open Git Changes            ]  │
│ Switch Worktree            Stash │
└──────────────────────────────────┘
```

### 冲突 / 变基

```text
┌──────────────────────────────────┐
│ feature/agent-tools              │
│ rebasing on main                 │
├──────────────────────────────────┤
│ Rebase paused · 3 conflicts      │
├──────────────────────────────────┤
│ [ Open Git Changes            ]  │
│ Continue Rebase            Abort │
└──────────────────────────────────┘
```

### Cherry-pick / revert / bisect 进行中

```text
┌──────────────────────────────────┐
│ feature/agent-tools              │
│ cherry-pick paused               │
├──────────────────────────────────┤
│ Cherry-pick paused · 2 conflicts │
├──────────────────────────────────┤
│ [ Open Git Changes            ]  │
└──────────────────────────────────┘
```

### 干净且已合并

```text
┌──────────────────────────────────┐
│ feature/auth-flow                │
│ pier.worktree · fetched 1m ago   │
├──────────────────────────────────┤
│ Clean · merged · upstream gone   │
├──────────────────────────────────┤
│ [ Switch Worktree             ]  │
│ Open Git Changes                │
└──────────────────────────────────┘
```

### 视觉约束

- 使用 `Popover`，`side="top"`，`align="end"`。
- `PopoverContent` 必须显式传 `side="top"`、`align="end"`，并通过 `className` 覆盖默认 `w-72`：宽度约 `w-80` 到 `w-88`，不要超过 360px。
- 默认 `rounded-3xl` / `p-4` 如果导致普通态超过约 260px 或观感过重，应在此组件实例上收敛为更紧凑的间距与圆角；不要修改全局 `PopoverContent` 原语。
- 使用 `Badge` 表示小状态，不自定义大色块。
- 使用 `Separator` 分隔上下文、摘要、动作。
- 使用 `Button` 的既有 `default`、`outline`、`ghost`、`destructive` 变体。
- 中止类动作使用 `destructive` 变体，但不得一键执行，必须先打开确认对话。
- 图标只用 lucide，按钮内图标加 `data-icon`。
- 不使用 `Card`，避免卡片套卡片。
- 不新增原始色值，使用语义 token 和既有 status token。
- 不使用 `space-y-*`，统一 `flex flex-col gap-*`。
- 不在 overlay 上手写 `z-index`。

## 状态决策规则

先统一计算：

- `hasConflict = counts.conflict > 0`，并兼容 `repoState` 内部的 `conflictCount > 0`。

优先级从高到低：

1. `repoState.kind !== "clean"`：进行中操作态；当 `hasConflict` 为 true 时使用冲突/阻塞文案。
2. `repoState.kind === "clean"` 且 `hasConflict`：冲突兜底态。该状态理论上少见，用于 watch 或检测器短暂不一致时避免把冲突误报为普通未提交变更。
3. `counts` 或 `delta` 非空：未提交变更态。
4. `branch.mergedIntoDefault === true` 或 `branch.upstreamGone === true`：可清理提示态。
5. 其他：clean 态。

动作规则：

- `Open Git Changes`：除非没有 gitRoot，否则始终可用。
- `Switch Worktree`：有 worktreeRoot/gitRoot 且无进行中操作时可用；`repoState.kind !== "clean"` 时隐藏，避免在合并、变基、cherry-pick、revert、bisect 暂停中把用户带离当前阻塞上下文。
- `Stash`：有已跟踪未提交变更、无冲突且无进行中操作时显示；仅有未跟踪文件时不显示普通 `Stash`，避免裸 stash 不包含未跟踪文件造成误解。
- `Continue Rebase`：仅 `repoState.kind === "rebasing"`；`ok` 显示成功通知，`conflict` 复用 `confirmOpenReview` 引导进入 `Git Changes`，`unavailable` / `error` 显示失败反馈。
- `Abort Rebase`：仅 `repoState.kind === "rebasing"`；点击后先用 `dialogs.confirm` 二次确认，确认后才调用 `context.git.abortRebase`；`ok` 显示成功通知，`unavailable` / `error` 显示失败反馈。
- `Abort Merge`：仅 `repoState.kind === "merging"`；点击后先用 `dialogs.confirm` 二次确认，确认后才调用 `context.git.abortMerge`；`ok` 显示成功通知，`unavailable` / `error` 显示失败反馈。
- `repoState.kind === "cherry-picking"` / `"reverting"` / `"bisecting"`：首版只显示阻塞摘要和 `Open Git Changes`。当前 renderer 没有这些状态的 continue / abort / skip 能力，不在下拉面板里提供假动作。

stash 动作补充规则：

- `Stash` 复用现有 stash 操作反馈模式，不单独写只处理成功的轻量路径。
- `Stash` 成功后通知文案必须明确“可通过 `Git: Pop Stash...` 或 `Git: Apply Stash...` 恢复”。
- 如果 Git 返回 `nothing_to_stash`，显示“没有可 stash 的本地变更”类提示，不得误报为成功。
- 下拉摘要继续显示 stash 数，但 stash 列表选择仍在命令面板中完成，不在下拉面板内展开。

## 明确禁止的反模式

- 把 `GitChangesPanel` 嵌进下拉面板。
- 在下拉面板内显示文件列表或 diff。
- 新增 renderer 自己的 Git 轮询。
- 绕过 `git.watch` 新增状态广播。
- 在 renderer 里直接执行 git 命令。
- 把同步写操作做成前端假按钮。
- 用自定义大色块、大统计卡片或仪表盘式布局。
- 改动状态栏右键原生菜单路径。

## 最小实施方案

1. 新增 `deriveGitStatusDropdownModel(status, panelContext)` 纯函数。
2. 新增 `GitStatusDropdown` 组件，内部只组合 `Popover`、`Badge`、`Separator`、`Button`。
   - `PopoverContent` 必须在实例上覆盖宽度、对齐和紧凑间距，避免沿用默认 `w-72` 导致设计稿与实现不一致。
3. 修改 `WorktreeStatusItem`：
   - 左键打开 `Popover`。
   - 保留右键状态栏管理菜单不变。
   - `Switch Worktree` 挪到下拉面板动作。
4. 打开变更：
   - `context.panels.open("pier.git.changes", { context })`。
5. Git 动作：
   - stash / continue rebase / abort rebase / abort merge 复用现有 `context.git` 能力和通知模式。
   - abort rebase / abort merge 必须先通过 `dialogs.confirm` 确认；用户取消时不调用 Git API。
   - abort rebase / abort merge 在确认后的 `ok` / `unavailable` / `error` 分支都必须给出反馈。
   - continue rebase 在 `ok` / `conflict` / `unavailable` / `error` 分支都必须给出反馈；`conflict` 分支应引导打开 `Git Changes`。
   - stash 成功通知必须包含恢复入口提示；仅未跟踪文件时不显示普通 `Stash`，或在 `nothing_to_stash` 返回时显示信息提示。
   - 如果复用现有 action helper 需要导出共享函数，应保持在 Git 插件 renderer 内，不跨插件边界。

## 验证方式

- 组件测试：
  - 未提交变更态显示摘要和 `Open Git Changes` / `Switch Worktree` / `Stash`。
  - rebase conflict 态显示 `Open Git Changes` / `Continue Rebase` / `Abort`，不显示 stash。
  - cherry-pick / revert / bisect 进行中态显示阻塞摘要和 `Open Git Changes`，不显示 `Switch Worktree`，也不显示 continue / abort / skip 假动作。
  - clean merged upstream gone 态显示 `Switch Worktree` / `Open Git Changes`，不显示 `Prune Worktree`。
  - 点击 `Open Git Changes` 调用 `context.panels.open("pier.git.changes")`。
  - 点击 `Abort Rebase` / `Abort Merge` 先调用 `dialogs.confirm`；取消时不调用 Git API。
  - `Abort Rebase` / `Abort Merge` 确认后覆盖 `ok` / `unavailable` / `error` 反馈。
  - `Continue Rebase` 覆盖 `ok` / `conflict` / `unavailable` / `error` 反馈；冲突分支引导进入 `Git Changes`。
  - stash 成功通知包含 `Git: Pop Stash...` 或 `Git: Apply Stash...` 恢复提示。
  - 仅未跟踪文件时不显示普通 `Stash`，或 `nothing_to_stash` 时显示信息提示，不误报成功。
  - watch 快照更新时下拉内容同步变化。
- 端到端：
  - 打开终端面板后点击 Git 状态项，出现下拉面板。
  - 修改仓库文件后，已打开下拉面板的摘要更新。
  - 右键状态栏仍打开状态栏管理菜单。
- 静态检查：
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm check` 覆盖 depcruise 边界。

## 需求到证据的验收矩阵

| 需求 | 设计证据 | 验收证据 |
| --- | --- | --- |
| 入口轻量，不做完整 Git 客户端 | 信息分层和“不放入下拉面板”清单 | 组件中无文件列表/diff/stage/commit UI |
| 支持工作树切换 | 次操作包含 `Switch Worktree` | 点击调用既有 worktree quick pick |
| 支持打开 diff 审查面板 | 主操作 `Open Git Changes` | 调用 `context.panels.open("pier.git.changes")` |
| 支持普通未提交变更场景 | 未提交变更线框 | 组件测试覆盖未提交变更视图模型 |
| 支持冲突/变基场景 | 冲突线框和动作规则 | 组件测试覆盖 rebase conflict |
| 支持 cherry-pick / revert / bisect 进行中场景 | 进行中状态规则 | 组件测试覆盖只显示阻塞摘要和审查入口 |
| 支持 clean/merged/upstream gone 场景 | clean 线框 | 组件测试覆盖 clean merged 且不显示 prune |
| 同步动作不臆造 | 同步动作边界 | 首版无可点击 `Sync Changes` |
| 状态来源闭环 | 数据流说明 | 不新增 IPC/broadcast，复用 `useGitStatus` |
| shadcn 规范 | 视觉约束 | lint + 代码审查确认使用现有组件 |
| 破坏性动作安全 | 动作规则要求确认和结果反馈 | 组件测试覆盖取消不调用 Git API，并覆盖 ok / unavailable / error |
| 继续变基可恢复 | continue rebase 结果规则 | 组件测试覆盖 ok / conflict / unavailable / error，conflict 引导审查 |
| stash 不变成单向入口 | stash 补充规则 | 成功通知包含恢复命令提示；未跟踪文件或 nothing-to-stash 不误报成功 |

## 后续独立议题

- 手动 `Fetch` 按钮：需要 main 侧 Git command、权限、超时、鉴权失败处理和通知反馈。
- `Pull` / `Push` / `Sync Changes`：需要独立架构设计，不能并入本下拉面板首版。
- Git Changes 面板增强：文件分组、暂存、diff 审查属于完整面板能力，不属于状态栏下拉面板。
