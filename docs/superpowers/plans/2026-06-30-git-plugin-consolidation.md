# Git 域能力整合实现计划（第一期：架构骨架）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把过窄的 `worktree` builtin 插件升格为 `git` 插件，并新增一个 core 级 `git-changes` panel-kit（第一期空占位）与「打开变更面板」命令，确立 git 域三层骨架。

**Architecture:** 能力主体（GitService / worktree service）留在 main core service；常驻变更面板是 renderer 的 core panel-kit（与 terminal 同级，注册进 `panel-registry.ts`）；插件只承载命令与终端状态项。「打开面板」命令走核心侧 `register-actions.ts`（因插件 API 不暴露 `addPanel`），单例打开。

**Tech Stack:** Electron 42 · React 19 · TypeScript 6 strict · dockview-react 6 · Zustand 5 · Vitest 4 + @testing-library/react · i18next。

**配套设计文档：** `docs/superpowers/specs/2026-06-30-git-plugin-consolidation-design.md`

**提交约定：** 本仓库 git 默认只读（见 `AGENTS.md` 05）。计划中的 `git commit` 步骤在执行阶段需先 stage 明确路径、展示 `git diff --staged` 并等用户确认；不使用 `git add .`。

---

## 文件结构

第一期触达的文件与各自职责：

**新建**

- `src/renderer/panel-kits/git-changes/git-changes-panel.tsx` — git 变更面板组件（第一期空占位）+ `gitChangesPanelKit` 元数据。
- `src/renderer/panel-kits/git-changes/register-actions.ts` — 核心侧「打开变更面板」命令贡献与注册函数。
- `tests/component/git-changes-panel.test.tsx` — 面板占位渲染测试。
- `tests/unit/renderer/git-changes-actions.test.ts` — 命令贡献元数据测试。

**修改（Task 1–2）**

- `src/renderer/components/workspace/panel-registry.ts` — 登记 `gitChanges` 到 `panelKits` / `panelComponents` / `panelKinds`。
- `src/renderer/stores/workspace.store.ts` — `WorkspaceState` 加 `openGitChanges` 方法与实现（单例打开）。
- `src/renderer/main.tsx` — import 并调用 `registerGitChangesActions()`。
- `src/renderer/lib/actions/types.ts` — `ActionCategoryKey` 增加 `"git"`。
- `src/renderer/lib/actions/contribution-runtime.ts` — exhaustive `CATEGORY_BY_KEY` 补 `git`。
- `src/renderer/lib/command-palette/frecency.ts` — `CATEGORY_META` 加 `Git` 分类排序。
- `src/renderer/i18n/locales/en.ts` — `commandPalette.category.git` + `commandPalette.action.openGitChanges`。
- `src/renderer/i18n/locales/zh-cn.ts` — 同上中文。

**改名（Task 3）**

- `src/shared/contracts/plugin.ts` — `WORKTREE_PLUGIN_ID` → `GIT_PLUGIN_ID`，值 `"pier.worktree"` → `"pier.git"`。
- 目录 `src/plugins/builtin/worktree/` → `src/plugins/builtin/git/`（含内部模块名与 `worktree-status-item.tsx` → `git-status-item.tsx`）。
- `src/renderer/lib/plugins/builtin-catalog.ts` — import 路径与模块名。
- `src/main/plugins/builtin-catalog.ts` — import、常量名、两处硬编码目录字符串。
- `src/renderer/lib/plugins/host-context.ts` — 若引用 `WORKTREE_PLUGIN_ID` 则同步。
- `tests/unit/renderer/worktree-plugin.test.tsx` → `tests/unit/renderer/git-plugin.test.tsx` — 更新 import、常量、catalog 断言、硬编码源路径断言。

**命名决策（与设计文档一致）**

- Plugin id 改为 `pier.git`；**命令 id 保留 `pier.worktree.*`**（frecency/MRU 持久化 key，且 "git worktree" 子能力命名合理）；新增命令用 git 前缀 `pier.git.changes.open`。
- Panel component 名用 `gitChanges`（camelCase，对应 `addPanel({ component })` 字符串 key）。
- 面板单例固定 id `"git-changes"`。

---

## Task 1: git-changes panel-kit 空占位

**Files:**
- Create: `tests/component/git-changes-panel.test.tsx`
- Create: `src/renderer/panel-kits/git-changes/git-changes-panel.tsx`
- Modify: `src/renderer/components/workspace/panel-registry.ts`

- [ ] **Step 1: 写失败的面板渲染测试**

照 `tests/component/welcome-panel.test.tsx` 的 mock 模式。

```tsx
// tests/component/git-changes-panel.test.tsx
import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { GitChangesPanel } from "@/panel-kits/git-changes/git-changes-panel.tsx";

// GitChangesPanel 调 usePanelDescriptor, 需要 mock api.id + api.setTitle.
const mockProps = {
  api: { id: "git-changes-test", setTitle: vi.fn() },
  containerApi: {},
} as unknown as IDockviewPanelProps;

describe("GitChangesPanel", () => {
  it("renders the placeholder heading", () => {
    render(<GitChangesPanel {...mockProps} />);
    expect(screen.getByText("Git 变更")).toBeDefined();
  });

  it("renders the coming-soon hint", () => {
    render(<GitChangesPanel {...mockProps} />);
    expect(screen.getByText("变更预览即将到来")).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/component/git-changes-panel.test.tsx`
Expected: FAIL —— 模块 `@/panel-kits/git-changes/git-changes-panel.tsx` 不存在。

- [ ] **Step 3: 实现占位面板与 kit 元数据**

照 `src/renderer/components/workspace/welcome-panel.tsx` 结构。`kind: "web"`（面板内是 web DOM，键盘路由用）。

```tsx
// src/renderer/panel-kits/git-changes/git-changes-panel.tsx
import type { IDockviewPanelProps } from "dockview-react";
import { GitBranch } from "lucide-react";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";

export function GitChangesPanel(props: IDockviewPanelProps) {
  usePanelDescriptor(props.api, {
    display: { long: "Git 变更", short: "Git" },
  });
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-foreground text-lg">Git 变更</h1>
        <p className="mt-2 text-muted-foreground text-sm">变更预览即将到来</p>
      </div>
    </div>
  );
}

export const gitChangesPanelKit = {
  component: GitChangesPanel,
  icon: GitBranch,
  kind: "web",
} as const;
```

- [ ] **Step 4: 在 panel-registry 登记 gitChanges**

`src/renderer/components/workspace/panel-registry.ts` —— 加 import，并在三张表各加一行。

import 段加：

```ts
import { gitChangesPanelKit } from "@/panel-kits/git-changes/git-changes-panel.tsx";
```

`panelKits` 对象加 `gitChanges`：

```ts
export const panelKits = {
  terminal: terminalPanelKit,
  welcome: welcomePanelKit,
  gitChanges: gitChangesPanelKit,
} satisfies Record<string, PanelKitMetadata>;
```

`panelComponents` 加：

```ts
  gitChanges: panelKits.gitChanges.component,
```

`panelKinds` 加：

```ts
  gitChanges: panelKits.gitChanges.kind,
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/component/git-changes-panel.test.tsx`
Expected: PASS（2 passed）。

- [ ] **Step 6: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误（确认 `gitChangesPanelKit` 的 `kind: "web"` 满足 `PanelKitMetadata`）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/panel-kits/git-changes/git-changes-panel.tsx src/renderer/components/workspace/panel-registry.ts tests/component/git-changes-panel.test.tsx
git commit -m "feat(git-changes): add placeholder git-changes panel-kit"
```

---

## Task 2: 「打开变更面板」命令

**Files:**
- Create: `tests/unit/renderer/git-changes-actions.test.ts`
- Create: `src/renderer/panel-kits/git-changes/register-actions.ts`
- Modify: `src/renderer/lib/actions/types.ts`
- Modify: `src/renderer/i18n/locales/en.ts`
- Modify: `src/renderer/i18n/locales/zh-cn.ts`
- Modify: `src/renderer/stores/workspace.store.ts`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: 写失败的命令贡献测试**

照 `tests/unit/renderer/action-contributions.test.ts` 的纯元数据断言风格。

```ts
// tests/unit/renderer/git-changes-actions.test.ts
import { describe, expect, it } from "vitest";
import { GIT_CHANGES_ACTION_CONTRIBUTIONS } from "@/panel-kits/git-changes/register-actions.ts";

describe("git-changes actions", () => {
  it("declares the open-changes command contribution", () => {
    const open = GIT_CHANGES_ACTION_CONTRIBUTIONS.find(
      (action) => action.id === "pier.git.changes.open"
    );
    expect(open).toBeDefined();
    expect(open?.categoryKey).toBe("git");
    expect(open?.titleKey).toBe("commandPalette.action.openGitChanges");
    expect(open?.surfaces).toContain("command-palette");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/git-changes-actions.test.ts`
Expected: FAIL —— 模块 `register-actions.ts` 不存在。

- [ ] **Step 3: 扩展 "git" 分类（类型 + 两个消费点）**

加 `"git"` 到 `ActionCategoryKey` 会触及一个 exhaustive 的 `Record<ActionCategoryKey, string>`，必须同步补全，否则 `pnpm typecheck` 报缺键。

`src/renderer/lib/actions/types.ts` —— 联合类型按字典序加 `"git"`：

```ts
export type ActionCategoryKey =
  | "git"
  | "panel"
  | "run"
  | "settings"
  | "terminal"
  | "view"
  | "window"
  | "workspace"
  | "worktree";
```

`src/renderer/lib/actions/contribution-runtime.ts` —— `CATEGORY_BY_KEY`（`Record<ActionCategoryKey, string>`，exhaustive）补 `git`（按字母序置顶）：

```ts
const CATEGORY_BY_KEY: Record<ActionCategoryKey, string> = {
  git: "Git",
  panel: "Panel",
  run: "Run",
  settings: "Settings",
  terminal: "Terminal",
  view: "View",
  window: "Window",
  workspace: "Workspace",
  worktree: "Worktree",
};
```

`src/renderer/lib/command-palette/frecency.ts` —— `CATEGORY_META`（键为分类显示名，控制命令面板分组排序；非 exhaustive，但不补会让 git 分类落到 `UNKNOWN_ORDER` 垫底）。在 `Worktree` 后插入 `Git` 并把其后各项 order 顺延，使 git 分类紧邻 worktree：

```ts
export const CATEGORY_META: Record<
  string,
  { labelKey: string; order: number }
> = {
  View: { order: 0, labelKey: "view" },
  Workspace: { order: 1, labelKey: "workspace" },
  Worktree: { order: 2, labelKey: "worktree" },
  Git: { order: 3, labelKey: "git" },
  Run: { order: 4, labelKey: "run" },
  Panel: { order: 5, labelKey: "panel" },
  Window: { order: 6, labelKey: "window" },
  Settings: { order: 7, labelKey: "settings" },
};
```

- [ ] **Step 4: 加命令标题与分类的 i18n**

`src/renderer/i18n/locales/en.ts` —— `commandPalette.category` 加 `git`，`commandPalette.action` 加 `openGitChanges`：

在 `category` 对象内加：

```ts
      git: "Git",
```

在 `action` 对象内加：

```ts
      openGitChanges: "Open Git Changes",
```

`src/renderer/i18n/locales/zh-cn.ts` —— 同样位置加：

`category` 内：

```ts
      git: "Git",
```

`action` 内：

```ts
      openGitChanges: "打开变更面板",
```

- [ ] **Step 5: workspace store 加 openGitChanges（单例打开）**

`src/renderer/stores/workspace.store.ts` —— `WorkspaceState` 接口在 `closeActivePanel` 附近加方法签名：

```ts
  openGitChanges: () => void;
```

在 store 实现里（`addTab` 实现之后）加实现。复用已 import 的 `activateWorkspacePanel`（行 8）与 `scheduleRevealDockviewTabByPanelId`（行 9）：

```ts
  openGitChanges: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const existing = api.panels.find((panel) => panel.id === "git-changes");
    if (existing) {
      activateWorkspacePanel(api, existing.id, { reveal: "always" });
      return;
    }
    api.addPanel({
      id: "git-changes",
      component: "gitChanges",
      title: "Git 变更",
      position: { direction: "right" },
    });
    scheduleRevealDockviewTabByPanelId("git-changes");
  },
```

- [ ] **Step 6: 写核心侧命令贡献与注册函数**

照 `src/renderer/panel-kits/terminal/register-actions.ts` 的 `registerActionContributions` 模式。

```ts
// src/renderer/panel-kits/git-changes/register-actions.ts
import { GitBranch } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export const GIT_CHANGES_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "git",
    group: "1_new",
    handler: () => {
      useWorkspaceStore.getState().openGitChanges();
    },
    iconComponent: GitBranch,
    id: "pier.git.changes.open",
    sortOrder: 1,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.openGitChanges",
  },
];

export function registerGitChangesActions(): () => void {
  return registerActionContributions(
    GIT_CHANGES_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );
}
```

- [ ] **Step 7: 在 main.tsx 注册命令**

`src/renderer/main.tsx` —— 在与 `registerTerminalActions` 同段加 import 与调用。

import 段加（与其它 panel-kit register 同区）：

```ts
import { registerGitChangesActions } from "./panel-kits/git-changes/register-actions.ts";
```

在 `registerTerminalActions();` 之后加：

```ts
registerGitChangesActions();
```

- [ ] **Step 8: 跑命令测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/git-changes-actions.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 9: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误（确认 `categoryKey: "git"` 合法、`openGitChanges` 已在接口声明、`addPanel` opts 结构匹配）。

- [ ] **Step 10: 提交**

```bash
git add src/renderer/panel-kits/git-changes/register-actions.ts src/renderer/lib/actions/types.ts src/renderer/i18n/locales/en.ts src/renderer/i18n/locales/zh-cn.ts src/renderer/stores/workspace.store.ts src/renderer/main.tsx tests/unit/renderer/git-changes-actions.test.ts
git commit -m "feat(git-changes): add open-changes command opening the panel as a singleton"
```

---

## Task 3: worktree 插件升格为 git 插件

机械重构：改名与改目录一次性协调完成，中间态不保证可编译；以 Step 末尾的 `pnpm typecheck` + 全量测试为验收。

**Files:**
- Modify: `src/shared/contracts/plugin.ts`
- Rename: `src/plugins/builtin/worktree/` → `src/plugins/builtin/git/`（及其内部文件）
- Modify: `src/renderer/lib/plugins/builtin-catalog.ts`
- Modify: `src/main/plugins/builtin-catalog.ts`
- Modify: `src/renderer/lib/plugins/host-context.ts`
- Rename + Modify: `tests/unit/renderer/worktree-plugin.test.tsx` → `tests/unit/renderer/git-plugin.test.tsx`

- [ ] **Step 1: 改插件 id 常量（名 + 值）**

`src/shared/contracts/plugin.ts` —— 唯一以字面量定义 plugin id 的地方。改常量名与值：

```ts
export const GIT_PLUGIN_ID = "pier.git";
```

（其余引用此常量的文件靠 import 跟随，命令 id 字面量 `pier.worktree.*` 不在此处、保持不变。）

- [ ] **Step 2: git mv 目录与状态项文件**

```bash
git mv src/plugins/builtin/worktree src/plugins/builtin/git
git mv src/plugins/builtin/git/renderer/worktree-status-item.tsx src/plugins/builtin/git/renderer/git-status-item.tsx
```

- [ ] **Step 3: 改 manifest（id / name / category / 常量名）**

`src/plugins/builtin/git/manifest.ts`：

- import 改为 `GIT_PLUGIN_ID as SHARED_GIT_PLUGIN_ID`。
- 导出常量 `WORKTREE_PLUGIN_MANIFEST` → `GIT_PLUGIN_MANIFEST`。
- `id: SHARED_GIT_PLUGIN_ID`。
- `name: "Worktree"` → `name: "Git"`。
- 三个命令的 `category: "Worktree"` → `category: "Git"`（命令 `id` 字段保持 `pier.worktree.*` 不变）。
- `description` 文案可保留或更新为 git 域描述，不影响功能。

- [ ] **Step 4: 改 renderer/main/locales 模块内部名**

`src/plugins/builtin/git/renderer/index.ts`：
- import `GIT_PLUGIN_ID`；`worktreeRendererPlugin` → `gitRendererPlugin`；函数 `registerWorktreePluginContributions` → `registerGitPluginContributions`；`id: GIT_PLUGIN_ID`；`registerWorktreeStatusItem` import 路径改为 `./git-status-item.tsx`。

`src/plugins/builtin/git/renderer/git-status-item.tsx`：
- 导出 `registerWorktreeStatusItem` → `registerGitStatusItem`（在 `renderer/index.ts` 同步引用名）。状态项 id `pier.worktree.status` 字面量**保留不变**（避免破坏持久化与既有断言）。

`src/plugins/builtin/git/main/index.ts`：
- import `GIT_PLUGIN_ID`；`worktreeMainPlugin` → `gitMainPlugin`；`id: GIT_PLUGIN_ID`。

`src/plugins/builtin/git/locales/index.ts`：
- 导出 `WORKTREE_PLUGIN_LOCALES` → `GIT_PLUGIN_LOCALES`（内容 JSON 不动）。

（`renderer/worktree-list-action.ts` 文件名与内部命令逻辑保留，作为 git 插件下的 worktree 子能力。）

- [ ] **Step 5: 改 renderer builtin-catalog**

`src/renderer/lib/plugins/builtin-catalog.ts`：

```ts
import type { RendererPluginModule } from "@plugins/api/renderer.ts";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";

export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  gitRendererPlugin,
] satisfies readonly RendererPluginModule[];

export function getBuiltinRendererPluginModule(
  id: string
): RendererPluginModule | undefined {
  return BUILTIN_RENDERER_PLUGIN_MODULES.find((plugin) => plugin.id === id);
}
```

- [ ] **Step 6: 改 main builtin-catalog（含硬编码路径）**

`src/main/plugins/builtin-catalog.ts` —— 改 import、`pluginPackageBaseDir` 内两处路径字符串、`BUILTIN_PLUGIN_SOURCES` 内常量名：

- import：`WORKTREE_PLUGIN_LOCALES` → `GIT_PLUGIN_LOCALES`（from `@plugins/builtin/git/locales/index.ts`）；`worktreeMainPlugin` → `gitMainPlugin`（from `@plugins/builtin/git/main/index.ts`）；`WORKTREE_PLUGIN_MANIFEST` → `GIT_PLUGIN_MANIFEST`（from `@plugins/builtin/git/manifest.ts`）。
- `new URL("../../plugins/builtin/worktree/", import.meta.url)` → `"../../plugins/builtin/git/"`。
- `resolve(process.cwd(), "src/plugins/builtin/worktree")` → `"src/plugins/builtin/git"`。
- `BUILTIN_PLUGIN_SOURCES` 内：`id: GIT_PLUGIN_MANIFEST.id`、`locales: GIT_PLUGIN_LOCALES`、`main: gitMainPlugin`、`manifest: GIT_PLUGIN_MANIFEST`。

- [ ] **Step 7: 同步 host-context 中的常量引用**

Run: `grep -n "WORKTREE_PLUGIN_ID\|builtin/worktree\|worktreeRendererPlugin" src/renderer/lib/plugins/host-context.ts`
若有命中，将 `WORKTREE_PLUGIN_ID` 改为 `GIT_PLUGIN_ID`、路径 `builtin/worktree` 改为 `builtin/git`、模块名同步。若无命中，跳过。

- [ ] **Step 8: 全局核对残留引用**

Run: `grep -rn "WORKTREE_PLUGIN_ID\|WORKTREE_PLUGIN_MANIFEST\|WORKTREE_PLUGIN_LOCALES\|worktreeRendererPlugin\|worktreeMainPlugin\|builtin/worktree\|builtin\\\\worktree" src --include="*.ts" --include="*.tsx"`
Expected: 无输出（命令 id `pier.worktree.*` 与状态项 id `pier.worktree.status` 不在此列，属保留项）。

- [ ] **Step 9: 重命名并更新插件测试**

```bash
git mv tests/unit/renderer/worktree-plugin.test.tsx tests/unit/renderer/git-plugin.test.tsx
```

在 `tests/unit/renderer/git-plugin.test.tsx` 内更新（命令 id `pier.worktree.*`、状态项 id `pier.worktree.status`、i18n key 一律**保留**；只改插件标识与路径）：

- import：`worktreeRendererPlugin` → `gitRendererPlugin`（from `@plugins/builtin/git/renderer/index.ts`）；`WORKTREE_PLUGIN_ID` → `GIT_PLUGIN_ID`。
- `pluginEntry` 内 `id: WORKTREE_PLUGIN_ID` → `id: GIT_PLUGIN_ID`；`name: "Worktree"` → `name: "Git"`。
- `activateWorktreePlugin` 内 `worktreeRendererPlugin.activate(...)` → `gitRendererPlugin.activate(...)`。
- 末尾「renderer builtin catalog owns the worktree plugin module」用例：`WORKTREE_PLUGIN_ID` → `GIT_PLUGIN_ID`，`worktreeRendererPlugin.id` → `gitRendererPlugin.id`。
- 「worktree renderer 插件只通过 plugin host API 访问宿主能力」用例的硬编码路径：
  - `src/plugins/builtin/worktree/renderer/worktree-list-action.ts` → `src/plugins/builtin/git/renderer/worktree-list-action.ts`
  - `src/plugins/builtin/worktree/renderer/worktree-status-item.tsx` → `src/plugins/builtin/git/renderer/git-status-item.tsx`
- `describe("worktree builtin plugin", ...)` 标题可更新为 `"git builtin plugin"`（可选，不影响断言）。

- [ ] **Step 10: 类型检查 + 全量测试**

Run: `pnpm typecheck`
Expected: 无错误。

Run: `pnpm vitest run tests/unit/renderer/git-plugin.test.tsx`
Expected: 全部 PASS（原 worktree 用例在新 id 下绿）。

- [ ] **Step 11: 提交**

```bash
git add -A src/shared/contracts/plugin.ts src/plugins/builtin/git src/renderer/lib/plugins/builtin-catalog.ts src/main/plugins/builtin-catalog.ts src/renderer/lib/plugins/host-context.ts tests/unit/renderer/git-plugin.test.tsx
git commit -m "refactor(plugins): rename worktree builtin plugin to git domain (pier.git)"
```

---

## Task 4: 集成验证

**Files:** 无改动，仅验证。

- [ ] **Step 1: 全量静态检查**

Run: `pnpm check`
Expected: typecheck + lint + depcruise + file-size 全过。重点确认 depcruise：`panel-kits/git-changes` 未跨 import 其它 panel-kit；插件目录边界未被破坏。

- [ ] **Step 2: 全量单元 + 组件测试**

改动触及 i18n 与插件 catalog 等共享数据，`pnpm check` 不跑 vitest，需另跑全量兜底（见 `AGENTS.md` 既有经验）。

Run: `pnpm test:unit && pnpm test:component`
Expected: 全部 PASS，无因 plugin id 改名遗漏而红的用例。

- [ ] **Step 3: 手动 dev 验证**

Run: `pnpm dev`

逐项确认：
- 命令面板搜「打开变更面板 / Open Git Changes」→ 执行后弹出 git-changes 占位面板（标题「Git 变更」，内容「变更预览即将到来」）。
- 再次执行该命令 → 不新建第二个面板，而是聚焦到已存在的面板（单例）。
- 命令面板里原 worktree 三命令仍在，归类显示为「Git」分类；`Worktree: List` 行为不变（能列工作树并打开）。
- 终端 git 状态项正常显示分支与变更数，点击仍能打开工作树列表。
- 切换语言为 English，命令标题与分类显示英文。

- [ ] **Step 4: 收尾提交（如有 lint 自动修复产生改动）**

```bash
git status
# 若 lint:fix 改动了文件:
git add <明确路径>
git commit -m "chore(git-changes): apply lint fixes"
```

---

## 自检清单（执行前已核对）

- **设计覆盖**：三层骨架的三件事（panel-kit 占位 = Task 1；打开命令 = Task 2；worktree→git 改名 = Task 3）+ 集成验证（Task 4），对应设计文档「第一期范围」逐条。
- **命令 id 保留**：`pier.worktree.*` 与 `pier.worktree.status` 全程不改，避免破坏 frecency/MRU 与既有断言；新增命令用 `pier.git.changes.open`。
- **类型一致**：`gitChangesPanelKit`（kind `"web"`）、`openGitChanges`、`GIT_CHANGES_ACTION_CONTRIBUTIONS`、`categoryKey: "git"`、`GIT_PLUGIN_ID` 在各 Task 间命名一致。
- **改名闭环**：plugin id 字面量仅 `plugin.ts` 一处；硬编码路径锁定在 `main/plugins/builtin-catalog.ts` 与插件测试两处；Step 8 grep 兜底残留。
