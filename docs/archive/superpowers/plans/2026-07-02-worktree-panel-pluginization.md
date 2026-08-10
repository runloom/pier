# Worktree 创建面板插件化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [插件化 spec](../specs/2026-07-02-worktree-panel-pluginization-design.md) 把创建面板从 renderer core 迁入 git 插件：新增通用 overlay 原语 + 两个 worktree 域命令，删除 feature-specific 桥与核心面板。

**Architecture:** 平台侧加三块——`context.overlays`（宿主 zustand store + host 组件承担 blocking 三件套）、`worktree.creationDefaults` / `worktree.openTerminal` 两个 Pier command（main 侧读偏好/拼 launch，插件传不了任意命令）；然后面板组件迁入插件（组件本地 state，数据由 action handler 收集经 render 闭包传入），最后删核心面板/store/桥/preload `terminal.open`，「+」菜单改走 `actionRegistry` 按 id 执行。

**Tech Stack:** 同 P1（Electron 三端 · zod · zustand(仅宿主) · @pier/ui · Vitest）。

## Global Constraints

- 交互与视觉不可变：面板行为、键位（⏎/⇧⏎/esc）、推导语义、样式与 P1 终态 commit `a22c03a` 逐像素一致。
- `worktree.openTerminal` 的 setup 命令只能来自用户偏好（`preferences.worktreeSetupCommand`），请求体只有 `{path, runSetup}` —— 插件不能传任意命令字符串（spec 风险节点，review 重点）。
- `worktree.creationDefaults` 只返回 `branchPrefix` / `copyPatterns` / `setupCommand` 三键，不泄露其它偏好。
- overlay 原语单例语义（新 open 顶替旧的）；不设 manifest 权限；插件 deactivate 时宿主自动关闭其 overlay。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`；每任务收尾 `pnpm lint:fix && pnpm typecheck`。
- 插件 i18n：locales JSON 的 `messages` 平铺键（如 `"ui.worktreeCreate.title"`），en 与 zh-CN 键集一致。
- Commit 只 stage 明确路径（禁止 `git add .`），Conventional Commits，结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 权限映射：`worktree.creationDefaults` → `["worktree:read"]`；`worktree.openTerminal` → `["worktree:write"]`；manifest 中 `pier.worktree.create` 的 permissions 增补 `worktree:read`。

---

### Task 1: 通用 overlay 原语（store + host + 插件 API + runtime 清理）

**Files:**
- Create: `src/renderer/stores/plugin-overlay.store.ts`
- Create: `src/renderer/components/common/plugin-overlay-host.tsx`
- Modify: `src/renderer/components/common/app-shell.tsx`（`<AppDialogHost />` 旁挂 `<PluginOverlayHost />`；本任务不动 `WorktreeCreateHost`）
- Modify: `src/plugins/api/renderer.ts`（`RendererPluginContext` 加 `overlays` 段；`ReactNode` 已在该文件 import）
- Modify: `src/renderer/lib/plugins/host-context.ts`（实现 `overlays`，pluginId 取 `entry.manifest.id`）
- Modify: `src/renderer/lib/plugins/runtime.ts`（disposer 链追加 overlay 清理）
- Test: `tests/component/plugin-overlay-host.test.tsx`

**Interfaces:**
- Consumes: `useKeybindingScope` / `registerTerminalFullscreenWebOverlay` / `requestTerminalWebFocus`（照抄 [app-dialog-host.tsx:26-39](../../../src/renderer/components/common/app-dialog-host.tsx) 的 blocking 三件套用法）
- Produces（Task 3 消费）:
  ```ts
  // plugin-overlay.store.ts
  export interface PluginOverlayRequest {
    id: string;
    render: (controls: { close: () => void }) => ReactNode;
  }
  export interface ActivePluginOverlay extends PluginOverlayRequest { pluginId: string; }
  export const usePluginOverlayStore: /* zustand */ { current: ActivePluginOverlay | null };
  export function openPluginOverlay(pluginId: string, overlay: PluginOverlayRequest): void;
  export function closePluginOverlay(pluginId: string, id: string): void;
  export function closeOverlaysForPlugin(pluginId: string): void;
  ```
  ```ts
  // plugins/api/renderer.ts — RendererPluginContext 新增段（字母序放在 notifications 之后 panels 之前）
  overlays: {
    open(overlay: { id: string; render: (controls: { close: () => void }) => ReactNode }): void;
    close(id: string): void;
  };
  ```

- [ ] **Step 1: 写失败测试**

```tsx
// tests/component/plugin-overlay-host.test.tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PluginOverlayHost } from "@/components/common/plugin-overlay-host.tsx";
import {
  closeOverlaysForPlugin,
  openPluginOverlay,
  usePluginOverlayStore,
} from "@/stores/plugin-overlay.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

afterEach(() => {
  closeOverlaysForPlugin("pier.git");
  closeOverlaysForPlugin("pier.other");
});

describe("PluginOverlayHost", () => {
  it("open 渲染内容并压入 blocking scope,close 清理", () => {
    render(<PluginOverlayHost />);
    openPluginOverlay("pier.git", {
      id: "demo",
      render: ({ close }) => (
        <button onClick={close} type="button">
          overlay-content
        </button>
      ),
    });
    expect(screen.getByText("overlay-content")).toBeInTheDocument();
    expect(
      useKeybindingScope
        .getState()
        .blockingScopes.includes("overlay:plugin:pier.git:demo")
    ).toBe(true);

    screen.getByText("overlay-content").click();
    expect(screen.queryByText("overlay-content")).not.toBeInTheDocument();
    expect(
      useKeybindingScope
        .getState()
        .blockingScopes.includes("overlay:plugin:pier.git:demo")
    ).toBe(false);
  });

  it("新 open 顶替旧 overlay(单例语义)", () => {
    render(<PluginOverlayHost />);
    openPluginOverlay("pier.git", { id: "a", render: () => <p>first</p> });
    openPluginOverlay("pier.other", { id: "b", render: () => <p>second</p> });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("closeOverlaysForPlugin 只清理该插件的 overlay", () => {
    render(<PluginOverlayHost />);
    openPluginOverlay("pier.git", { id: "a", render: () => <p>mine</p> });
    closeOverlaysForPlugin("pier.other");
    expect(screen.getByText("mine")).toBeInTheDocument();
    closeOverlaysForPlugin("pier.git");
    expect(screen.queryByText("mine")).not.toBeInTheDocument();
    expect(usePluginOverlayStore.getState().current).toBeNull();
  });
});
```

实现提示：`useKeybindingScope` 的 state 字段名以 `src/renderer/stores/keybinding-scope.store.ts` 实际为准（若非 `blockingScopes` 数组则按实际 API 断言）；测试渲染 harness 对齐 `tests/component/app-dialog-host.test.tsx`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/component/plugin-overlay-host.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 store**

```ts
// src/renderer/stores/plugin-overlay.store.ts
/**
 * 插件模态 overlay 状态。全局单例:新 open 顶替当前 overlay(旧的视为关闭)。
 * 渲染与 blocking 生命周期由 components/common/plugin-overlay-host.tsx 承担。
 */
import type { ReactNode } from "react";
import { create } from "zustand";

export interface PluginOverlayRequest {
  id: string;
  render: (controls: { close: () => void }) => ReactNode;
}

export interface ActivePluginOverlay extends PluginOverlayRequest {
  pluginId: string;
}

interface PluginOverlayState {
  current: ActivePluginOverlay | null;
}

export const usePluginOverlayStore = create<PluginOverlayState>(() => ({
  current: null,
}));

export function openPluginOverlay(
  pluginId: string,
  overlay: PluginOverlayRequest
): void {
  usePluginOverlayStore.setState({ current: { ...overlay, pluginId } });
}

export function closePluginOverlay(pluginId: string, id: string): void {
  const current = usePluginOverlayStore.getState().current;
  if (current && current.pluginId === pluginId && current.id === id) {
    usePluginOverlayStore.setState({ current: null });
  }
}

export function closeOverlaysForPlugin(pluginId: string): void {
  const current = usePluginOverlayStore.getState().current;
  if (current?.pluginId === pluginId) {
    usePluginOverlayStore.setState({ current: null });
  }
}
```

- [ ] **Step 4: 实现 host**

```tsx
// src/renderer/components/common/plugin-overlay-host.tsx
import { useEffect } from "react";
import {
  closePluginOverlay,
  usePluginOverlayStore,
} from "@/stores/plugin-overlay.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";

export function PluginOverlayHost() {
  const current = usePluginOverlayStore((state) => state.current);
  const overlayKey = current ? `${current.pluginId}:${current.id}` : null;

  useEffect(() => {
    if (!overlayKey) {
      return;
    }
    const hostId = `plugin:${overlayKey}`;
    const route = registerTerminalFullscreenWebOverlay(hostId);
    const releaseWebFocus = requestTerminalWebFocus(hostId);
    const scopeId = `overlay:${hostId}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
  }, [overlayKey]);

  if (!current) {
    return null;
  }
  return current.render({
    close: () => closePluginOverlay(current.pluginId, current.id),
  });
}
```

- [ ] **Step 5: 插件 API + host-context + runtime**

`src/plugins/api/renderer.ts` 的 `RendererPluginContext` 增加（字母序落位）：

```ts
  overlays: {
    close(id: string): void;
    open(overlay: {
      id: string;
      render: (controls: { close: () => void }) => ReactNode;
    }): void;
  };
```

`src/renderer/lib/plugins/host-context.ts` 的 context 实现对象增加（import store 三函数）：

```ts
    overlays: {
      close: (id) => {
        closePluginOverlay(entry.manifest.id, id);
      },
      open: (overlay) => {
        openPluginOverlay(entry.manifest.id, overlay);
      },
    },
```

`src/renderer/lib/plugins/runtime.ts` 的 `refresh()` 中，disposer 注册改为复合清理：

```ts
      const dispose = module.activate(context);
      this.disposers.set(entry.manifest.id, () => {
        dispose();
        closeOverlaysForPlugin(entry.manifest.id);
      });
```

（import `closeOverlaysForPlugin`。）`app-shell.tsx` 在 `<AppDialogHost />` 后挂 `<PluginOverlayHost />`。

- [ ] **Step 6: 跑测试确认通过 + 回归**

Run: `pnpm vitest run tests/component/plugin-overlay-host.test.tsx tests/component/app-dialog-host.test.tsx && pnpm lint:fix && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/plugin-overlay.store.ts src/renderer/components/common/plugin-overlay-host.tsx src/renderer/components/common/app-shell.tsx src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts tests/component/plugin-overlay-host.test.tsx
git commit -m "feat(plugins): modal overlay primitive for renderer plugins"
```

---

### Task 2: `worktree.creationDefaults` + `worktree.openTerminal` 两个域命令

**Files:**
- Modify: `src/shared/contracts/worktree.ts`
- Modify: `src/shared/contracts/commands.ts`（worktree 命令组处，行 150-170 附近）
- Modify: `src/main/app-core/permissions.ts:40-45`
- Modify: `src/main/app-core/command-router.ts`（`executeWorktreeCommand` + 新 helper）
- Modify: `src/preload/worktree-api.ts`
- Modify: `src/plugins/api/renderer.ts` + `src/renderer/lib/plugins/host-context.ts`（`worktrees` 段各加两方法）
- Modify: `src/plugins/builtin/git/manifest.ts`（`pier.worktree.create` permissions 加 `worktree:read`）
- Test: `tests/unit/app-core/command-router.test.ts`（追加）

**Interfaces:**
- Consumes: `services.preferences.read()`（router 已有先例）、`executeTerminalOpenCommand`（`command-router.ts` 顶部已 import）、`sameResolvedPath`（router 内已有）
- Produces（Task 3 消费）:
  ```ts
  // shared/contracts/worktree.ts
  export const worktreeCreationDefaultsSchema = z.object({
    branchPrefix: z.string(),
    copyPatterns: z.array(z.string()),
    setupCommand: z.string(),
  });
  export type WorktreeCreationDefaults = z.infer<typeof worktreeCreationDefaultsSchema>;
  export const worktreeOpenTerminalRequestSchema = z.object({
    path: z.string().min(1),
    runSetup: z.boolean(),
  });
  export type WorktreeOpenTerminalRequest = z.infer<typeof worktreeOpenTerminalRequestSchema>;
  ```
  ```ts
  // 插件 context worktrees 段新增
  creationDefaults(): Promise<WorktreeCreationDefaults>;
  openTerminal(request: WorktreeOpenTerminalRequest): Promise<unknown>;
  ```

- [ ] **Step 1: 写失败测试（追加到 `tests/unit/app-core/command-router.test.ts`，harness 复用文件内既有 services 桩模式）**

```ts
describe("worktree.creationDefaults / worktree.openTerminal", () => {
  it("creationDefaults 只返回三个 worktree 偏好键", async () => {
    const { router } = createHarness();
    const result = await router.execute({
      command: { type: "worktree.creationDefaults" },
      requestId: "req-wt-defaults",
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({
      branchPrefix: "wt/",
      copyPatterns: [".env*", "*.local", ".claude/settings.local.json"],
      setupCommand: "",
    });
  });

  it("openTerminal 拒绝不是本仓 worktree 的 path", async () => {
    const { router } = createHarness();
    const result = await router.execute({
      command: {
        path: "/not/a/worktree",
        runSetup: true,
        type: "worktree.openTerminal",
      },
      requestId: "req-wt-open-term",
    });
    expect(result.ok).toBe(false);
  });

  it("openTerminal runSetup 且偏好有 setup 命令时 launch 带 command,否则只带 cwd", async () => {
    // 桩 worktrees.list 返回含 targetPath 的 available 结果;
    // 桩 preferences.read 返回 worktreeSetupCommand: "pnpm setup:worktree";
    // 断言 rendererCommand.execute 收到的 terminal.open 载荷:
    //   runSetup:true  -> launchId 对应注册的 launch { cwd: targetPath, command: "pnpm setup:worktree" }
    //   runSetup:false -> launch 无 command 键
  });
});
```

注意：第三个用例的桩接法必须按该测试文件里 `worktree.create`（行 2203 起）与 `terminal.open` 既有用例的实际 harness 写全——上面注释是行为规格,提交的测试不允许留注释桩,必须是可执行断言。`createHarness` 为示意名,用文件内真实的构造函数。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/app-core/command-router.test.ts`
Expected: FAIL — 未知命令类型（schema 解析失败）

- [ ] **Step 3: 契约 + 权限**

`src/shared/contracts/worktree.ts` 末尾加 Interfaces 节的两个 schema；`src/shared/contracts/commands.ts` 的 worktree 命令组加：

```ts
  z.object({ type: z.literal("worktree.creationDefaults") }),
  worktreeOpenTerminalRequestSchema.extend({
    type: z.literal("worktree.openTerminal"),
  }),
```

`src/main/app-core/permissions.ts` 的映射表（字母序）加：

```ts
  "worktree.creationDefaults": ["worktree:read"],
  "worktree.openTerminal": ["worktree:write"],
```

- [ ] **Step 4: router 实现**

`executeWorktreeCommand` 加两个 case：

```ts
    case "worktree.creationDefaults": {
      const preferences = await services.preferences.read();
      return success(requestId, {
        branchPrefix: preferences.worktreeBranchPrefix,
        copyPatterns: preferences.worktreeCopyPatterns,
        setupCommand: preferences.worktreeSetupCommand,
      });
    }
    case "worktree.openTerminal":
      return await executeWorktreeOpenTerminalCommand(
        requestId,
        command,
        services
      );
```

新 helper（放 `executeWorktreeOpenCommand` 之后，路径校验逻辑与其一致）：

```ts
async function executeWorktreeOpenTerminalCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "worktree.openTerminal" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const result = await services.worktrees.list({ path: command.path });
  if (result.status === "unavailable") {
    return failure(
      requestId,
      result.reason,
      `path is not a known worktree for this repository: ${command.path}`
    );
  }
  const target = result.worktrees.find(
    (item) =>
      sameResolvedPath(item.path, command.path) && !(item.bare || item.prunable)
  );
  if (!target) {
    return failure(
      requestId,
      "invalid_path",
      `path is not a known worktree for this repository: ${command.path}`
    );
  }
  // setup 命令只来自用户偏好 —— 插件调用方传不了任意命令字符串。
  const preferences = await services.preferences.read();
  const setup = command.runSetup ? preferences.worktreeSetupCommand.trim() : "";
  return await executeTerminalOpenCommand(
    requestId,
    {
      focus: true,
      launch: { cwd: target.path, ...(setup ? { command: setup } : {}) },
      type: "terminal.open",
    },
    services
  );
}
```

- [ ] **Step 5: preload + 插件 context + manifest**

`src/preload/worktree-api.ts`（接口与实现同步加，import 两个新类型）：

```ts
  creationDefaults: () =>
    invokePierCommand<WorktreeCreationDefaults>({
      type: "worktree.creationDefaults",
    }),
  openTerminal: (request: WorktreeOpenTerminalRequest) =>
    invokePierCommand<unknown>({ ...request, type: "worktree.openTerminal" }),
```

`src/plugins/api/renderer.ts` 的 `worktrees` 段与 `src/renderer/lib/plugins/host-context.ts` 的实现各加两方法透传（`window.pier.worktrees.creationDefaults()` / `.openTerminal(request)`）。`manifest.ts` 中 `pier.worktree.create` 的 `permissions` 改为 `["worktree:read", "worktree:write"]`。

- [ ] **Step 6: 跑测试确认通过 + 回归 + Commit**

Run: `pnpm vitest run tests/unit/app-core && pnpm lint:fix && pnpm typecheck`
Expected: 全 PASS

```bash
git add src/shared/contracts/worktree.ts src/shared/contracts/commands.ts src/main/app-core/permissions.ts src/main/app-core/command-router.ts src/preload/worktree-api.ts src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts src/plugins/builtin/git/manifest.ts tests/unit/app-core/command-router.test.ts
git commit -m "feat(worktree): creationDefaults and openTerminal domain commands"
```

---

### Task 3: 面板迁入 git 插件

**Files:**
- Create: `src/plugins/builtin/git/renderer/worktree-create-overlay.tsx`
- Modify: `src/plugins/builtin/git/renderer/worktree-operation-actions.ts`（create handler 改为收集数据后打开 overlay）
- Modify: `src/plugins/builtin/git/locales/en.json`、`src/plugins/builtin/git/locales/zh-CN.json`（`messages` 加 `ui.worktreeCreate.*` 平铺键）
- Test: `tests/component/worktree-create-overlay.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `context.overlays.open/close`；Task 2 的 `context.worktrees.creationDefaults/openTerminal`；既有 `context.worktrees.list/create`、`context.git.listBranches`、`context.notifications`、`context.i18n.t`；`deriveWorktreeCreation`（`@shared/worktree-naming.ts`，不动）
- Produces:
  ```ts
  // worktree-create-overlay.tsx
  export interface WorktreeCreateOverlayData {
    branches: readonly GitBranchRef[];
    defaults: WorktreeCreationDefaults;
    existingBranches: readonly string[];
    existingNames: readonly string[];
    mainPath: string;
  }
  export function openWorktreeCreateOverlay(
    context: RendererPluginContext,
    data: WorktreeCreateOverlayData
  ): void;
  ```

- [ ] **Step 1: locale 键**

两个 JSON 的 `messages` 对象各加（zh-CN 值用 P1 核心 locale `zh-CN/worktree.ts` 的现文案，en 同理；平铺键、字母序）：

```
ui.worktreeCreate.autoBadge / baseHead / baseLabel / branchLabel / cancelHint /
createAndStartHint / createOnlyHint / creating / description / emptyHint /
inputPlaceholder / launchFailed / locationLabel / openFailed / prepareCopy /
prepareLabel / prepareNone / prepareSetup / title / unavailable
```

`launchFailed` / `openFailed` / `unavailable` / `prepareCopy` 的插值风格改为插件 i18n 的 `{{message}}` / `{{count}}`（与 `context.i18n.t(key, values, fallback)` 兼容——以 `pluginText` 现用法为准）。`commands` 对象里 `pier.worktree.create` 补 aliases（zh-CN: `["新建工作树", "创建 worktree", "xin jian gong zuo shu"]`，en: `["new worktree", "create worktree"]`），对齐现有条目风格。

- [ ] **Step 2: 写失败组件测试**

```tsx
// tests/component/worktree-create-overlay.test.tsx
// 断言语义 = P1 store 测试(worktree-create-store.test.ts @ bfcdec4)全部 8 条 + 组件交互,
// 但注入面从 window.pier 换成 mock 的 RendererPluginContext:
// 1. 输入描述 → 分支/位置实时推导展示
// 2. Enter → context.worktrees.create({branch,name,path:mainPath}) 且成功后 context.worktrees.openTerminal({path:targetPath,runSetup:true})
// 3. Shift+Enter → create 后不调 openTerminal
// 4. setWorktreeCreateBase 等价操作(选 base)→ create 载荷带 base
// 5. create 拒绝 → overlay 保留、error 文案渲染
// 6. openTerminal 拒绝 → context.notifications.error 被调、overlay 已关、不抛
// 7. esc/close → overlay 卸载
// 8. creating 态输入禁用
```

以上为行为规格清单；提交的测试必须是完整可执行断言（mock context 对象:worktrees/notifications/i18n.t 直接回 fallback/overlays 用真实 store + PluginOverlayHost 渲染）。渲染入口:`openWorktreeCreateOverlay(mockContext, data)` 后 `render(<PluginOverlayHost />)`。i18n mock:`t: (_k, values, fallback) => interpolate(fallback, values)`（简单 `{{x}}` 替换即可）。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/component/worktree-create-overlay.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 实现 overlay 组件**

`worktree-create-overlay.tsx` = P1 终态组件（`a22c03a` 的 `worktree-create-host.tsx`，样式/结构/键位照搬）+ 三处系统性替换：

1. **状态**：zustand store → 组件本地 `useState`。字段:`input`、`branch`、`branchEdited`、`baseBranch: string | null`、`error: string | null`、`creating: boolean`；`{branch, name, source}` 用 `useMemo` 对 `(input, branchEdited)` 派生（`branchEdited` 时用手改的 branch 算 name:`sanitizeWorktreeName`）。推导调 `deriveWorktreeCreation({branchPrefix: data.defaults.branchPrefix, existingBranches: data.existingBranches, existingNames: data.existingNames, input})`。
2. **副作用**：`window.pier.*` → `props.context.worktrees.*`；toast → `context.notifications.success/error`；`useT()` → 本地 `text(key, values?, fallback)` 包装 `context.i18n.t(\`ui.worktreeCreate.${key}\`, values, fallback)`（fallback 用 en 文案字面量）。
3. **提交流水线**（语义与 P1 逐条一致）：

```ts
async function submit(start: boolean): Promise<void> {
  if (creating) {
    return;
  }
  setError(null);
  setCreating(true);
  try {
    const result = await context.worktrees.create({
      ...(baseBranch ? { base: baseBranch } : {}),
      branch: derived.branch,
      name: derived.name,
      path: data.mainPath,
    });
    close();
    context.notifications.success(`${derived.branch} · ${result.targetPath}`);
    if (start) {
      try {
        await context.worktrees.openTerminal({
          path: result.targetPath,
          runSetup: true,
        });
      } catch (err) {
        context.notifications.error(
          text("launchFailed", { message: errorMessage(err) },
            "Terminal launch failed: {{message}}")
        );
      }
    }
  } catch (err) {
    setError(errorMessage(err));
    setCreating(false);
  }
}
```

文件末尾导出 opener（JSX 所以住 .tsx）：

```tsx
export function openWorktreeCreateOverlay(
  context: RendererPluginContext,
  data: WorktreeCreateOverlayData
): void {
  context.overlays.open({
    id: "worktree-create",
    render: ({ close }) => (
      <WorktreeCreateOverlay close={close} context={context} data={data} />
    ),
  });
}
```

Blocking 三件套**不要**在组件里做——Task 1 的 host 已统一承担；组件顶层直接渲染 `<Dialog open onOpenChange={(open) => { if (!open) close(); }}>`，内容与 `a22c03a` 版一致。

- [ ] **Step 5: action handler 接线**

`worktree-operation-actions.ts` 的 `registerWorktreeCreateAction` handler 改为：

```ts
    handler: async () => {
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      try {
        const listResult = await context.worktrees.list({ path: target.path });
        if (listResult.status !== "available") {
          context.notifications.error(
            pluginText(context, "worktreeCreate.unavailable",
              "Worktrees are unavailable: {{message}}",
              { message: listResult.reason })
          );
          return;
        }
        const [branches, defaults] = await Promise.all([
          context.git.listBranches(listResult.mainPath, { kind: "all" }),
          context.worktrees.creationDefaults(),
        ]);
        openWorktreeCreateOverlay(context, {
          branches,
          defaults,
          existingBranches: branches.map((ref) => ref.name),
          existingNames: listResult.worktrees.map((item) =>
            basename(item.path)
          ),
          mainPath: listResult.mainPath,
        });
      } catch (err) {
        context.notifications.error(
          pluginText(context, "worktreeCreate.openFailed",
            "Couldn't open worktree creation: {{message}}",
            { message: errorMessage(err) })
        );
      }
    },
```

（`basename` / `errorMessage` / `pluginText` 该文件已有。删除对 `context.worktrees.openCreatePanel` 的调用——API 本体 Task 4 再删。）

- [ ] **Step 6: 跑测试确认通过 + Commit**

Run: `pnpm vitest run tests/component/worktree-create-overlay.test.tsx tests/unit/renderer/git-plugin.test.tsx && pnpm lint:fix && pnpm typecheck`
Expected: overlay 测试 PASS；`git-plugin.test.tsx` 的 create 用例可能因 handler 改动而 FAIL——若 FAIL,按新流程改断言（mock context 后断言 `overlays.open` 被调且 id 为 `worktree-create`），一并提交。

```bash
git add src/plugins/builtin/git/renderer/worktree-create-overlay.tsx src/plugins/builtin/git/renderer/worktree-operation-actions.ts src/plugins/builtin/git/locales/en.json src/plugins/builtin/git/locales/zh-CN.json tests/component/worktree-create-overlay.test.tsx tests/unit/renderer/git-plugin.test.tsx
git commit -m "feat(git): worktree create panel lives in the git plugin"
```

---

### Task 4: 删除核心面板与桥,「+」菜单走 actionRegistry

**Files:**
- Delete: `src/renderer/components/common/worktree-create-host.tsx`、`src/renderer/stores/worktree-create.store.ts`、`src/renderer/i18n/locales/en/worktree.ts`、`src/renderer/i18n/locales/zh-CN/worktree.ts`、`tests/component/worktree-create-host.test.tsx`、`tests/unit/renderer/stores/worktree-create-store.test.ts`
- Modify: `src/renderer/i18n/locales/en/index.ts`、`zh-CN/index.ts`（去注册）；`src/renderer/components/common/app-shell.tsx`（去 `WorktreeCreateHost`）
- Modify: `src/plugins/api/renderer.ts` + `src/renderer/lib/plugins/host-context.ts`（删 `worktrees.openCreatePanel`）
- Modify: `src/preload/index.ts` + `src/shared/contracts/terminal.ts`（删 `terminal.open` 透传与接口成员——先 grep 确认无其它调用方）
- Modify: `src/renderer/components/workspace/add-panel-action.tsx`
- Test: `tests/component/workspace-header-actions.test.tsx`（改写 New Worktree 用例）

**Interfaces:**
- Consumes: `actionRegistry`（`src/renderer/lib/actions/registry.ts`——`get(id)` 返回 `Action | undefined`，`Action` 有 `handler()` / `enabled?()` / `disabledReason?()`）
- Produces: 无新接口（纯删除与改接线）

- [ ] **Step 1: 「+」菜单改写**

`add-panel-action.tsx` 的 New Worktree 项替换为（删 `usePanelDescriptorStore` / `openWorktreeCreatePanel` 相关 import 与 hook；import `actionRegistry`）：

```tsx
const WORKTREE_CREATE_ACTION_ID = "pier.worktree.create";
```

```tsx
          {(() => {
            const action = actionRegistry.get(WORKTREE_CREATE_ACTION_ID);
            const enabled = Boolean(action && (action.enabled?.() ?? true));
            return (
              <DropdownMenuItem
                disabled={!enabled}
                onClick={() => {
                  void actionRegistry
                    .get(WORKTREE_CREATE_ACTION_ID)
                    ?.handler();
                }}
              >
                <GitBranchPlus className="size-4" />
                <span>{t("workspace.addPanelMenu.newWorktree")}</span>
              </DropdownMenuItem>
            );
          })()}
```

（Dropdown 内容每次打开时重新 mount,`enabled()` 在渲染时求值即可,无需订阅 registry。若 Biome 不接受 IIFE,提成组件内局部变量。`workspace.addPanelMenu.newWorktree` i18n 键保留不动。）

- [ ] **Step 2: 改写入口测试**

`workspace-header-actions.test.tsx` 的三个 New Worktree 用例改为 actionRegistry 语义：beforeEach 里 `actionRegistry.register({ id: "pier.worktree.create", category: "Worktree", title: () => "Create Worktree", enabled: enabledMock, handler: handlerMock, surfaces: ["command-palette"] })`（保存 disposer,afterEach 清理）；断言:enabledMock 返回 true 时点击调用 handlerMock；返回 false 时菜单项 `aria-disabled`；未注册 action 时菜单项禁用。原来对 store session 的断言删除。`Action` 类型字段以 `src/renderer/lib/actions/types.ts` 为准。

- [ ] **Step 3: 删除清单执行**

按 Files 节删文件、去挂载、去注册、删 API 成员。执行前 grep 确认：

```bash
grep -rn "worktree-create.store\|WorktreeCreateHost\|openCreatePanel" src tests
grep -rn "terminal.open(" src/renderer src/plugins   # 确认 preload terminal.open 无调用方
grep -rn "worktree\.create\.\|worktree:" src/renderer/i18n  # 确认核心 locale 键无残留引用
```

Expected: 除本任务将删/改的文件外零命中,否则先处理命中点。

- [ ] **Step 4: 全量验证 + Commit**

Run: `pnpm vitest run tests/component tests/unit && pnpm lint:fix && pnpm typecheck && pnpm check`
Expected: 全 PASS（`pnpm check` 的 depcruise 验证插件不再被核心 import、核心不再被插件绕过）

```bash
git add -A src/renderer/components/common/worktree-create-host.tsx src/renderer/stores/worktree-create.store.ts src/renderer/i18n/locales/en/worktree.ts src/renderer/i18n/locales/zh-CN/worktree.ts src/renderer/i18n/locales/en/index.ts src/renderer/i18n/locales/zh-CN/index.ts src/renderer/components/common/app-shell.tsx src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts src/preload/index.ts src/shared/contracts/terminal.ts src/renderer/components/workspace/add-panel-action.tsx tests/component/workspace-header-actions.test.tsx tests/component/worktree-create-host.test.tsx tests/unit/renderer/stores/worktree-create-store.test.ts
git commit -m "refactor(worktree): drop core create panel in favor of git plugin overlay"
```

（`git add -A <path>` 仅对列出的路径生效,可正确 stage 删除;不是 `git add .`。）

---

### Task 5: 全量验证 + 阶段终审

- [ ] **Step 1: 全量检查**

Run: `pnpm check && pnpm test:unit && pnpm test:component`
Expected: 全 PASS

- [ ] **Step 2: 阶段 whole-branch review**

对 `a22c03a..HEAD` 跑终审（重点:「setup 命令只来自偏好」不变式、overlay 原语无越权、删除是否干净、交互与 `a22c03a` 一致性）。发现 Critical/Important 派修复,复审通过为止。

- [ ] **Step 3: 手动验收**

`pnpm dev` 后同 P1 六项清单再过一遍（入口、推导、Enter 全流程、copy-files、⇧⏎/esc、错误路径),外加:插件禁用时（设置里关 git 插件）「+」菜单项应禁用、面板不可打开。结果逐条回报用户。
