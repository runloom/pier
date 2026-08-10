# Worktree 创建交互设计（vibecoding-first）

更新时间：2026-07-02

## 背景与问题

后端能力已经就绪：`WorktreeService`（[worktree-service.ts](../../../src/main/services/worktree-service.ts)）实现了 check / list / create / remove / prune，worktree 统一放在主仓 `.worktrees/<name>/` 下，IPC（[worktree-api.ts](../../../src/preload/worktree-api.ts)）、权限（`worktree:read` / `worktree:write`）、命令路由（`worktree.open` → `panel.open`）全部打通，`scripts/setup-worktree.mjs` 也已能用 pnpm store 建立 worktree 本地 `node_modules` 并按需编译 native addon。

但创建交互是最原始的形态：命令面板 action（[worktree-operation-actions.ts](../../../src/plugins/builtin/git/renderer/worktree-operation-actions.ts)）连续弹两个 `window.prompt()` 要求手填 name 和 branch。问题：

- **两个必填空**：用户被迫先想好分支名和目录名，与 vibecoding「想到就开」的节奏相悖。
- **无 base 选择**：只能从当前 HEAD 建，无 fetch，起点可能是脏的旧代码。
- **创建 ≠ 可用**：创建完没有任何后续——不复制 `.env` 类文件、不跑 setup、不开终端，用户要自己 cd 进去跑 `pnpm setup:worktree`，否则 `pnpm dev` 直接炸（AGENTS.md 已记录该坑）。
- **报错无出路**：branch already checked out 只能得到一条错误 toast。

### 业界对标结论（2026-07 调研）

对 Conductor / Crystal(Nimbalyst) / vibe-kanban / claude-squad / Sculptor / Cursor / Claude Code / Codex App / JetBrains / Tower / Fork / GitKraken / VS Code / lazygit / Worktrunk 等做了创建流调研，共识收敛为六条：

1. **唯一必答题是「你要做什么」**，不是「分支叫什么」。表单式（JetBrains/Tower）摩擦大；意图式（Conductor/Crystal/vibe-kanban，任务描述 → 自动派生分支）最适合 agent 并行场景。
2. **环境准备是生死线**：`.env`/`node_modules` 不跟随是全渠道抱怨频率第一的痛点（Conductor Show HN、[vscode#276834](https://github.com/microsoft/vscode/issues/276834)、[lazygit#2803](https://github.com/jesseduffield/lazygit/discussions/2803)）。成熟解法 = 声明式 copy patterns（Conductor `.worktreeinclude`、Claude Code 同名文件、jackiotyu 扩展默认 `[".env", ".vscode/**", "*.local"]`）+ post-create 脚本。
3. **命名自动但要有意义**：纯随机名（Claude Code 的形容词-科学家）产生 [#46098](https://github.com/anthropics/claude-code/issues/46098) 这类高票抱怨；纯手填是摩擦。最佳 = 从任务描述 slug 化 + 可编辑（vibe-kanban `vk/<id>-<slug>`）。lazygit 投票：~60% 用户一分支一 worktree，目录名 = 分支名，创建本不需要输入。
4. **路径永远不问**：模板化推导消灭所有放置类抱怨。位置要稳定（Cursor `~/.cursor/worktrees` 自动 GC 误删用户工作区、vibe-kanban 放 OS temp 被系统清掉都是反例）。
5. **创建不是目的，开工才是**：Crystal/Conductor/vibe-kanban/Cursor 创建后都立即拉起 agent/终端。
6. **报错给出路**：「branch already checked out」应提供跳转动作而非报错——Pier 的 panel-per-context 架构天然适合（开面板即可，不用换窗口）。

## 目标与非目标

目标：

- **单输入创建面板**：一个输入框同时接受任务描述或分支名，下方实时展示推导结果（分支 / 位置 / base / 准备步骤），行内可改；留空回车 = 自动代号。
- **三入口复用同一动作**：workspace「+」下拉（[add-panel-action.tsx](../../../src/renderer/components/workspace/add-panel-action.tsx)）、命令面板 action（替换现有 prompt 流）、worktree 列表 quick-pick 首行。
- **创建后即时开工**：自动开终端面板（cwd = 新 worktree），setup 在终端里流式可见地跑完；可选自动启动 agent 并把任务描述作为首条 prompt。
- **copy-files**：按 pattern 复制 gitignored 文件（`.env*` 等）进新 worktree。
- **冲突恢复**：分支已被检出 → 提供「跳转到该 worktree」/「从它新建副本分支」。
- **worktree 身份可见**：终端 tab 带 worktree 徽标。

非目标（本 spec 明确不做）：

- **merge-back / PR 流**：创建的逆操作另立 spec；现有 remove/prune 保持不变。
- **自动 GC / 保留策略**：Cursor 式自动清理有误删风险，显式删除已够用。
- **AI 命名（LLM slug）**：先上规则 slugify，效果不满意再加（Crystal 用 Haiku 起名的路线），不阻塞主流程。
- **容器级隔离**（Sculptor 路线）、**monorepo sparse checkout**、**端口分配**（Conductor 每 workspace 10 端口）：均为后续独立决策。

## 交互设计

设计稿四帧（本次会话已确认）：

### 帧 1 · 入口

- 「+」下拉在 New Terminal / New Task 之后加 `New worktree`（快捷键 `⌘⇧N` 候选，需查 keybinding 冲突）。
- worktree 列表 quick-pick（[worktree-list-action.ts](../../../src/plugins/builtin/git/renderer/worktree-list-action.ts)）首行加 `Create worktree…`。
- 命令面板现有 create action 改为打开创建面板。
- 非 git 仓库 / `worktreeSupported === false` 时入口禁用并给 `disabledReason`。

### 帧 2 · 创建面板（核心）

布局：标题（`New worktree · <repo>`）→ 大输入框 → 派生预览四行（分支 / 位置 / 基于 / 准备）→ 分隔线 → 「创建后启动」chips → 快捷键 footer。

**输入语义判定**（纯函数，可单测）：

- 输入匹配已存在分支名 → 「已有分支」模式（走帧 4 校验）。
- 形似分支名（无空格、全 `[A-Za-z0-9._\-/]`）→ 直接用作分支名。
- 其余视为任务描述 → slugify：小写、空格→`-`、去常见停用词、截断 ~24 字符；CJK 描述提取其中 ascii token；完全无 ascii → 词典代号（形容词-名词）fallback。
- slug 与现有 worktree/分支重名 → 追加 `-2` 后缀。

**派生规则**：

- 分支 = 前缀 + slug，前缀默认 `wt/`（设置项）。用户手改分支名后不再联动。
- 位置 = `.worktrees/<slug>`（服务既有约定），只读展示；目录名对分支名做 `/`→`-` sanitize，兼容服务端 name regex `[A-Za-z0-9._-]+`。
- 基于 = `origin/HEAD`，面板打开时后台 fetch（短超时）；fetch 失败降级本地 HEAD 并在行内标注「未 fetch」。可下拉换分支（复用 git branch quick-pick 行渲染）。
- 准备 = 按设置渲染 pills（复制哪些文件、setup 命令），悬停显示明细；这行是「说明将发生什么」，不是输入。

**键位**：`⏎` 创建并启动选中 chip；`⇧⏎` 仅创建（不开面板）；`esc` 取消；输入留空 `⏎` = 自动代号 + 默认 chip。

**chips**：仅终端 / 已检测到的 agents（复用「+」下拉的 `ensureDetected()` 数据）。选中 agent 时标注「带上任务描述」。记住上次选择（设置项）。

### 帧 3 · 创建后

1. `worktrees.create()`（既有 IPC）。
2. main 进程复制 gitignored 文件（见下）。
3. 立即 `addTerminal()` 开终端面板（context 解析走既有 `resolvePanelContextForPath`），tab 标题 = slug + worktree 徽标。
4. 终端内可见地执行 setup 命令（项目设置 `worktree.setupCommand`，Pier 仓库即 `pnpm setup:worktree`）；setup 与 agent 启动串联在同一 shell 会话（`setup && <agent launch>`），保持全程透明。
5. 成功 toast：`Worktree 就绪 · wt/<slug>`，附 Reveal in Finder 动作。
6. setup 退出码非 0：终端保留现场，toast 报错，worktree 保留不回滚。

### 帧 4 · 冲突恢复

输入被识别为已有分支且该分支已被某 worktree 检出时：

- 警告条：`该分支已在 worktree <name> 中检出`。
- 动作一（主）：跳转到该 worktree（`worktree.open`，若已有对应面板则聚焦）。
- 动作二：从它新建副本分支（`<branch>-2`，base 指向该分支）。

其他边界：

- 目标目录已存在残留 → 服务端既有 path safety 报错，面板转为「换名或覆盖」提示。
- 主仓 dirty 不阻塞创建（worktree 与主仓工作区状态无关）。
- `.worktrees/` 未被 gitignore → 预览「位置」行标注提示，一键追加到 `.gitignore`（P3）。

## 组件与架构

依赖方向遵守 depcruise 既有边界（renderer 业务不 import dockview、plugin 走 `components/common` / `stores`）：

- **`WorktreeCreatePanel`**：renderer 核心 overlay，仿 [app-dialog-host.tsx](../../../src/renderer/components/common/app-dialog-host.tsx) 模式——`components/common/worktree-create-host.tsx` + Zustand store（`stores/worktree-create.store.ts`）持面板状态；git plugin 的三个入口通过 store API 打开。打开期间沿用 dialog host 的 keybinding / 终端焦点屏蔽。
- **命名与判定**：纯函数模块（如 `src/shared/worktree-naming.ts`，renderer 与测试共用），覆盖语义判定 / slugify / 冲突后缀。
- **copy-files**：main 进程新增能力（`WorktreeService` 扩展或独立 setup step）：按 patterns 匹配主仓文件，用 `git check-ignore` 确认属 gitignored 才复制（Conductor `.worktreeinclude` 语义），默认 patterns `[".env*", "*.local", ".claude/settings.local.json"]`，硬排除 `node_modules/**`、`dist/**`、`.git/**`。
- **设置项**（userData JSON 偏好层）：`worktree.branchPrefix`（默认 `wt/`）、`worktree.copyPatterns`、`worktree.setupCommand`、`worktree.lastLaunch`。
- **tab 徽标**：判定「处于 worktree」= `git rev-parse --git-dir` ≠ `--git-common-dir`（`PanelContext` 已含 `gitCommonDir`），在 `PanelTabChrome` 渲染徽标。
- **契约变更**：`WorktreeCreateRequest`（[worktree.ts](../../../src/shared/contracts/worktree.ts)）已含 `base?`，本 spec 不需要 schema 破坏性变更；copy-files 若做成独立命令则新增一个 contract。

## 分期

- **P1（核心闭环）**：创建面板 + 规则 slugify + base fetch/降级 + create + copy-files + 终端内流式 setup + toast；「+」下拉与命令面板两个入口。
- **P2（开工与出路）**：agent chips + 任务描述作为首 prompt + 记住上次选择；冲突恢复两动作；quick-pick 首行入口；tab 徽标。
- **P3（打磨）**：`.gitignore` 检测 + 一键追加；AI 命名（LLM slug）；`⌘⇧N` keybinding 落位。

## 测试

- **unit**（Vitest）：语义判定（描述 vs 分支名 vs 已有分支）、slugify（含 CJK fallback、截断、后缀去重）、copy patterns 匹配与排除。
- **service**：fixture 仓库上验证 create + copy-files（只复制 ignored 文件、不复制 node_modules）、branch-checked-out 错误分类。
- **e2e**（Playwright）：happy path（输入描述 → 创建 → 终端面板打开且 cwd 正确）、冲突路径（跳转动作聚焦既有面板）。
