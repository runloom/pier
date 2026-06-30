# 业务面板插件化机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一套「插件贡献 panel」的运行时机制（主系统 panel + 插件 panel 混合注册表），并把 git-changes 从 core panel-kit 迁成 `git` 插件贡献的 panel。

**Architecture:** 插件经 `context.panels.register(组件 + 元数据)` 把 panel 写入一个独立的 `plugin-panel-registry` 单例（不放 `runtime.ts`，否则与 host-context 循环 import）；`panel-registry.ts` 动态合并静态 core panel（terminal/welcome）与插件注册表；`context.panels.open(id)` 复用 workspace.store 的单例打开逻辑。terminal/welcome 保持主系统实现。

**Tech Stack:** Electron 42 · React 19 · dockview-react 6 · TypeScript strict · Zustand 5 · Vitest 4 · zod（permissions schema）· i18next。

**配套设计：** `docs/superpowers/specs/2026-06-30-plugin-panel-mechanism-design.md`

**提交约定：** 本仓库 git 默认只读（`AGENTS.md` 05）。已获授权在当前 feature 分支 `claude/condescending-aryabhata-891108` 逐任务本地 commit（Conventional Commits，不 push），commit 只 stage 明确路径，不用 `git add .`，禁止 `--amend`/`reset`/`rebase`。

**注意（第一期共享数据回归教训）：** 改 i18n / catalog / permissions schema / CATEGORY 等共享数据后，`pnpm check` 不跑 vitest，必须另跑全量 `pnpm vitest run` 兜底。

---

## 文件结构

**新建**
- `src/shared/contracts/dockview.ts` — re-export `IDockviewPanelProps`，给受 depcruise 约束的插件代码提供 dockview 类型。
- `src/renderer/lib/plugins/plugin-panel-registry.ts` — 插件 panel 注册表单例（register/get/clearForTests）。独立模块，避免 runtime ↔ host-context 循环。
- `src/plugins/builtin/git/renderer/git-changes-panel.tsx` — git-changes 占位面板（插件版）。
- `src/plugins/builtin/git/renderer/git-changes-action.ts` — 「Git: 打开变更面板」插件命令。
- 测试：`tests/unit/renderer/plugin-panel-registry.test.ts`、`tests/unit/renderer/panel-registry-merge.test.ts`、`tests/component/git-changes-plugin-panel.test.tsx`。

**修改**
- `src/plugins/api/renderer.ts` — `PluginPanelRegistration` 类型 + `RendererPluginContext.panels` 加 `register`/`open`。
- `src/renderer/lib/plugins/host-context.ts` — panels.register/open 实现；`assertDeclaredContribution` 加 `"panel"`。
- `src/renderer/components/workspace/panel-registry.ts` — `getPanelComponents()` / `panelKindOf` / `panelIconOf` 动态合并 core + 插件。
- `src/renderer/components/workspace/workspace-host.tsx` — 动态消费 `getPanelComponents()`。
- `src/shared/contracts/permissions.ts` — 加 `panel:register` / `panel:open` capability。
- `src/plugins/builtin/git/manifest.ts` — `panels` 声明 git-changes；加 `pier.git.changes.open` 命令；permission。
- `src/plugins/builtin/git/renderer/index.ts` — activate 里注册 git-changes panel + 命令。
- `src/plugins/builtin/git/locales/en.json` + `zh-CN.json` — git-changes panel 标题 + open 命令标题。

**移除（第一期 core 实现）**
- `src/renderer/panel-kits/git-changes/`（整目录：git-changes-panel.tsx、register-actions.ts、open-git-changes.ts）。
- `panel-registry.ts` 的 `gitChanges` 静态条目（三张表）。
- `main.tsx` 的 `registerGitChangesActions` import + 调用。
- `src/renderer/i18n/locales/en.ts` + `zh-cn.ts` 的 `commandPalette.action.openGitChanges`（迁成插件命令，标题走插件 locales）。`commandPalette.category.git` **保留**（worktree 命令仍用）。
- 测试 `tests/component/git-changes-panel.test.tsx`、`tests/unit/renderer/git-changes-actions.test.ts`（迁成插件版）。

**命名约定（全 plan 一致）**
- 插件 panel id = manifest panel id = dockview component 名 = 单例 panel id = `"pier.git.changes"`。
- open 命令 id = `"pier.git.changes.open"`，categoryKey `"git"`。

---

## Task 1: 机制基础（dockview 类型 + 插件 panel 注册表）

**Files:**
- Create: `src/shared/contracts/dockview.ts`
- Create: `src/renderer/lib/plugins/plugin-panel-registry.ts`
- Modify: `src/plugins/api/renderer.ts`
- Test: `tests/unit/renderer/plugin-panel-registry.test.ts`

- [ ] **Step 1: 写失败的注册表测试**

```ts
// tests/unit/renderer/plugin-panel-registry.test.ts
import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
  registerPluginPanel,
} from "@/lib/plugins/plugin-panel-registry.ts";

const reg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

describe("plugin-panel-registry", () => {
  afterEach(() => clearPluginPanelsForTests());

  it("registers and exposes a panel", () => {
    registerPluginPanel(reg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(reg);
  });

  it("dispose removes only its own registration", () => {
    const dispose = registerPluginPanel(reg);
    dispose();
    expect(getPluginPanelRegistrations().has("pier.test.panel")).toBe(false);
  });

  it("dispose does not remove a replaced registration", () => {
    const dispose = registerPluginPanel(reg);
    const replacement = { ...reg, icon: House };
    registerPluginPanel(replacement);
    dispose();
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(
      replacement
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/plugin-panel-registry.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 新建 shared dockview 类型 re-export**

```ts
// src/shared/contracts/dockview.ts
// 给受 depcruise 约束（不能直接 import dockview）的插件代码提供 dockview 类型。
// 纯类型 re-export，无运行时副作用；未来换 dockview 只改这一处。
import type { IDockviewPanelProps } from "dockview-react";

export type { IDockviewPanelProps };
```

- [ ] **Step 4: 在插件 API 加 PluginPanelRegistration 类型**

`src/plugins/api/renderer.ts` —— 顶部 import 加（与现有 `LucideIcon` / `ReactNode` import 同区）：

```ts
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { FunctionComponent } from "react";
```

在 `RendererTerminalStatusItem` 之后加类型：

```ts
export interface PluginPanelRegistration {
  component: FunctionComponent<IDockviewPanelProps>;
  icon: LucideIcon;
  id: string;
  kind: "terminal" | "web";
  title?: string;
}
```

- [ ] **Step 5: 实现插件 panel 注册表单例**

```ts
// src/renderer/lib/plugins/plugin-panel-registry.ts
import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";

const registrations = new Map<string, PluginPanelRegistration>();

export function registerPluginPanel(
  registration: PluginPanelRegistration
): () => void {
  registrations.set(registration.id, registration);
  return () => {
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
    }
  };
}

export function getPluginPanelRegistrations(): ReadonlyMap<
  string,
  PluginPanelRegistration
> {
  return registrations;
}

export function clearPluginPanelsForTests(): void {
  registrations.clear();
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/plugin-panel-registry.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 7: 类型检查 + 提交**

Run: `pnpm typecheck`（预期无错误）

```bash
git add src/shared/contracts/dockview.ts src/renderer/lib/plugins/plugin-panel-registry.ts src/plugins/api/renderer.ts tests/unit/renderer/plugin-panel-registry.test.ts
git commit -m "feat(plugins): add plugin panel registration mechanism foundation"
```

---

## Task 2: 插件 panel API（register / open）

**Files:**
- Modify: `src/plugins/api/renderer.ts`
- Modify: `src/renderer/lib/plugins/host-context.ts`
- Test: `tests/unit/renderer/host-context-panels.test.ts`

- [ ] **Step 1: 写失败的 panels API 测试**

照 `tests/unit/renderer/worktree-plugin.test.tsx`（现 git-plugin.test.tsx）的 mock 模式——mock `window.pier`、用 `createRendererPluginContext(entry)`。

```ts
// tests/unit/renderer/host-context-panels.test.ts
import { House } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

function entryWithPanel(): PluginRegistryEntry {
  return {
    effectivePermissions: ["panel:register", "panel:open"],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test",
      panels: [{ id: "pier.test.panel", permissions: [], title: "Test" }],
      permissions: ["panel:register", "panel:open"],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

const panelReg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

describe("host-context panels", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    vi.restoreAllMocks();
  });

  it("register writes to the plugin panel registry", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    ctx.panels.register(panelReg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(panelReg);
  });

  it("register throws when panel id is not declared in manifest", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() =>
      ctx.panels.register({ ...panelReg, id: "pier.test.undeclared" })
    ).toThrow(/not declared/);
  });

  it("open is a no-op when workspace api is absent", () => {
    useWorkspaceStore.setState({ api: null });
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() => ctx.panels.open("pier.test.panel")).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/host-context-panels.test.ts`
Expected: FAIL — `ctx.panels.register` 不是函数。

- [ ] **Step 3: 扩展 RendererPluginContext.panels 接口**

`src/plugins/api/renderer.ts` —— `RendererPluginContext` 的 `panels` 字段改为：

```ts
  panels: {
    getActiveContext(): PanelContext | null;
    open(panelId: string): void;
    register(registration: PluginPanelRegistration): () => void;
  };
```

- [ ] **Step 4: host-context 实现 panels.register/open + panel 声明校验**

`src/renderer/lib/plugins/host-context.ts`：

import 段加：

```ts
import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";
import { getPluginPanelRegistrations, registerPluginPanel } from "./plugin-panel-registry.ts";
```

`assertDeclaredContribution` 的 `kind` 联合加 `"panel"`，并在 `declared` 计算里加分支：

```ts
function assertDeclaredContribution(
  entry: PluginRegistryEntry | undefined,
  kind: "action" | "panel" | "terminalStatusItem",
  id: string
): void {
  if (!entry) {
    return;
  }
  let declared: boolean;
  if (kind === "action") {
    declared = entry.manifest.commands.some((command) => command.id === id);
  } else if (kind === "panel") {
    declared = entry.manifest.panels.some((panel) => panel.id === id);
  } else {
    declared = entry.manifest.terminalStatusItems.some((item) => item.id === id);
  }
  if (!declared) {
    throw new Error(
      `plugin contribution not declared: ${entry.manifest.id}:${kind}:${id}`
    );
  }
}
```

在 `createRendererPluginContext` 之上加单例打开辅助：

```ts
function openPluginPanel(panelId: string): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const existing = api.panels.find((panel) => panel.id === panelId);
  if (existing) {
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  const registration = getPluginPanelRegistrations().get(panelId);
  api.addPanel({
    id: panelId,
    component: panelId,
    title: registration?.title ?? panelId,
    position: { direction: "right" },
  });
  scheduleRevealDockviewTabByPanelId(panelId);
}
```

把 context 的 `panels` 字段改为：

```ts
    panels: {
      getActiveContext: () => {
        const state = usePanelDescriptorStore.getState();
        return state.activeId
          ? (state.descriptors[state.activeId]?.context ?? null)
          : null;
      },
      open: (panelId) => openPluginPanel(panelId),
      register: (registration) => {
        assertDeclaredContribution(entry, "panel", registration.id);
        return registerPluginPanel(registration);
      },
    },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/host-context-panels.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 6: 类型检查 + 提交**

Run: `pnpm typecheck`（预期无错误）

```bash
git add src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts tests/unit/renderer/host-context-panels.test.ts
git commit -m "feat(plugins): add panels.register/open to plugin host context"
```

---

## Task 3: dockview 接入（panel-registry 动态合并）

**Files:**
- Modify: `src/renderer/components/workspace/panel-registry.ts`
- Modify: `src/renderer/components/workspace/workspace-host.tsx`
- Test: `tests/unit/renderer/panel-registry-merge.test.ts`

- [ ] **Step 1: 写失败的合并测试**

```ts
// tests/unit/renderer/panel-registry-merge.test.ts
import { House } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPanelComponents,
  panelIconOf,
  panelKindOf,
} from "@/components/workspace/panel-registry.ts";
import {
  clearPluginPanelsForTests,
  registerPluginPanel,
} from "@/lib/plugins/plugin-panel-registry.ts";

describe("panel-registry dynamic merge", () => {
  afterEach(() => clearPluginPanelsForTests());

  it("includes core panels (terminal/welcome) always", () => {
    const components = getPanelComponents();
    expect(components.terminal).toBeDefined();
    expect(components.welcome).toBeDefined();
  });

  it("merges plugin-registered panels", () => {
    registerPluginPanel({
      component: () => null,
      icon: House,
      id: "pier.test.panel",
      kind: "web",
    });
    expect(getPanelComponents()["pier.test.panel"]).toBeDefined();
    expect(panelKindOf("pier.test.panel")).toBe("web");
    expect(panelIconOf("pier.test.panel")).toBe(House);
  });

  it("core panel kind/icon takes precedence and unknown falls back to web", () => {
    expect(panelKindOf("terminal")).toBe("terminal");
    expect(panelKindOf("nonexistent")).toBe("web");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/panel-registry-merge.test.ts`
Expected: FAIL — `getPanelComponents` 未导出。

- [ ] **Step 3: panel-registry 改为动态合并**

`src/renderer/components/workspace/panel-registry.ts` —— 保留 `panelKits`（core 静态）；把 `panelComponents`（静态变量）替换为 `getPanelComponents()` 函数，并让 `panelKindOf`/`panelIconOf` 回落到插件注册表。完整新内容：

```ts
import type { IDockviewPanelProps } from "dockview-react";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";
import { getPluginPanelRegistrations } from "@/lib/plugins/plugin-panel-registry.ts";
import { terminalPanelKit } from "@/panel-kits/terminal/terminal-panel.tsx";
import { welcomePanelKit } from "./welcome-panel.tsx";

type PanelKind = "terminal" | "web";

interface PanelKitMetadata {
  component: FunctionComponent<IDockviewPanelProps>;
  icon: LucideIcon;
  kind: PanelKind;
}

/**
 * Core（主系统）panel kit 静态表 — terminal native bridge、welcome fallback 等
 * 系统预留能力。业务插件 panel 通过 plugin-panel-registry 动态叠加，见
 * getPanelComponents()。新增主系统 panel 时在此登记一行。
 */
export const panelKits = {
  terminal: terminalPanelKit,
  welcome: welcomePanelKit,
} satisfies Record<string, PanelKitMetadata>;

/**
 * dockview component 名 → React 组件。合并 core 静态 panel 与插件动态 panel。
 * 在 workspace-host render 时调用（此时 bootstrap 已注册插件 panel）。
 */
export function getPanelComponents(): Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> {
  const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
    terminal: panelKits.terminal.component,
    welcome: panelKits.welcome.component,
  };
  for (const [id, registration] of getPluginPanelRegistrations()) {
    components[id] = registration.component;
  }
  return components;
}

const corePanelKitByComponent: Readonly<Record<string, PanelKitMetadata>> =
  panelKits;

/**
 * Panel kit 类型（keyboard 路由用）。core 优先，插件 panel 次之，未知 default 'web'。
 */
export function panelKindOf(component: string): "terminal" | "web" {
  const core = corePanelKitByComponent[component];
  if (core) {
    return core.kind;
  }
  return getPluginPanelRegistrations().get(component)?.kind ?? "web";
}

export function panelIconOf(component: string): LucideIcon | null {
  const core = corePanelKitByComponent[component];
  if (core) {
    return core.icon;
  }
  return getPluginPanelRegistrations().get(component)?.icon ?? null;
}
```

- [ ] **Step 4: workspace-host 消费动态 components**

`src/renderer/components/workspace/workspace-host.tsx`：

import 改（行 30 附近）：把 `panelComponents` 换成 `getPanelComponents`：

```ts
import { getPanelComponents, panelKindOf } from "./panel-registry.ts";
```

在组件体内、`DockviewReact` 渲染前，加一个 memo（插件 panel 在 bootstrap 阶段已注册，bootstrap 先于 App render）：

```ts
  const panelComponents = useMemo(() => getPanelComponents(), []);
```

`DockviewReact` 的 `components={panelComponents}`（行 348 附近）保持不变（现在引用的是 memo 值）。若 `useMemo` 尚未 import，在 react import 处补上。

- [ ] **Step 5: 跑测试确认通过 + 类型检查**

Run: `pnpm vitest run tests/unit/renderer/panel-registry-merge.test.ts`（预期 3 passed）
Run: `pnpm typecheck`（预期无错误）

- [ ] **Step 6: 确认 bootstrap 先于 render（timing 兜底）**

读 `src/renderer/main.tsx`，确认 `bootstrapBuiltinPlugins()` 在 `ReactDOM.createRoot(...).render(...)` 之前 `await`（保证首次 render 时插件 panel 已注册）。若不是，调整顺序使 bootstrap 先完成。记录确认结果。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/components/workspace/panel-registry.ts src/renderer/components/workspace/workspace-host.tsx tests/unit/renderer/panel-registry-merge.test.ts
git commit -m "feat(workspace): merge plugin-contributed panels into dockview registry"
```

---

## Task 4: permission 拆分（panel:register / panel:open）

**Files:**
- Modify: `src/shared/contracts/permissions.ts`
- Test: 扩展现有 permissions 测试或新建 `tests/unit/permissions-panel-caps.test.ts`

- [ ] **Step 1: 先读现状**

读 `src/shared/contracts/permissions.ts`，定位 `pierCapabilitySchema`（zod enum）。确认现有 capability 命名风格（如 `worktree:read`、`workspace:open`、`command:register`）。若已存在 `panel:control` 则替换，否则新增。

- [ ] **Step 2: 写失败的 schema 测试**

```ts
// tests/unit/permissions-panel-caps.test.ts
import { describe, expect, it } from "vitest";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";

describe("panel capabilities", () => {
  it("accepts panel:register and panel:open", () => {
    expect(pierCapabilitySchema.safeParse("panel:register").success).toBe(true);
    expect(pierCapabilitySchema.safeParse("panel:open").success).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/permissions-panel-caps.test.ts`
Expected: FAIL — 两个 capability 未在 enum。

- [ ] **Step 4: 加 capability**

`src/shared/contracts/permissions.ts` —— 在 `pierCapabilitySchema` 的 enum 成员里按现有风格加 `"panel:register"` 与 `"panel:open"`（保持文件内既有排序约定）。若存在权限标签 i18n（`src/renderer/i18n/locales/plugin-permission-labels.ts`），补两条对应中英标签。

- [ ] **Step 5: 跑测试确认通过 + 全量兜底**

Run: `pnpm vitest run tests/unit/permissions-panel-caps.test.ts`（预期 PASS）
Run: `pnpm vitest run`（permissions 是共享数据，全量兜底；预期全绿）

- [ ] **Step 6: 提交**

```bash
git add src/shared/contracts/permissions.ts tests/unit/permissions-panel-caps.test.ts src/renderer/i18n/locales/plugin-permission-labels.ts
git commit -m "feat(permissions): split panel capability into panel:register and panel:open"
```

---

## Task 5: git-changes 迁成 git 插件 panel

把第一期的 core panel-kit 替换为 git 插件贡献的 panel + 插件命令。

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-changes-panel.tsx`
- Create: `src/plugins/builtin/git/renderer/git-changes-action.ts`
- Create: `tests/component/git-changes-plugin-panel.test.tsx`
- Modify: `src/plugins/builtin/git/manifest.ts`
- Modify: `src/plugins/builtin/git/renderer/index.ts`
- Modify: `src/plugins/builtin/git/locales/en.json` + `zh-CN.json`
- Modify: `src/renderer/i18n/locales/en.ts` + `zh-cn.ts`（移除 `action.openGitChanges`）
- Delete: `src/renderer/panel-kits/git-changes/`（整目录）
- Delete: `tests/component/git-changes-panel.test.tsx`、`tests/unit/renderer/git-changes-actions.test.ts`
- Modify: `src/renderer/main.tsx`（移除 `registerGitChangesActions`）

- [ ] **Step 1: 移除第一期 core 实现**

```bash
git rm -r src/renderer/panel-kits/git-changes
git rm tests/component/git-changes-panel.test.tsx tests/unit/renderer/git-changes-actions.test.ts
```

`src/renderer/main.tsx`：删除 `import { registerGitChangesActions } from "./panel-kits/git-changes/register-actions.ts";` 与其调用 `registerGitChangesActions();`。

`src/renderer/components/workspace/panel-registry.ts`：本任务依赖 Task 3 的版本（已无 `gitChanges` 静态条目——Task 3 重写时就不含它；若仍在，删除三处 `gitChanges` 引用）。

`src/renderer/i18n/locales/en.ts` + `zh-cn.ts`：删除 `commandPalette.action.openGitChanges`（插件命令的标题改走插件 locales）。**保留** `commandPalette.category.git`。

- [ ] **Step 2: 写失败的插件 panel 渲染测试**

```tsx
// tests/component/git-changes-plugin-panel.test.tsx
import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { GitChangesPanel } from "@plugins/builtin/git/renderer/git-changes-panel.tsx";

const mockProps = {
  api: { id: "pier.git.changes", setTitle: vi.fn() },
  containerApi: {},
} as unknown as IDockviewPanelProps;

describe("GitChangesPanel (plugin)", () => {
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

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/component/git-changes-plugin-panel.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现插件版占位面板**

dockview 类型走 `@shared/contracts/dockview.ts`（插件不能直接 import dockview）。`usePanelDescriptor` 是 renderer hook——插件不能 import renderer，所以**插件 panel 不用 usePanelDescriptor**，标题靠 `addPanel` 的 title + dockview api。占位面板只渲染内容：

```tsx
// src/plugins/builtin/git/renderer/git-changes-panel.tsx
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";

export function GitChangesPanel(_props: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="font-semibold text-foreground text-lg">Git 变更</h1>
        <p className="mt-2 text-muted-foreground text-sm">变更预览即将到来</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: manifest 声明 panel + open 命令 + permission**

`src/plugins/builtin/git/manifest.ts`：

`panels: []` 改为：

```ts
  panels: [
    {
      id: "pier.git.changes",
      permissions: ["panel:register", "panel:open"],
      title: "Git Changes",
    },
  ],
```

`commands` 数组追加一条（其余三条 worktree 命令不动）：

```ts
    {
      category: "Git",
      id: "pier.git.changes.open",
      permissions: ["panel:open"],
      title: "Git: Open Changes",
    },
```

`permissions` 全局数组追加 `"panel:register"`, `"panel:open"`。

- [ ] **Step 6: 实现 git-changes open 插件命令**

照 `worktree-list-action.ts` 用 `context.actions.register` 的模式。命令 handler 调 `context.panels.open`：

```ts
// src/plugins/builtin/git/renderer/git-changes-action.ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";

export function registerGitChangesAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    handler: () => context.panels.open("pier.git.changes"),
    id: "pier.git.changes.open",
    metadata: {
      aliases: () => [
        "git changes",
        "open changes",
        "变更",
        "打开变更面板",
        "biangeng",
        context.i18n.commandTitle("pier.git.changes.open", "Git: Open Changes"),
      ],
      categoryKey: "git",
      group: "1_new",
      iconComponent: GitBranch,
      sortOrder: 4,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.git.changes.open", "Git: Open Changes"),
  });
}
```

- [ ] **Step 7: 在插件 activate 注册 panel + 命令**

`src/plugins/builtin/git/renderer/index.ts`：

import 加：

```ts
import { GitBranch } from "lucide-react";
import { GitChangesPanel } from "./git-changes-panel.tsx";
import { registerGitChangesAction } from "./git-changes-action.ts";
```

`registerGitPluginContributions` 的 disposers 数组加 panel 注册与命令：

```ts
export function registerGitPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeActions(context),
    registerGitStatusItem(context),
    context.panels.register({
      component: GitChangesPanel,
      icon: GitBranch,
      id: "pier.git.changes",
      kind: "web",
      title: "Git 变更",
    }),
    registerGitChangesAction(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
```

- [ ] **Step 8: 插件 locales 加命令标题**

`src/plugins/builtin/git/locales/en.json` —— 在 `commands` 对象加 `"pier.git.changes.open": { "title": "Git: Open Changes" }`。
`src/plugins/builtin/git/locales/zh-CN.json` —— 加 `"pier.git.changes.open": { "title": "Git: 打开变更面板" }`。
（具体 JSON 结构照该文件现有 `pier.worktree.list` 等命令条目的写法。）

- [ ] **Step 9: 跑测试确认通过**

Run: `pnpm vitest run tests/component/git-changes-plugin-panel.test.tsx`（预期 2 passed）
Run: `pnpm typecheck`（预期无错误）

- [ ] **Step 10: 更新插件测试覆盖 panel 贡献**

`tests/unit/renderer/git-plugin.test.tsx`：`pluginEntry` 的 manifest `panels: []` 改为含 `pier.git.changes` 的声明（与 manifest 一致），并加一条用例断言 activate 后 `getPluginPanelRegistrations().has("pier.git.changes")` 为 true、`actionRegistry.get("pier.git.changes.open")` 已注册。import `clearPluginPanelsForTests` 在 afterEach 清理。

- [ ] **Step 11: 全量兜底 + 提交**

Run: `pnpm vitest run`（迁移 + i18n + manifest 改动，全量兜底；预期全绿）
Run: `pnpm check`（typecheck + lint + depcruise + file-size；depcruise 确认插件未直接 import dockview/renderer）

```bash
git add src/plugins/builtin/git src/renderer/main.tsx src/renderer/i18n/locales/en.ts src/renderer/i18n/locales/zh-cn.ts tests/component/git-changes-plugin-panel.test.tsx tests/unit/renderer/git-plugin.test.tsx
git commit -m "feat(git): move git-changes panel into the git plugin via panels API"
```

---

## Task 6: 集成验证

**Files:** 无改动，仅验证。

- [ ] **Step 1: 全量静态检查**

Run: `pnpm check`
Expected: 全过。重点：depcruise 确认 `src/plugins/` 未 import `dockview`/`src/renderer`/`src/main`；`workspace.store` 不再有 git-changes 残留。

- [ ] **Step 2: 全量测试**

Run: `pnpm test:unit && pnpm test:component`
Expected: 全绿，无因 git-changes 迁移遗漏而红的用例。

- [ ] **Step 3: 残留扫描**

Run: `grep -rn "panel-kits/git-changes\|registerGitChangesActions\|openGitChanges" src tests`
Expected: 无输出（core 实现已全移除；插件版用 `git-changes-action` / `panels.open`，不含这些符号）。

- [ ] **Step 4: 手动 dev 验证**（需有显示环境，控制器无法代跑）

Run: `pnpm dev`
逐项确认：
- 命令面板搜「Git: 打开变更面板 / Git: Open Changes」→ 弹出 git-changes 面板（「Git 变更」+「变更预览即将到来」），归 Git 分类。
- 再次执行 → 聚焦已有面板（单例）。
- 设置页插件列表里 `git` 插件显示 panel 贡献 + `panel:register`/`panel:open` 权限。
- terminal、welcome（新建空 tab fallback）正常——主系统 panel 不受影响。
- 关闭 `git` 插件（若设置页支持 toggle）后重启，git-changes 命令/面板消失，terminal/welcome 仍在。

---

## 自检清单（执行前已核对）

- **Spec 覆盖**：机制（dockview 类型=T1；注册表=T1；panels API=T2；动态合并=T3；permission=T4）+ git-changes 迁移=T5 + 验证=T6。设计「机制设计」7 改动点逐条有 task。
- **循环 import 规避**：插件 panel 注册表是独立模块（plugin-panel-registry.ts），host-context 与 panel-registry 都依赖它，runtime.ts 不涉及——不触发 runtime↔host-context 循环。
- **主系统 panel 保留**：panel-registry 的 `panelKits`（terminal/welcome）保持静态，getPanelComponents 只「叠加」插件 panel，符合混合注册表终态。
- **类型/命名一致**：`PluginPanelRegistration`、`registerPluginPanel`/`getPluginPanelRegistrations`/`clearPluginPanelsForTests`、`getPanelComponents`/`panelKindOf`/`panelIconOf`、`panel:register`/`panel:open`、panel id `pier.git.changes`、命令 id `pier.git.changes.open` 跨 task 一致。
- **插件边界**：插件 panel 组件用 `@shared/contracts/dockview.ts` 取类型、不用 renderer 的 `usePanelDescriptor`；命令经 `context.panels.open`，不直接 import workspace.store——满足「插件不 import renderer/dockview」。
