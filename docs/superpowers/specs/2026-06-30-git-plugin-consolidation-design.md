# Git 域能力整合设计（第一期：架构骨架）

更新时间：2026-06-30

## 背景与问题

当前 `worktree` 是仓库里唯一的 builtin 插件（`src/plugins/builtin/worktree/`），命名与边界过窄：

- 终端状态项 `worktree-status-item.tsx` 实际已经在用 `git.getStatus` + `git.watch`，显示分支、ahead/behind、变更文件数——它本质是一个 git 状态条，却挂在 "worktree" 名下。
- `pier.worktree.create` / `pier.worktree.delete` 两个命令目前是 disabled 占位（"not available yet"）。
- 插件 `main/index.ts` 是空壳（`activate: () => () => undefined`）；worktree 的能力主体（list / check / open）本就在 main 进程的 core service，经 `window.pier.worktrees.*` 暴露。

与此同时，git 能力在 main 与 preload 都已就绪（`git-service.ts` 约 379 行，`preload/git-api.ts` 暴露 getStatus / watch / stage 等），但 renderer 端几乎没有 git UI，代码变更预览面板尚未实现。

能力评分清单（`docs/superpowers/specs/2026-06-25-ai-workbench-capability-scorecard.md`）已给定调：

- 「Git 变更面板与外部审查入口」是 P0，但 Pier **不做通用 AI 代码审查**，只做变更 diff 面板 + 跨 worktree/agent 可见性 + 证据绑定 + 一键交给 Claude/Codex 审查的入口。
- 「工作树隔离」是 P1，其能力说明本就包含「diff/证据对比」。

结论：worktree、git status、变更预览在领域上同属 git，应收敛到统一的 git 域边界；现有 `worktree` 命名应升格为 `git`。

## 目标与非目标

目标：

- 把围绕 git 的 renderer 侧贡献收敛到清晰的 git 域三层职责。
- 第一期先立架构骨架，验证 core panel-kit 链路打通，内容后续迭代填充。

非目标（本设计明确不做）：

- 不自研 AI 代码审查引擎（按评分清单，审查交给 Claude/Codex）。
- 不做通用第三方插件平台。
- 不在本期接通「插件贡献 panel」的运行时（diff 面板走 core panel-kit，不依赖该机制）。
- 第一期不渲染 diff 内容、不做跨 worktree 聚合、不接外部审查入口（留二期）。

## 现状三层

```
core service (main)        ── GitService + worktree service，能力主体，经 preload 暴露
plugin (src/plugins)       ── 仅 worktree 一个 builtin 插件，贡献命令 + 终端状态项
panel-kit (renderer)       ── dockview 面板种类，目前仅 terminal / welcome
```

关键事实：

- 插件「贡献 panel」机制目前只有 manifest schema（`pluginPanelContributionSchema`）与 i18n，运行时尚未接到 dockview，无人使用。
- 核心命令与插件命令是两套注册路径：核心走 `ActionContribution` + `registerActionContributions`（在 `main.tsx` 集中注册），插件走 `context.actions.register`。
- 打开面板靠 `useWorkspaceStore().addPanel({ component, title })`，属 store 能力，插件 API（`RendererPluginContext`）不暴露。

## 目标架构：git 域三层

```
┌─ core service (main)  ── 不动 ─────────────────────────────┐
│  GitService(~379行) + worktree service                     │
│  status / repoInfo / watch / stage / worktree list·check·open │
└────────────────────────────────────────────────────────────┘
        ▲ window.pier.git.*           ▲ window.pier.worktrees.*
        │                             │
┌─ git-changes panel-kit (renderer, 新增, core 级) ─────────┐
│  常驻变更面板，与 terminal 同级，注册进 panel-registry.ts   │
│  一期：空占位页面                                            │
│  二期：列变更文件 → 看 diff → 证据绑定 → 外部审查入口        │
└────────────────────────────────────────────────────────────┘
        ▲ 「Git: 打开变更面板」命令（核心侧 register-actions）
        │
┌─ git 插件 (现有 worktree 插件升格) ───────────────────────┐
│  pier.worktree → pier.git，category Worktree → Git         │
│  · worktree list/create/delete 命令（保留）                 │
│  · 终端 git 状态项（保留，本就在用 git status）             │
│  只贡献命令 + 状态项；不持有 panel，不负责打开面板          │
└────────────────────────────────────────────────────────────┘
```

职责划分原则：

- 能力主体（git / worktree 服务）留 core service，不可禁用、不属于任何插件。
- 常驻面板是 core panel-kit，与 terminal 同级。
- 插件只承载命令、终端状态项这类轻量贡献。
- 打开 core 面板的命令归核心侧，与 terminal 新建命令一致——避免 P0 核心能力被绑在「可禁用插件」与「尚未接通的 plugin-panel 运行时」上。

## 第一期范围

只做三件事：worktree 插件升格、git-changes 面板占位、打开面板命令。

### 1. worktree 插件 → git 插件

目录：`src/plugins/builtin/worktree/` → `src/plugins/builtin/git/`。

manifest（`manifest.ts`）：

- `id`：`pier.worktree` → `pier.git`。
- `name`：`Worktree` → `Git`。
- 命令 `category`：`Worktree` → `Git`。
- 命令列表、权限、terminalStatusItems 保留不变。

涉及的常量与引用迁移（需全局一致）：

- `WORKTREE_PLUGIN_ID = "pier.worktree"` 定义在 `src/shared/contracts/plugin.ts`，被 manifest、`builtin-catalog`（renderer 与 main 各一份）、`host-context.ts` 等引用。重命名为 `GIT_PLUGIN_ID = "pier.git"`，同步所有引用点。
- i18n：`locales/en.json`、`locales/zh-CN.json` 的 key 命名空间与展示文案随插件名调整。
- 文件内部模块名（`worktreeRendererPlugin`、`worktreeMainPlugin`、`registerWorktreePluginContributions` 等）随域名重命名为 git 前缀；`worktree-status-item.tsx` 重命名为 `git-status-item.tsx`。
- `worktree-list-action.ts` 作为 git 插件下的 worktree 子能力保留，命令逻辑不变。

### 2. git-changes panel-kit 骨架

新目录：`src/renderer/panel-kits/git-changes/`。

- `git-changes-panel.tsx`：照 `welcome-panel.tsx` 模式，最小空占位页面（面板标题 + 「变更预览即将到来」空状态），用 `usePanelDescriptor` 设置标题；导出 `gitChangesPanelKit = { component, icon, kind: "web" }`。
- 在 `panel-registry.ts` 登记三处：`panelKits.gitChanges`、`panelComponents.gitChanges`、`panelKinds.gitChanges`。`kind` 取 `"web"`（面板内是 web DOM，键盘路由用）。

### 3. 「Git: 打开变更面板」命令（核心侧）

- 新建 `src/renderer/panel-kits/git-changes/register-actions.ts`，照 terminal 的 `register-actions.ts` 模式定义 `ActionContribution`，handler 调 `useWorkspaceStore.getState().addPanel({ component: "gitChanges", title })`；导出 `registerGitChangesActions()`。
- 在 `main.tsx` import 并在注册段调用 `registerGitChangesActions()`。

## 关键决策与取舍

- **plugin id 直接改，不做兼容垫片**：builtin 插件默认 enabled，`pluginRegistryState` 以 id 为 key 存的旧 `pier.worktree` enabled 状态会成为无害孤儿。为本地工具引入 id 迁移垫片不值当（遵循 YAGNI）。
- **命令 id 保留 `pier.worktree.*` 前缀，不改为 `pier.git.worktree.*`**：命令 id 是 frecency / MRU 持久化的 key（`lib/command-palette/frecency.ts`），改 id 会丢历史使用频率；且 "git worktree" 子能力 id 里含 worktree 本就合理。新增命令用 git 前缀（如 `pier.git.changes.open`）。插件 id 与部分命令 id 前缀不完全一致是有意取舍，换取持久化稳定。
- **panel component 名用 `gitChanges`（camelCase）**：与 dockview `addPanel({ component })` 字符串 key 一致，避免 kebab 在 key 处理上的边界问题。
- **打开面板命令归核心侧而非插件**：插件 API 不暴露 `addPanel`；归核心可复用 terminal 已验证的注册模式，本期无需扩插件 API。

## 风险与影响面

- `WORKTREE_PLUGIN_ID` 引用点分散（contracts / builtin-catalog ×2 / host-context 等），漏改会导致插件注册或 i18n 解析不一致——需按引用全集逐点迁移。
- i18n key 命名空间迁移若与 `display.ts` 的取值路径不匹配，会让命令标题回退到 fallback——迁移后需在命令面板核对中英文标题。
- 改了 i18n / 插件 catalog 等共享数据，`pnpm check` 不跑 vitest；需另跑 `pnpm test` 兜底（参照项目既有经验）。
- 架构边界：git-changes panel-kit 不得 import 其它 panel-kit（如 terminal），跨域复用走 `components/common` 或 `stores`；panel-kit 允许 import dockview 类型（与 terminal / welcome 一致）。

## 验证方式

- `pnpm typecheck`、`pnpm lint`、`pnpm check`（含 depcruise 与 file-size）。
- 因改动触及 i18n / 插件 catalog，额外跑 `pnpm test` 兜底。
- `pnpm dev` 手动验证：
  - 命令面板能搜到并执行「Git: 打开变更面板」，弹出 git-changes 空占位面板。
  - 原 worktree 三命令仍在，归类到 Git category；`list` 行为不变。
  - 终端 git 状态项正常显示分支与变更数，点击仍可打开 worktree 列表。

## 后续（二期，不在本期）

- git-changes 面板内容：列 staged/unstaged 变更文件、点选渲染 diff。
- 跨 worktree 变更聚合与对比、证据/会话绑定。
- 「Git: 交给 Claude/Codex 审查」外部审查入口命令。
