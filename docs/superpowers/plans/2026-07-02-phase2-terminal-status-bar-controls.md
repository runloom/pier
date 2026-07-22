# Phase 2 — 终端状态栏：左右分组 + 用户显隐/排序覆盖 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

日期：2026-07-02
对应设计文档：`docs/superpowers/specs/2026-07-02-plugin-configuration-and-statusbar-design.md` §3.3（主体）、§3.0（前置依赖）、§4、§5、§6
前置依赖：**Phase 0 已定稿并合入**（见「依赖声明」一节）

---

**Goal**：终端状态栏项支持 manifest 声明的左右分组（`alignment`）与排序（`order`），叠加用户级覆盖（显隐 / 换组 / 重排），覆盖持久化在 main L1 JSON store，经 PierCommand envelope IPC + 广播镜像到 renderer；提供状态栏右键菜单与设置对话框「终端 → 状态栏」管理块两个交互入口。

**Architecture**：

```
manifest（唯一声明源：alignment/order）
        │  plugin-registry.store（Phase 0 镜像）
        ▼
terminal-status-bar-prefs.json（main L1，DebouncedJsonStore + ensureStore）
        │  PierCommand envelope: getAll / setItemOverride / resetItem
        │  PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED（全量快照）
        ▼
useTerminalStatusBarPrefsStore（renderer 镜像）
        │
        ▼
mergeTerminalStatusItems（纯函数：覆盖 ?? manifest ?? 默认 → hidden 过滤 → 分组排序）
        │
        ▼
useTerminalStatusBarItems（组件层 hook：registry × plugin-registry.store × prefs store）
        │
        ▼
TerminalStatusBar 渲染：[左组] ←flex-1 spacer→ [右组]
交互入口：状态栏右键原生菜单（checkbox 显隐 + 管理入口）／设置页「状态栏」子块
```

**关键取舍 — 右键菜单走原生 `window.pier.menu.popup` 而非 `@pier/ui` Radix ContextMenu**：终端面板主体是原生 WebContentsView，层级恒在 base web content 之上；状态栏位于面板底部，web popover 向上展开会被原生视图遮挡（settings 对话框需要 `registerTerminalFullscreenWebOverlay` 上报矩形才能盖住原生面，为一个小菜单引入该机制不成比例）。项目内终端面板既有右键（`src/renderer/lib/context-menu/use-context-menu.ts` → `pier:menu:popup`）就是原生菜单通道。为支持勾选显隐，本计划给 menu 契约补 `checkbox` 项类型（Electron 原生支持）。

**Tech Stack**：Electron 42 · React 19 · TypeScript 6 strict · Zustand 5 · Zod · electron-vite 5 · Vitest 4 · Biome 2.5 + Ultracite · pnpm 10

---

## Global Constraints

- **TypeScript strict**：禁止 `@ts-ignore`、`@ts-expect-error`、`as any`（AGENTS.md §05）。测试中对 `window.pier` 的部分桩沿用项目既有先例（`Object.defineProperty(window, "pier", { value: {...} })`，见 `tests/unit/renderer/stores/theme-store-native-chrome.test.ts:15-25`）。
- **Biome 2.5 + Ultracite**：每个 task 结束前跑 `pnpm lint`，不合规先 `pnpm lint:fix`。
- **depcruise 边界**（`dependency-cruiser.config.cjs`）：
  - `main/` ⊥ `renderer/` 双向禁止；`preload/` 只可 import `shared/` + `electron`；main 内 L1 ⊥ L2/L3/L4。
  - renderer panel-kits 不跨域 import 其它 panel-kit（`renderer-panels-not-cross-domain` 规则只限 panel-kit → 其它 panel-kit）；**panel-kits import `src/renderer/stores/` 合规**（host-context 已有先例）；pages → panel-kits 合规（`main.tsx` 已 import `panel-kits/terminal/register-actions.ts`）。
  - `src/plugins` 不 import main/renderer。
- **文件行数**：`pnpm check:file-size` 300 行警告、500 行硬上限。`src/preload/index.ts` 现为 464 行——新 preload API **必须**放独立文件（照 `git-api.ts` 先例）。
- **Git 规则（AGENTS.md §05）**：默认只读。每个 task 的 commit 步骤 = 只 stage 明确路径（**禁 `git add .`**）→ 展示 `git diff --staged` 与拟用 Conventional Commits message → **等待用户确认后**才 `git commit`。禁 `git reset` / `git rebase` / `--amend` / force-push。
- **每 task 结束跑 `pnpm check`**（typecheck + lint + depcruise + file-size）与 `pnpm test:unit`。
- 纯函数（schema、override patch、合并、归一化排序）**必须 TDD**：先写失败测试→跑出失败→最小实现→跑通过。
- UI / 右键菜单步骤附 `pnpm dev` 人工验证清单（真实 OS 交互；焦点类行为不用合成事件断言——见项目 MEMORY「Pier 真实输入调试实验方法」）。新 worktree 首次先 `pnpm setup:worktree`。

---

## 依赖声明 — Phase 0 产物（本计划 Consumes，假定已存在）

| 接口 | 位置 | 签名 |
| --- | --- | --- |
| `usePluginRegistryStore` | `src/renderer/stores/plugin-registry.store.ts` | Zustand store，state `{ plugins: PluginRegistryEntry[]; diagnostics; initialized: boolean; error }`，action `refresh(): Promise<void>` |
| `PIER_BROADCAST.PLUGINS_CHANGED` | `src/shared/ipc-channels.ts` | `"pier://plugins:changed"`，payload 为 `PluginRegistryListResult` 全量快照 |
| `window.pier.plugins.onChanged(cb)` | `src/preload/index.ts` | 订阅上述广播，返回解绑函数 |

本计划只读取 `plugins` 与（间接依赖其响应性），不调用 `refresh`；`initialized === false` 时合并管道自然退化为「无 manifest 声明 → 全默认值」，不需要特殊分支。

## 全计划统一语义（写死，各 task 引用）

1. **生效值合并链**：`用户覆盖 ?? manifest 声明 ?? 默认`。默认：`alignment: "left"`、`order: 0`、可见（`hidden: false`）。`hidden` 只有用户覆盖来源（manifest 不声明 hidden）。
2. **order 语义**：同侧内 **order 越小越靠外侧**——left 组 order 小 → 靠左；right 组 order 小 → 靠右。同 order 按 id 字典序（`localeCompare`），字典序小者更靠外侧。
3. **DOM 渲染序约定**：合并函数返回的 `left` / `right` 数组都是 DOM 从左到右顺序。`left` = 外侧优先升序原样；`right` = 外侧优先升序后 **reverse**（order 最小项落在 DOM 最右 = 右组最外侧）。
4. **覆盖存储原则**：只存用户显式覆盖；`setItemOverride(itemId, override)` **整体替换**该 item 的覆盖记录（renderer 侧负责用 patch 语义合成完整 override）；覆盖对象为空 ⇔ 删除该 key（等价 `resetItem`）。指向已卸载/禁用插件的覆盖**保留不清理**，UI 只展示当前已启用插件的项（spec §5）。
5. **`isVisible` 动态可见性**保留，在 hidden 过滤**之后**、组件层执行。

---

## Task 1 — 共享契约：manifest 字段 + prefs schema + override patch 纯函数（TDD）

**Files:**

- Modify: `src/shared/contracts/plugin.ts`（`pluginTerminalStatusItemContributionSchema`，现第 77-85 行）
- Create: `src/shared/contracts/terminal-status-bar.ts`
- Test: `tests/unit/shared/terminal-status-bar-contract.test.ts`（新建）

**Interfaces:**

- Consumes: `pierCapabilitySchema`（`src/shared/contracts/permissions.ts`，plugin.ts 既有 import）
- Produces:
  - `terminalStatusItemAlignmentSchema: z.ZodEnum<["left","right"]>`、`type TerminalStatusItemAlignment`
  - `pluginTerminalStatusItemContributionSchema` 增加 `alignment?: "left"|"right"`、`order?: number`（`PluginTerminalStatusItemContribution` 类型随 infer 更新）
  - `terminalStatusBarItemOverrideSchema`、`type TerminalStatusBarItemOverride = { alignment?; hidden?; order? }`
  - `terminalStatusBarPrefsSchema`、`type TerminalStatusBarPrefs = { items: Record<string, TerminalStatusBarItemOverride>; version: 1 }`
  - `emptyTerminalStatusBarPrefs(): TerminalStatusBarPrefs`
  - `type TerminalStatusBarItemOverridePatch = { alignment?: "left"|"right"|null; hidden?: boolean|null; order?: number|null }`
  - `withItemOverridePatch(current: TerminalStatusBarItemOverride | undefined, patch: TerminalStatusBarItemOverridePatch): TerminalStatusBarItemOverride | null`

**Steps:**

- [ ] 写失败测试 `tests/unit/shared/terminal-status-bar-contract.test.ts`（完整内容）：

```ts
import {
  type PluginTerminalStatusItemContribution,
  pluginTerminalStatusItemContributionSchema,
} from "@shared/contracts/plugin.ts";
import {
  emptyTerminalStatusBarPrefs,
  terminalStatusBarItemOverrideSchema,
  terminalStatusBarPrefsSchema,
  withItemOverridePatch,
} from "@shared/contracts/terminal-status-bar.ts";
import { describe, expect, it } from "vitest";

describe("pluginTerminalStatusItemContributionSchema — alignment/order", () => {
  it("alignment 与 order 可选,缺省不注入默认值(默认语义由合并层给)", () => {
    const parsed = pluginTerminalStatusItemContributionSchema.parse({
      id: "pier.worktree.status",
      title: "Worktree Status",
    });
    expect(parsed.alignment).toBeUndefined();
    expect(parsed.order).toBeUndefined();
  });

  it("接受合法 alignment/order", () => {
    const parsed: PluginTerminalStatusItemContribution =
      pluginTerminalStatusItemContributionSchema.parse({
        alignment: "right",
        id: "a.b",
        order: 10,
        title: "X",
      });
    expect(parsed.alignment).toBe("right");
    expect(parsed.order).toBe(10);
  });

  it("拒绝非法 alignment", () => {
    expect(() =>
      pluginTerminalStatusItemContributionSchema.parse({
        alignment: "center",
        id: "a.b",
        title: "X",
      })
    ).toThrow();
  });

  it("拒绝非数字 order", () => {
    expect(() =>
      pluginTerminalStatusItemContributionSchema.parse({
        id: "a.b",
        order: "10",
        title: "X",
      })
    ).toThrow();
  });
});

describe("terminalStatusBarPrefsSchema", () => {
  it("接受空 prefs 与完整覆盖", () => {
    expect(terminalStatusBarPrefsSchema.parse({ items: {}, version: 1 }))
      .toEqual(emptyTerminalStatusBarPrefs());
    const full = {
      items: {
        "pier.worktree.status": {
          alignment: "right" as const,
          hidden: true,
          order: -5,
        },
      },
      version: 1 as const,
    };
    expect(terminalStatusBarPrefsSchema.parse(full)).toEqual(full);
  });

  it("拒绝错误 version 与非法字段值", () => {
    expect(() =>
      terminalStatusBarPrefsSchema.parse({ items: {}, version: 2 })
    ).toThrow();
    expect(() =>
      terminalStatusBarItemOverrideSchema.parse({ hidden: "yes" })
    ).toThrow();
  });
});

describe("withItemOverridePatch", () => {
  it("值 → 设置;缺省 → 保留现值", () => {
    expect(withItemOverridePatch({ hidden: true }, { order: 20 })).toEqual({
      hidden: true,
      order: 20,
    });
  });

  it("null → 清除该字段", () => {
    expect(
      withItemOverridePatch({ hidden: true, order: 20 }, { hidden: null })
    ).toEqual({ order: 20 });
  });

  it("全部字段清空时返回 null(调用方改走 resetItem)", () => {
    expect(withItemOverridePatch({ hidden: true }, { hidden: null })).toBeNull();
    expect(withItemOverridePatch(undefined, {})).toBeNull();
  });

  it("current 为 undefined 时从空覆盖合成", () => {
    expect(withItemOverridePatch(undefined, { alignment: "right" })).toEqual({
      alignment: "right",
    });
  });
});
```

- [ ] 跑 `pnpm test:unit tests/unit/shared/terminal-status-bar-contract.test.ts`，预期失败：`Failed to resolve import "@shared/contracts/terminal-status-bar.ts"`（模块不存在）。
- [ ] 修改 `src/shared/contracts/plugin.ts`：将第 77-85 行的 `pluginTerminalStatusItemContributionSchema` 替换为（并在其上方新增 alignment schema 导出）：

```ts
export const terminalStatusItemAlignmentSchema = z.enum(["left", "right"]);
export type TerminalStatusItemAlignment = z.infer<
  typeof terminalStatusItemAlignmentSchema
>;

export const pluginTerminalStatusItemContributionSchema = z.object({
  /**
   * 状态栏左右分组,缺省 "left"。与 order 的组合语义(设计文档 §3.3,勿改):
   * 同侧内 order 越小越靠外侧 —— left 组 order 小 → 靠左;right 组 order 小 → 靠右。
   * 同 order 按 id 字典序,字典序小者更靠外侧。
   * 默认值不在 schema 注入,统一由 renderer 合并层给(用户覆盖 ?? manifest ?? 默认)。
   */
  alignment: terminalStatusItemAlignmentSchema.optional(),
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  /** 同侧排序权重,缺省 0。语义见 alignment 注释。 */
  order: z.number().optional(),
  permissions: z.array(pierCapabilitySchema).default([]),
  title: z.string().min(1),
});
export type PluginTerminalStatusItemContribution = z.infer<
  typeof pluginTerminalStatusItemContributionSchema
>;
```

- [ ] 新建 `src/shared/contracts/terminal-status-bar.ts`（完整内容）：

```ts
/**
 * 终端状态栏用户覆盖契约 — main L1 terminal-status-bar-prefs.json、PierCommand
 * envelope 与 renderer 镜像 store 共用。
 *
 * 生效值合并链固定为:用户覆盖 ?? manifest 声明 ?? 默认(alignment "left"、
 * order 0、可见)。只存用户显式覆盖过的值;「恢复默认」= 删除该 itemId 的 key。
 */
import { z } from "zod";
import { terminalStatusItemAlignmentSchema } from "./plugin.ts";

export const terminalStatusBarItemOverrideSchema = z.object({
  alignment: terminalStatusItemAlignmentSchema.optional(),
  hidden: z.boolean().optional(),
  order: z.number().optional(),
});
export type TerminalStatusBarItemOverride = z.infer<
  typeof terminalStatusBarItemOverrideSchema
>;

export const terminalStatusBarPrefsSchema = z.object({
  items: z.record(z.string().min(1), terminalStatusBarItemOverrideSchema),
  version: z.literal(1),
});
export type TerminalStatusBarPrefs = z.infer<
  typeof terminalStatusBarPrefsSchema
>;

export function emptyTerminalStatusBarPrefs(): TerminalStatusBarPrefs {
  return { items: {}, version: 1 };
}

/** patch 字段语义:值 → 设置;null → 清除该字段;缺省 → 保留现值。 */
export interface TerminalStatusBarItemOverridePatch {
  alignment?: "left" | "right" | null;
  hidden?: boolean | null;
  order?: number | null;
}

/**
 * 以 patch 合成下一个 override。全部字段清空时返回 null —— 调用方应改走
 * resetItem(从 items 删除该 key),与「只存显式覆盖」的存储原则一致。
 */
export function withItemOverridePatch(
  current: TerminalStatusBarItemOverride | undefined,
  patch: TerminalStatusBarItemOverridePatch
): TerminalStatusBarItemOverride | null {
  const alignment =
    "alignment" in patch ? patch.alignment : current?.alignment;
  const hidden = "hidden" in patch ? patch.hidden : current?.hidden;
  const order = "order" in patch ? patch.order : current?.order;
  const next: TerminalStatusBarItemOverride = {};
  if (alignment !== null && alignment !== undefined) {
    next.alignment = alignment;
  }
  if (hidden !== null && hidden !== undefined) {
    next.hidden = hidden;
  }
  if (order !== null && order !== undefined) {
    next.order = order;
  }
  return Object.keys(next).length > 0 ? next : null;
}
```

- [ ] 跑 `pnpm test:unit tests/unit/shared/terminal-status-bar-contract.test.ts`，预期全绿。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`（全量，确认 plugin schema 变更无回归）。
- [ ] Commit：stage `src/shared/contracts/plugin.ts src/shared/contracts/terminal-status-bar.ts tests/unit/shared/terminal-status-bar-contract.test.ts`，展示 `git diff --staged` 与 message `feat(plugin): terminal status item alignment/order manifest fields + status bar prefs contract`，等用户确认后提交。

---

## Task 2 — 注册对象去 order + git 插件迁移到 manifest 声明

**Files:**

- Modify: `src/plugins/api/renderer.ts`（`RendererTerminalStatusItem` 第 114-119 行，删除第 117 行 `order?: number;`）
- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`（`list()` 第 24-28 行）
- Modify: `src/plugins/builtin/git/manifest.ts`（`terminalStatusItems` 第 119-125 行，加 `order: 10`）
- Modify: `src/plugins/builtin/git/renderer/git-status-item.tsx`（删除第 295 行 `order: 10,`）
- Test: `tests/unit/renderer/terminal-status-items.test.tsx`（去掉 `order:` 字段）、`tests/unit/renderer/plugin-host-context.test.tsx`（第 131 行 `order: 20,` 删除）

**Interfaces:**

- Produces: `RendererTerminalStatusItem = { id: string; isVisible?: (context) => boolean; render: (context) => ReactNode }`（无 order）；`terminalStatusItemRegistry.list()` 稳定按 id 字典序输出（呈现顺序改由合并层决定，Task 7/8）。
- Consumes: Task 1 的 manifest `order` 字段。

**Steps:**

- [ ] `src/plugins/api/renderer.ts`：删除 `RendererTerminalStatusItem` 中的 `order?: number;` 一行。
- [ ] `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`：`list()` 改为——

```ts
  list(): readonly TerminalStatusItem[] {
    // 运行时注册对象不再承载排序;稳定输出按 id,呈现顺序由合并层
    // (manifest 声明 + 用户覆盖,见 terminal-status-bar-merge.ts)决定。
    return Array.from(this.items.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }
```

- [ ] `src/plugins/builtin/git/manifest.ts`：`terminalStatusItems` 迁入原运行时 `order: 10`——

```ts
  terminalStatusItems: [
    {
      id: "pier.worktree.status",
      order: 10,
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree Status",
    },
  ],
```

- [ ] `src/plugins/builtin/git/renderer/git-status-item.tsx`：删除 `registerGitStatusItem` 注册对象中的 `order: 10,` 行（原第 295 行）。
- [ ] 跑 `pnpm typecheck`，预期两个测试文件报错（对象字面量多余属性 `order`）：`tests/unit/renderer/terminal-status-items.test.tsx`、`tests/unit/renderer/plugin-host-context.test.tsx:131`。
- [ ] 更新测试：`plugin-host-context.test.tsx` 删除第 131 行 `order: 20,`；`terminal-status-items.test.tsx` 删除所有 `order: 10,` / `order: 20,` 行（现状注册 id 为 `test.first` / `test.second`，id 字典序即原断言顺序 `FirstSecond`，断言不变）。
- [ ] 跑 `pnpm test:unit tests/unit/renderer/terminal-status-items.test.tsx tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/git-plugin.test.tsx`，预期全绿。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] Commit：stage `src/plugins/api/renderer.ts src/renderer/panel-kits/terminal/terminal-status-bar.tsx src/plugins/builtin/git/manifest.ts src/plugins/builtin/git/renderer/git-status-item.tsx tests/unit/renderer/terminal-status-items.test.tsx tests/unit/renderer/plugin-host-context.test.tsx`，message `refactor(plugin): move terminal status item order from runtime registration to manifest`，等用户确认后提交。

---

## Task 3 — main L1 store `terminal-status-bar-prefs.ts` + 退出 flush 链（TDD）

**Files:**

- Create: `src/main/state/terminal-status-bar-prefs.ts`
- Modify: `src/main/services/window-service.ts`（import 区 + 第 48-53 行 `flushWindowBeforeClose` 的 `Promise.all` + 第 136-140 行 `flushOpenWindows` 的 `Promise.all`）
- Test: `tests/unit/main/terminal-status-bar-prefs.test.ts`（新建）

**Interfaces:**

- Consumes: `debouncedJsonStore` / `DebouncedJsonStore`（`src/main/state/debounced-store.ts`）；Task 1 契约。
- Produces:
  - `createTerminalStatusBarPrefsStore(filePath: string): TerminalStatusBarPrefsStore`（测试注入 filePath）
  - `interface TerminalStatusBarPrefsStore { flush(): Promise<void>; getAll(): Promise<TerminalStatusBarPrefs>; resetItem(itemId: string): Promise<TerminalStatusBarPrefs>; setItemOverride(itemId: string, override: TerminalStatusBarItemOverride): Promise<TerminalStatusBarPrefs> }`
  - 默认单例包装：`readTerminalStatusBarPrefs()` / `setTerminalStatusBarItemOverride(itemId, override)` / `resetTerminalStatusBarItem(itemId)` / `flushTerminalStatusBarPrefs()`（`userData/terminal-status-bar-prefs.json`）

**Steps:**

- [ ] 写失败测试 `tests/unit/main/terminal-status-bar-prefs.test.ts`（完整内容；electron 仅默认单例路径解析用到，工厂注入 filePath 后不触电——顶部仍 mock electron 防意外解析，沿用 `tests/unit/main/terminal-session-state.test.ts` 的方式）：

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalStatusBarPrefsStore } from "@main/state/terminal-status-bar-prefs.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error("default store path must not be resolved in tests");
    }),
  },
}));

const tempDirs: string[] = [];

async function prefsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-status-bar-prefs-"));
  tempDirs.push(dir);
  return join(dir, "terminal-status-bar-prefs.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("terminal status bar prefs store", () => {
  it("文件不存在时返回空默认值", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await expect(store.getAll()).resolves.toEqual({ items: {}, version: 1 });
  });

  it("setItemOverride / resetItem 往返并落盘持久化", async () => {
    const filePath = await prefsFile();
    const store = createTerminalStatusBarPrefsStore(filePath);

    await expect(
      store.setItemOverride("pier.worktree.status", {
        alignment: "right",
        hidden: true,
      })
    ).resolves.toEqual({
      items: {
        "pier.worktree.status": { alignment: "right", hidden: true },
      },
      version: 1,
    });
    await store.flush();

    // 新实例从磁盘读回
    const reloaded = createTerminalStatusBarPrefsStore(filePath);
    await expect(reloaded.getAll()).resolves.toEqual({
      items: {
        "pier.worktree.status": { alignment: "right", hidden: true },
      },
      version: 1,
    });

    await expect(
      reloaded.resetItem("pier.worktree.status")
    ).resolves.toEqual({ items: {}, version: 1 });
    await reloaded.flush();
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      items: {},
      version: 1,
    });
  });

  it("resetItem 不存在的 key 是幂等 no-op", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await expect(store.resetItem("nope")).resolves.toEqual({
      items: {},
      version: 1,
    });
  });

  it("空 override 等价 resetItem(不存空对象)", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    await store.setItemOverride("a.b", { hidden: true });
    await expect(store.setItemOverride("a.b", {})).resolves.toEqual({
      items: {},
      version: 1,
    });
  });

  it("损坏 JSON / schema 不合法时重置为默认值", async () => {
    const corrupt = await prefsFile();
    await writeFile(corrupt, "{ not json", "utf8");
    const store = createTerminalStatusBarPrefsStore(corrupt);
    await expect(store.getAll()).resolves.toEqual({ items: {}, version: 1 });

    const badVersion = await prefsFile();
    await writeFile(
      badVersion,
      `${JSON.stringify({ items: {}, version: 99 })}\n`,
      "utf8"
    );
    const store2 = createTerminalStatusBarPrefsStore(badVersion);
    await expect(store2.getAll()).resolves.toEqual({ items: {}, version: 1 });
  });

  it("setItemOverride 拒绝 schema 非法的 override", async () => {
    const store = createTerminalStatusBarPrefsStore(await prefsFile());
    // 经 JSON.parse 构造运行时非法值,走 zod 校验路径;
    // as 到具体类型是常规窄化,不用 @ts 抑制指令、不用 as any。
    const invalid = JSON.parse(
      '{"alignment":"center"}'
    ) as TerminalStatusBarItemOverride;
    await expect(store.setItemOverride("a.b", invalid)).rejects.toThrow();
  });
});
```

  注：最后一个用例需在测试文件顶部补 `import type { TerminalStatusBarItemOverride } from "@shared/contracts/terminal-status-bar.ts";`。
- [ ] 跑 `pnpm test:unit tests/unit/main/terminal-status-bar-prefs.test.ts`，预期失败：`Failed to resolve import "@main/state/terminal-status-bar-prefs.ts"`。
- [ ] 新建 `src/main/state/terminal-status-bar-prefs.ts`（完整内容；ensureStore 包装照抄 `plugin-state.ts:34-48`）：

```ts
import { join } from "node:path";
import {
  emptyTerminalStatusBarPrefs,
  type TerminalStatusBarItemOverride,
  type TerminalStatusBarPrefs,
  terminalStatusBarItemOverrideSchema,
  terminalStatusBarPrefsSchema,
} from "@shared/contracts/terminal-status-bar.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export interface TerminalStatusBarPrefsStore {
  flush(): Promise<void>;
  getAll(): Promise<TerminalStatusBarPrefs>;
  resetItem(itemId: string): Promise<TerminalStatusBarPrefs>;
  setItemOverride(
    itemId: string,
    override: TerminalStatusBarItemOverride
  ): Promise<TerminalStatusBarPrefs>;
}

function removeItem(
  state: TerminalStatusBarPrefs,
  itemId: string
): TerminalStatusBarPrefs {
  if (!(itemId in state.items)) {
    return state;
  }
  const { [itemId]: _removed, ...items } = state.items;
  return { ...state, items };
}

/**
 * 工厂按 filePath 建 store —— 单测直接注入临时路径;生产走下方默认单例
 * (userData/terminal-status-bar-prefs.json)。ensureStore 包装照抄
 * plugin-state.ts:zod 校验,损坏/不合法即重置默认。
 */
export function createTerminalStatusBarPrefsStore(
  filePath: string
): TerminalStatusBarPrefsStore {
  let store: DebouncedJsonStore<TerminalStatusBarPrefs> | undefined;

  function getStore(): DebouncedJsonStore<TerminalStatusBarPrefs> {
    if (!store) {
      store = debouncedJsonStore<TerminalStatusBarPrefs>({
        debounceMs: 500,
        defaults: emptyTerminalStatusBarPrefs(),
        filePath,
      });
    }
    return store;
  }

  async function ensureStore(): Promise<
    DebouncedJsonStore<TerminalStatusBarPrefs>
  > {
    const s = getStore();
    try {
      const raw = await s.init();
      const parsed = terminalStatusBarPrefsSchema.parse(raw);
      if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
        s.replace(parsed);
      }
    } catch (err) {
      console.warn(
        "[terminal-status-bar-prefs] parse failed, resetting to defaults:",
        err
      );
      await s.clear();
      await s.init();
    }
    return s;
  }

  return {
    flush: async () => {
      const s = await ensureStore();
      await s.flush();
    },
    getAll: async () => {
      const s = await ensureStore();
      return structuredClone(s.get());
    },
    resetItem: async (itemId) => {
      const s = await ensureStore();
      return structuredClone(s.mutate((state) => removeItem(state, itemId)));
    },
    setItemOverride: async (itemId, override) => {
      const parsed = terminalStatusBarItemOverrideSchema.parse(override);
      const s = await ensureStore();
      const isEmpty =
        parsed.alignment === undefined &&
        parsed.hidden === undefined &&
        parsed.order === undefined;
      return structuredClone(
        s.mutate((state) =>
          isEmpty
            ? removeItem(state, itemId)
            : { ...state, items: { ...state.items, [itemId]: parsed } }
        )
      );
    },
  };
}

let defaultStore: TerminalStatusBarPrefsStore | undefined;

function getDefaultStore(): TerminalStatusBarPrefsStore {
  if (!defaultStore) {
    defaultStore = createTerminalStatusBarPrefsStore(
      join(app.getPath("userData"), "terminal-status-bar-prefs.json")
    );
  }
  return defaultStore;
}

export function readTerminalStatusBarPrefs(): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().getAll();
}

export function setTerminalStatusBarItemOverride(
  itemId: string,
  override: TerminalStatusBarItemOverride
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().setItemOverride(itemId, override);
}

export function resetTerminalStatusBarItem(
  itemId: string
): Promise<TerminalStatusBarPrefs> {
  return getDefaultStore().resetItem(itemId);
}

export function flushTerminalStatusBarPrefs(): Promise<void> {
  return getDefaultStore().flush();
}
```

- [ ] 跑 `pnpm test:unit tests/unit/main/terminal-status-bar-prefs.test.ts`，预期全绿。
- [ ] `src/main/services/window-service.ts`：import 区加 `import { flushTerminalStatusBarPrefs } from "../state/terminal-status-bar-prefs.ts";`；两处 `Promise.all`（第 48-53 行与第 136-140 行）都追加一项：

```ts
  await Promise.all([
    flushPluginState(),
    flushTerminalSessionState(),
    flushTerminalStatusBarPrefs(),
    flushWindowRecordState(),
  ]);
```

- [ ] 跑 `pnpm test:unit tests/unit/main/window-service.test.ts`（既有退出 flush 链测试无回归），再跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] Commit：stage `src/main/state/terminal-status-bar-prefs.ts src/main/services/window-service.ts tests/unit/main/terminal-status-bar-prefs.test.ts`，message `feat(main): terminal status bar prefs L1 store with exit flush`，等用户确认后提交。

---

## Task 4 — PierCommand envelope 三命令 + 广播通道 + main 接线

**Files:**

- Modify: `src/shared/contracts/commands.ts`（`pierCommandSchema` discriminatedUnion，在 `plugin.*` 条目——现第 171-180 行——之后插入）
- Modify: `src/shared/ipc-channels.ts`（`PIER_BROADCAST` 第 23-43 行）
- Modify: `src/main/app-core/permissions.ts`（`REQUIRED_CAPABILITIES_BY_COMMAND` 第 9-81 行）
- Modify: `src/main/ipc/command.ts`（`RENDERER_FACADE_COMMAND_TYPES` 第 10-57 行）
- Modify: `src/main/app-core/command-router-services.ts`（`PierCoreServices`）
- Modify: `src/main/app-core/command-router.ts`（`executeAppStateCommand` 第 200-233 行）
- Modify: `src/main/app-core/app-core.ts`（services 接线第 103-140 行 + 广播函数）

**Interfaces:**

- Consumes: Task 1 契约；Task 3 默认单例函数；`windowManager.getAll()`（`src/main/windows/window-manager.ts:477`）。
- Produces:
  - `PierCommand` 新增：`{ type: "terminalStatusBar.prefs.getAll" }`、`{ type: "terminalStatusBar.prefs.setItemOverride"; itemId: string; override: TerminalStatusBarItemOverride }`、`{ type: "terminalStatusBar.prefs.resetItem"; itemId: string }`——三者 resolve `TerminalStatusBarPrefs` 全量快照。
  - `PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED = "pier://terminal-status-bar:prefs-changed"`，payload `TerminalStatusBarPrefs`（`ALLOWED_RENDERER_CHANNELS` 由 `Object.values(PIER_BROADCAST)` 自动派生，无需另改）。
  - `PierCoreServices.terminalStatusBarPrefs: { getAll(): Promise<TerminalStatusBarPrefs>; resetItem(itemId: string): Promise<TerminalStatusBarPrefs>; setItemOverride(itemId: string, override: TerminalStatusBarItemOverride): Promise<TerminalStatusBarPrefs> }`——set/reset 在 resolve 前完成内存态提交并向所有窗口广播（磁盘写仍防抖异步，spec §3.2「set 的 resolve 语义」同款）。

**Steps:**

- [ ] `src/shared/contracts/commands.ts`：import 区加 `import { terminalStatusBarItemOverrideSchema } from "./terminal-status-bar.ts";`；在 `plugin.disable` 条目后插入：

```ts
  z.object({ type: z.literal("terminalStatusBar.prefs.getAll") }),
  z.object({
    itemId: z.string().min(1),
    override: terminalStatusBarItemOverrideSchema,
    type: z.literal("terminalStatusBar.prefs.setItemOverride"),
  }),
  z.object({
    itemId: z.string().min(1),
    type: z.literal("terminalStatusBar.prefs.resetItem"),
  }),
```

- [ ] `src/shared/ipc-channels.ts`：`PIER_BROADCAST` 末尾加：

```ts
  // 终端状态栏用户覆盖变更后广播完整快照 (main → renderer, payload TerminalStatusBarPrefs).
  TERMINAL_STATUS_BAR_PREFS_CHANGED: "pier://terminal-status-bar:prefs-changed",
```

- [ ] 跑 `pnpm typecheck`，预期失败：`src/main/app-core/permissions.ts` 的 `Record<PierCommand["type"], ...>` 缺三个新 key（类型系统强制补全——这就是本仓库命令新增的守卫）。
- [ ] `src/main/app-core/permissions.ts`：`REQUIRED_CAPABILITIES_BY_COMMAND` 在 `terminal.profile.upsert` 之后加（应用级偏好，与 preferences 同权）：

```ts
  "terminalStatusBar.prefs.getAll": ["preferences:read"],
  "terminalStatusBar.prefs.resetItem": ["preferences:write"],
  "terminalStatusBar.prefs.setItemOverride": ["preferences:write"],
```

- [ ] `src/main/ipc/command.ts`：`RENDERER_FACADE_COMMAND_TYPES` 集合中加三个字符串：`"terminalStatusBar.prefs.getAll"`、`"terminalStatusBar.prefs.resetItem"`、`"terminalStatusBar.prefs.setItemOverride"`。
- [ ] `src/main/app-core/command-router-services.ts`：import 区加 `import type { TerminalStatusBarItemOverride, TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";`；`PierCoreServices` 中 `terminalProfiles` 之后加：

```ts
  terminalStatusBarPrefs: {
    getAll(): Promise<TerminalStatusBarPrefs>;
    resetItem(itemId: string): Promise<TerminalStatusBarPrefs>;
    setItemOverride(
      itemId: string,
      override: TerminalStatusBarItemOverride
    ): Promise<TerminalStatusBarPrefs>;
  };
```

- [ ] `src/main/app-core/command-router.ts`：`executeAppStateCommand`（第 200-233 行）switch 中 `preferences.update` case 之后加：

```ts
    case "terminalStatusBar.prefs.getAll":
      return success(requestId, await services.terminalStatusBarPrefs.getAll());
    case "terminalStatusBar.prefs.resetItem":
      return success(
        requestId,
        await services.terminalStatusBarPrefs.resetItem(command.itemId)
      );
    case "terminalStatusBar.prefs.setItemOverride":
      return success(
        requestId,
        await services.terminalStatusBarPrefs.setItemOverride(
          command.itemId,
          command.override
        )
      );
```

- [ ] `src/main/app-core/app-core.ts`：import 区加——

```ts
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  readTerminalStatusBarPrefs,
  resetTerminalStatusBarItem,
  setTerminalStatusBarItemOverride,
} from "../state/terminal-status-bar-prefs.ts";
```

  在 `broadcastMruState`（第 45-51 行）之后加同款广播函数：

```ts
function broadcastTerminalStatusBarPrefs(prefs: TerminalStatusBarPrefs): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
        prefs
      );
    }
  }
}
```

  `services` 对象（第 103-140 行）中 `terminalProfiles` 之后加：

```ts
    terminalStatusBarPrefs: {
      getAll: () => readTerminalStatusBarPrefs(),
      resetItem: async (itemId) => {
        const next = await resetTerminalStatusBarItem(itemId);
        broadcastTerminalStatusBarPrefs(next);
        return next;
      },
      setItemOverride: async (itemId, override) => {
        const next = await setTerminalStatusBarItemOverride(itemId, override);
        broadcastTerminalStatusBarPrefs(next);
        return next;
      },
    },
```

- [ ] 跑 `pnpm check`（typecheck 确认 permissions Record 完整、depcruise 确认 app-core → state 属 main 内合法方向）与 `pnpm test:unit`（`tests/unit/app-core/command-router.test.ts`、`tests/unit/main/ipc-command.test.ts` 若因 services 桩缺新字段编译失败，为其桩对象补上 `terminalStatusBarPrefs` 三个 `vi.fn()` 实现——返回 `Promise.resolve({ items: {}, version: 1 })`）。
- [ ] Commit：stage `src/shared/contracts/commands.ts src/shared/ipc-channels.ts src/main/app-core/permissions.ts src/main/ipc/command.ts src/main/app-core/command-router-services.ts src/main/app-core/command-router.ts src/main/app-core/app-core.ts`（若改了测试桩，一并 stage 对应 `tests/unit/...` 路径），message `feat(ipc): terminal status bar prefs commands + change broadcast`，等用户确认后提交。

---

## Task 5 — preload `PierTerminalStatusBarPrefsAPI`

**Files:**

- Create: `src/preload/terminal-status-bar-api.ts`（独立文件——`src/preload/index.ts` 现 464 行，逼近 500 硬上限；照 `git-api.ts` 先例自带 invoke 助手）
- Modify: `src/preload/index.ts`（import 区、`PierWindowAPI` 接口第 170-200 行、`api` 对象第 430-462 行）

**Interfaces:**

- Consumes: Task 4 的命令类型与广播常量；`PIER.COMMAND_EXECUTE`。
- Produces: `window.pier.terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI`，其中

```ts
export interface PierTerminalStatusBarPrefsAPI {
  getAll: () => Promise<TerminalStatusBarPrefs>;
  onChanged: (cb: (prefs: TerminalStatusBarPrefs) => void) => () => void;
  resetItem: (itemId: string) => Promise<TerminalStatusBarPrefs>;
  setItemOverride: (
    itemId: string,
    override: TerminalStatusBarItemOverride
  ) => Promise<TerminalStatusBarPrefs>;
}
```

**Steps:**

- [ ] 新建 `src/preload/terminal-status-bar-api.ts`（完整内容）：

```ts
import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  TerminalStatusBarItemOverride,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierTerminalStatusBarPrefsAPI {
  getAll: () => Promise<TerminalStatusBarPrefs>;
  /** 订阅 main 广播的完整快照(含发起窗口自身)。返回解绑函数。 */
  onChanged: (cb: (prefs: TerminalStatusBarPrefs) => void) => () => void;
  resetItem: (itemId: string) => Promise<TerminalStatusBarPrefs>;
  setItemOverride: (
    itemId: string,
    override: TerminalStatusBarItemOverride
  ) => Promise<TerminalStatusBarPrefs>;
}

// 与 index.ts / git-api.ts 同款 envelope 解包(独立文件避免 index.ts 触 500 行上限)。
async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

export const terminalStatusBarPrefsApi: PierTerminalStatusBarPrefsAPI = {
  getAll: () =>
    invokePierCommand<TerminalStatusBarPrefs>({
      type: "terminalStatusBar.prefs.getAll",
    }),
  onChanged: (cb) => {
    const listener = (_event: unknown, prefs: TerminalStatusBarPrefs) => {
      cb(prefs);
    };
    ipcRenderer.on(PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED, listener);
    return () => {
      ipcRenderer.off(
        PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
        listener
      );
    };
  },
  resetItem: (itemId) =>
    invokePierCommand<TerminalStatusBarPrefs>({
      itemId,
      type: "terminalStatusBar.prefs.resetItem",
    }),
  setItemOverride: (itemId, override) =>
    invokePierCommand<TerminalStatusBarPrefs>({
      itemId,
      override,
      type: "terminalStatusBar.prefs.setItemOverride",
    }),
};
```

- [ ] `src/preload/index.ts`：
  - import 区加 `import { type PierTerminalStatusBarPrefsAPI, terminalStatusBarPrefsApi } from "./terminal-status-bar-api.ts";`
  - 类型 re-export 区（第 118-119 行旁）加 `export type { PierTerminalStatusBarPrefsAPI } from "./terminal-status-bar-api.ts";`
  - `PierWindowAPI` 接口（第 170-200 行）`terminal: TerminalAPI;` 之后加 `terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI;`
  - `api` 对象（第 430-462 行）`terminal: terminalApi,` 之后加 `terminalStatusBarPrefs: terminalStatusBarPrefsApi,`
- [ ] 跑 `pnpm check`（file-size：index.ts 增约 4 行仍 < 500；depcruise：preload → shared 合法）与 `pnpm test:unit`。
- [ ] Commit：stage `src/preload/terminal-status-bar-api.ts src/preload/index.ts`，message `feat(preload): expose terminal status bar prefs API`，等用户确认后提交。

---

## Task 6 — renderer 镜像 store `useTerminalStatusBarPrefsStore` + bootstrap 接线（TDD）

**Files:**

- Create: `src/renderer/stores/terminal-status-bar-prefs.store.ts`
- Modify: `src/renderer/main.tsx`（import 区 + `bootstrap()` 内 `Promise.all` 第 56-63 行）
- Test: `tests/unit/renderer/stores/terminal-status-bar-prefs-store.test.ts`（新建）

**Interfaces:**

- Consumes: `window.pier.terminalStatusBarPrefs`（Task 5）；Task 1 的 `withItemOverridePatch` / `emptyTerminalStatusBarPrefs`。
- Produces:
  - `useTerminalStatusBarPrefsStore`：state `{ initialized: boolean; prefs: TerminalStatusBarPrefs }`，actions `patchItemOverride(itemId: string, patch: TerminalStatusBarItemOverridePatch): Promise<void>`、`resetItem(itemId: string): Promise<void>`
  - `initTerminalStatusBarPrefs(): Promise<void>`（bootstrap 全量拉取 + 订阅广播）

**Steps:**

- [ ] 写失败测试 `tests/unit/renderer/stores/terminal-status-bar-prefs-store.test.ts`（完整内容；`window.pier` 桩沿用 `theme-store-native-chrome.test.ts` 的 `Object.defineProperty` 先例）：

```ts
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangedCb = (prefs: TerminalStatusBarPrefs) => void;

function prefsOf(
  items: TerminalStatusBarPrefs["items"]
): TerminalStatusBarPrefs {
  return { items, version: 1 };
}

describe("terminal status bar prefs mirror store", () => {
  let changedCb: ChangedCb | null = null;
  let remote: TerminalStatusBarPrefs;
  const getAll = vi.fn(async () => remote);
  const setItemOverride = vi.fn(
    async (itemId: string, override: TerminalStatusBarPrefs["items"][string]) => {
      remote = prefsOf({ ...remote.items, [itemId]: override });
      return remote;
    }
  );
  const resetItem = vi.fn(async (itemId: string) => {
    const { [itemId]: _removed, ...items } = remote.items;
    remote = prefsOf(items);
    return remote;
  });

  beforeEach(() => {
    vi.resetModules();
    changedCb = null;
    remote = prefsOf({});
    getAll.mockClear();
    setItemOverride.mockClear();
    resetItem.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminalStatusBarPrefs: {
          getAll,
          onChanged: (cb: ChangedCb) => {
            changedCb = cb;
            return () => {
              changedCb = null;
            };
          },
          resetItem,
          setItemOverride,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("init 全量拉取并置 initialized", async () => {
    remote = prefsOf({ "a.b": { hidden: true } });
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    expect(useTerminalStatusBarPrefsStore.getState().initialized).toBe(true);
    expect(useTerminalStatusBarPrefsStore.getState().prefs).toEqual(
      prefsOf({ "a.b": { hidden: true } })
    );
  });

  it("广播更新镜像(其它窗口来源)", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    changedCb?.(prefsOf({ "x.y": { alignment: "right" } }));
    expect(useTerminalStatusBarPrefsStore.getState().prefs.items["x.y"]).toEqual(
      { alignment: "right" }
    );
  });

  it("patchItemOverride 合成完整覆盖并在 resolve 路径同步 set", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    const store = useTerminalStatusBarPrefsStore.getState();
    await store.patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { order: 20 });
    // patch 语义:第二次保留 hidden 且叠加 order
    expect(setItemOverride).toHaveBeenLastCalledWith("a.b", {
      hidden: true,
      order: 20,
    });
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toEqual({ hidden: true, order: 20 });
  });

  it("patch 清空全部字段时改走 resetItem", async () => {
    const { initTerminalStatusBarPrefs, useTerminalStatusBarPrefsStore } =
      await import("@/stores/terminal-status-bar-prefs.store.ts");
    await initTerminalStatusBarPrefs();
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: true });
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride("a.b", { hidden: null });
    expect(resetItem).toHaveBeenCalledWith("a.b");
    expect(
      useTerminalStatusBarPrefsStore.getState().prefs.items["a.b"]
    ).toBeUndefined();
  });
});
```

- [ ] 跑 `pnpm test:unit tests/unit/renderer/stores/terminal-status-bar-prefs-store.test.ts`，预期失败：`Failed to resolve import "@/stores/terminal-status-bar-prefs.store.ts"`。
- [ ] 新建 `src/renderer/stores/terminal-status-bar-prefs.store.ts`（完整内容）：

```ts
/**
 * 终端状态栏用户覆盖的 renderer 镜像 store。
 *
 * main 是唯一数据源:initTerminalStatusBarPrefs 全量拉取 + 订阅
 * TERMINAL_STATUS_BAR_PREFS_CHANGED 广播;写路径在 IPC resolve 后同步 set
 * (发起窗口即时一致,main 内存态已提交),广播兜底其它窗口。
 */
import {
  emptyTerminalStatusBarPrefs,
  type TerminalStatusBarItemOverridePatch,
  type TerminalStatusBarPrefs,
  withItemOverridePatch,
} from "@shared/contracts/terminal-status-bar.ts";
import { create } from "zustand";

interface TerminalStatusBarPrefsState {
  initialized: boolean;
  /** 以 patch 语义更新单项覆盖;合成结果为空时自动改走 resetItem。 */
  patchItemOverride(
    itemId: string,
    patch: TerminalStatusBarItemOverridePatch
  ): Promise<void>;
  prefs: TerminalStatusBarPrefs;
  resetItem(itemId: string): Promise<void>;
}

export const useTerminalStatusBarPrefsStore =
  create<TerminalStatusBarPrefsState>((set, get) => ({
    initialized: false,
    patchItemOverride: async (itemId, patch) => {
      const current = get().prefs.items[itemId];
      const next = withItemOverridePatch(current, patch);
      const prefs =
        next === null
          ? await window.pier.terminalStatusBarPrefs.resetItem(itemId)
          : await window.pier.terminalStatusBarPrefs.setItemOverride(
              itemId,
              next
            );
      set({ prefs });
    },
    prefs: emptyTerminalStatusBarPrefs(),
    resetItem: async (itemId) => {
      const prefs = await window.pier.terminalStatusBarPrefs.resetItem(itemId);
      set({ prefs });
    },
  }));

export async function initTerminalStatusBarPrefs(): Promise<void> {
  window.pier.terminalStatusBarPrefs.onChanged((prefs) => {
    useTerminalStatusBarPrefsStore.setState({ initialized: true, prefs });
  });
  const prefs = await window.pier.terminalStatusBarPrefs.getAll();
  useTerminalStatusBarPrefsStore.setState({ initialized: true, prefs });
}
```

- [ ] 跑 `pnpm test:unit tests/unit/renderer/stores/terminal-status-bar-prefs-store.test.ts`，预期全绿。
- [ ] `src/renderer/main.tsx`：import 区加 `import { initTerminalStatusBarPrefs } from "./stores/terminal-status-bar-prefs.store.ts";`；`bootstrap()` 的 `Promise.all`（第 56-63 行）追加 `initTerminalStatusBarPrefs(),`。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] Commit：stage `src/renderer/stores/terminal-status-bar-prefs.store.ts src/renderer/main.tsx tests/unit/renderer/stores/terminal-status-bar-prefs-store.test.ts`，message `feat(renderer): terminal status bar prefs mirror store`，等用户确认后提交。

---

## Task 7 — 合并纯函数 `terminal-status-bar-merge.ts`（TDD 主体）

**Files:**

- Create: `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts`
- Test: `tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`（新建；目录已存在）

**Interfaces:**

- Consumes: `PluginRegistryEntry` / `PluginTerminalStatusItemContribution`（`@shared/contracts/plugin.ts`）；`TerminalStatusBarPrefs`（Task 1）。
- Produces:
  - `mergeTerminalStatusItems<T extends { readonly id: string }>(registered: readonly T[], declaredById: ReadonlyMap<string, DeclaredTerminalStatusItem>, prefs: TerminalStatusBarPrefs): TerminalStatusBarGroups<T>`（`{ left: T[]; right: T[] }`，DOM 渲染序，见「全计划统一语义」#3）
  - `resolveEffectiveTerminalStatusItemConfig(declared, override): { alignment: "left"|"right"; hidden: boolean; order: number }`
  - `compareOuterFirst(a: { id; order }, b): number`
  - `declaredTerminalStatusItemsById(plugins: readonly PluginRegistryEntry[]): ReadonlyMap<string, PluginTerminalStatusItemContribution>`（只收 `enabled` 插件）
  - `normalizedGroupOrders(outerFirstIds: readonly string[]): Record<string, number>`（index×10，设置页重排用）

**Steps:**

- [ ] 写失败测试 `tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`（完整内容）：

```ts
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import { describe, expect, it } from "vitest";
import {
  compareOuterFirst,
  type DeclaredTerminalStatusItem,
  mergeTerminalStatusItems,
  normalizedGroupOrders,
  resolveEffectiveTerminalStatusItemConfig,
} from "@/panel-kits/terminal/terminal-status-bar-merge.ts";

interface Item {
  readonly id: string;
}

function items(...ids: string[]): Item[] {
  return ids.map((id) => ({ id }));
}

function declared(
  entries: Record<string, DeclaredTerminalStatusItem>
): ReadonlyMap<string, DeclaredTerminalStatusItem> {
  return new Map(Object.entries(entries));
}

function prefsOf(
  overrides: TerminalStatusBarPrefs["items"] = {}
): TerminalStatusBarPrefs {
  return { items: overrides, version: 1 };
}

describe("resolveEffectiveTerminalStatusItemConfig", () => {
  it("默认值:left / 0 / 可见", () => {
    expect(resolveEffectiveTerminalStatusItemConfig(undefined, undefined))
      .toEqual({ alignment: "left", hidden: false, order: 0 });
  });

  it("manifest 声明覆盖默认", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right", order: 10 },
        undefined
      )
    ).toEqual({ alignment: "right", hidden: false, order: 10 });
  });

  it("用户覆盖优先于 manifest", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right", order: 10 },
        { alignment: "left", hidden: true, order: -1 }
      )
    ).toEqual({ alignment: "left", hidden: true, order: -1 });
  });

  it("覆盖字段独立回落:只覆盖 order 时 alignment 仍取 manifest", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right" },
        { order: 5 }
      )
    ).toEqual({ alignment: "right", hidden: false, order: 5 });
  });
});

describe("mergeTerminalStatusItems", () => {
  it("无声明无覆盖:全部落左组,order 0 下按 id 字典序", () => {
    const groups = mergeTerminalStatusItems(
      items("b.item", "a.item"),
      declared({}),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["a.item", "b.item"]);
    expect(groups.right).toEqual([]);
  });

  it("按生效 alignment 分两组", () => {
    const groups = mergeTerminalStatusItems(
      items("l.one", "r.one"),
      declared({ "r.one": { alignment: "right" } }),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["l.one"]);
    expect(groups.right.map((i) => i.id)).toEqual(["r.one"]);
  });

  it("left 组 DOM 序 = order 升序(order 小靠左)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b", "c"),
      declared({ a: { order: 20 }, b: { order: 0 }, c: { order: 10 } }),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("right 组 DOM 序 = order 升序再 reverse(order 小落 DOM 最右)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b", "c"),
      declared({
        a: { alignment: "right", order: 20 },
        b: { alignment: "right", order: 0 },
        c: { alignment: "right", order: 10 },
      }),
      prefsOf()
    );
    // 外侧优先序 b(0) c(10) a(20);DOM 从左到右 = a c b,b 在最右(最外)
    expect(groups.right.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("同 order 按 id 字典序 tie-break,字典序小者更靠外侧", () => {
    const left = mergeTerminalStatusItems(
      items("z.item", "a.item"),
      declared({ "z.item": { order: 5 }, "a.item": { order: 5 } }),
      prefsOf()
    );
    expect(left.left.map((i) => i.id)).toEqual(["a.item", "z.item"]);
    const right = mergeTerminalStatusItems(
      items("z.item", "a.item"),
      declared({
        "z.item": { alignment: "right", order: 5 },
        "a.item": { alignment: "right", order: 5 },
      }),
      prefsOf()
    );
    // DOM 最右 = 最外 = 字典序小的 a.item
    expect(right.right.map((i) => i.id)).toEqual(["z.item", "a.item"]);
  });

  it("用户覆盖换组 + 重排生效(覆盖 ?? manifest ?? 默认)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b"),
      declared({ a: { alignment: "left", order: 10 } }),
      prefsOf({ a: { alignment: "right" }, b: { order: -1 } })
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b"]);
    expect(groups.right.map((i) => i.id)).toEqual(["a"]);
  });

  it("hidden 覆盖在此层过滤", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b"),
      declared({}),
      prefsOf({ a: { hidden: true } })
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("compareOuterFirst / normalizedGroupOrders", () => {
  it("compareOuterFirst:order 升序,同 order 按 id 字典序", () => {
    expect(
      [
        { id: "b", order: 10 },
        { id: "a", order: 10 },
        { id: "c", order: 0 },
      ].sort(compareOuterFirst).map((i) => i.id)
    ).toEqual(["c", "a", "b"]);
  });

  it("normalizedGroupOrders:按外侧优先目标顺序给 index*10", () => {
    expect(normalizedGroupOrders(["x", "y", "z"])).toEqual({
      x: 0,
      y: 10,
      z: 20,
    });
  });
});
```

- [ ] 跑 `pnpm test:unit tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`，预期失败：模块不存在。
- [ ] 新建 `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts`（完整内容）：

```ts
/**
 * 终端状态栏生效值合并纯函数 — 不触 registry 单例、不触 store,Vitest 单测主体。
 *
 * 语义(设计文档 §3.3,与 shared/contracts/plugin.ts 注释一致,勿改):
 * - 生效值 = 用户覆盖 ?? manifest 声明 ?? 默认(alignment "left"、order 0、可见)。
 * - hidden 只有用户覆盖来源,默认 false;hidden 项在此层被过滤
 *   (isVisible 动态可见性在其后、组件层执行)。
 * - 同侧内 order 越小越靠外侧:left 组 order 小 → 靠左;right 组 order 小 → 靠右。
 *   同 order 按 id 字典序,字典序小者更靠外侧。
 * - 返回的 left/right 数组都是 DOM 渲染序(从左到右):left = 外侧优先升序原样;
 *   right = 外侧优先升序再 reverse(order 最小项落在 DOM 最右 = 右组最外侧)。
 */
import type {
  PluginRegistryEntry,
  PluginTerminalStatusItemContribution,
} from "@shared/contracts/plugin.ts";
import type {
  TerminalStatusBarItemOverride,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";

export type DeclaredTerminalStatusItem = Pick<
  PluginTerminalStatusItemContribution,
  "alignment" | "order"
>;

export interface EffectiveTerminalStatusItemConfig {
  alignment: "left" | "right";
  hidden: boolean;
  order: number;
}

export interface TerminalStatusBarGroups<T> {
  left: T[];
  right: T[];
}

export function resolveEffectiveTerminalStatusItemConfig(
  declared: DeclaredTerminalStatusItem | undefined,
  override: TerminalStatusBarItemOverride | undefined
): EffectiveTerminalStatusItemConfig {
  return {
    alignment: override?.alignment ?? declared?.alignment ?? "left",
    hidden: override?.hidden ?? false,
    order: override?.order ?? declared?.order ?? 0,
  };
}

/** 外侧优先比较:order 升序,同 order 按 id 字典序。 */
export function compareOuterFirst(
  a: { readonly id: string; readonly order: number },
  b: { readonly id: string; readonly order: number }
): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/** 已启用插件 manifest 声明的状态栏项索引(设置页与合并管道共用数据源)。 */
export function declaredTerminalStatusItemsById(
  plugins: readonly PluginRegistryEntry[]
): ReadonlyMap<string, PluginTerminalStatusItemContribution> {
  const byId = new Map<string, PluginTerminalStatusItemContribution>();
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      byId.set(item.id, item);
    }
  }
  return byId;
}

export function mergeTerminalStatusItems<T extends { readonly id: string }>(
  registered: readonly T[],
  declaredById: ReadonlyMap<string, DeclaredTerminalStatusItem>,
  prefs: TerminalStatusBarPrefs
): TerminalStatusBarGroups<T> {
  const left: Array<{ id: string; item: T; order: number }> = [];
  const right: Array<{ id: string; item: T; order: number }> = [];
  for (const item of registered) {
    const config = resolveEffectiveTerminalStatusItemConfig(
      declaredById.get(item.id),
      prefs.items[item.id]
    );
    if (config.hidden) {
      continue;
    }
    const sortable = { id: item.id, item, order: config.order };
    if (config.alignment === "right") {
      right.push(sortable);
    } else {
      left.push(sortable);
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  right.reverse();
  return {
    left: left.map((entry) => entry.item),
    right: right.map((entry) => entry.item),
  };
}

/**
 * 设置页组内重排后的归一化 order:按外侧优先的目标顺序给 index*10。
 * 留 10 的间隙,让 manifest 后续新增项(常见 order 0/10/20)能插空。
 */
export function normalizedGroupOrders(
  outerFirstIds: readonly string[]
): Record<string, number> {
  const orders: Record<string, number> = {};
  outerFirstIds.forEach((id, index) => {
    orders[id] = index * 10;
  });
  return orders;
}
```

- [ ] 跑 `pnpm test:unit tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`，预期全绿。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] Commit：stage `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`，message `feat(terminal): status bar effective-value merge pure functions`，等用户确认后提交。

---

## Task 8 — `useTerminalStatusBarItems` hook + 左右分组渲染 + terminal-panel 接入

**Files:**

- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`（hook、`visibleTerminalStatusItems` / `hasVisibleTerminalStatusItems` 第 50-62 行、`TerminalStatusBar` 第 64-88 行）
- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx`（import 第 28-32 行、第 166 行 `useTerminalStatusItems()` → `useTerminalStatusBarItems()`）
- Test: `tests/unit/renderer/terminal-status-items.test.tsx`（重写为分组语义）

**Interfaces:**

- Consumes: **Phase 0 `usePluginRegistryStore`**（`src/renderer/stores/plugin-registry.store.ts`，读 `state.plugins: PluginRegistryEntry[]`）；Task 6 `useTerminalStatusBarPrefsStore`（读 `state.prefs`）；Task 7 合并函数。
- Produces:
  - `useTerminalStatusBarItems(): TerminalStatusBarGroups<TerminalStatusItem>`
  - `visibleTerminalStatusItems(groups: TerminalStatusBarGroups<TerminalStatusItem>, context: TerminalStatusItemContext): TerminalStatusBarGroups<TerminalStatusItem>`（isVisible 过滤，在 hidden 过滤之后）
  - `hasVisibleTerminalStatusItems(groups, context): boolean`
  - `TerminalStatusBar` 渲染 `[左组] ←flex-1 spacer→ [右组]`
  - `useTerminalStatusItems()`（registry 原始 hook）保留导出，供 hook 内部与测试使用。

**Steps:**

- [ ] `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`：import 区改为——

```ts
import type {
  RendererTerminalStatusItem,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { useMemo, useSyncExternalStore } from "react";
import { Notifier } from "@/lib/util/notifier.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import {
  declaredTerminalStatusItemsById,
  mergeTerminalStatusItems,
  type TerminalStatusBarGroups,
} from "./terminal-status-bar-merge.ts";
```

- [ ] 同文件：`useTerminalStatusItems` 之后新增合并 hook，并将 `visibleTerminalStatusItems` / `hasVisibleTerminalStatusItems`（第 50-62 行）替换为分组版本：

```ts
/**
 * 组件层合并管道:registry 注册对象 × plugin-registry.store(manifest 声明,
 * Phase 0 产物) × terminal-status-bar-prefs.store(用户覆盖)。
 * plugin registry 未 initialized 时 plugins 为空数组,自然退化为全默认值。
 */
export function useTerminalStatusBarItems(): TerminalStatusBarGroups<TerminalStatusItem> {
  const registered = useTerminalStatusItems();
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const prefs = useTerminalStatusBarPrefsStore((s) => s.prefs);
  return useMemo(
    () =>
      mergeTerminalStatusItems(
        registered,
        declaredTerminalStatusItemsById(plugins),
        prefs
      ),
    [registered, plugins, prefs]
  );
}

export function visibleTerminalStatusItems(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext
): TerminalStatusBarGroups<TerminalStatusItem> {
  const isVisible = (item: TerminalStatusItem) =>
    item.isVisible?.(context) ?? true;
  return {
    left: groups.left.filter(isVisible),
    right: groups.right.filter(isVisible),
  };
}

export function hasVisibleTerminalStatusItems(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext
): boolean {
  const visible = visibleTerminalStatusItems(groups, context);
  return visible.left.length + visible.right.length > 0;
}
```

- [ ] 同文件：`TerminalStatusBar` 替换为分组渲染（右键接线在 Task 9 补）：

```tsx
function renderStatusGroup(
  items: readonly TerminalStatusItem[],
  statusContext: TerminalStatusItemContext
) {
  return items.map((item) => (
    <div className="min-w-0 shrink-0" key={item.id}>
      {item.render(statusContext)}
    </div>
  ));
}

export function TerminalStatusBar({
  context,
  cwd,
  panelId,
  title,
}: TerminalStatusItemContext) {
  const groups = useTerminalStatusBarItems();
  const statusContext = { context, cwd, panelId, title };
  const visible = visibleTerminalStatusItems(groups, statusContext);
  if (visible.left.length + visible.right.length === 0) {
    return null;
  }
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1 px-1.5 leading-none"
      data-testid="terminal-status-bar"
    >
      {renderStatusGroup(visible.left, statusContext)}
      <div className="min-w-0 flex-1" data-testid="terminal-status-bar-spacer" />
      {renderStatusGroup(visible.right, statusContext)}
    </div>
  );
}
```

- [ ] `src/renderer/panel-kits/terminal/terminal-panel.tsx`：import（第 28-32 行）把 `useTerminalStatusItems` 换成 `useTerminalStatusBarItems`；第 166 行改 `const statusItems = useTerminalStatusBarItems();`（第 214-217 行 `hasVisibleTerminalStatusItems(statusItems, statusContext)` 与第 388-393 行 `<TerminalStatusBar …/>` 调用形状不变）。
- [ ] 重写 `tests/unit/renderer/terminal-status-items.test.tsx`（完整内容；两个镜像 store 的默认态即空，逐用例后重置）：

```tsx
import type { PanelContext } from "@shared/contracts/panel.ts";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasVisibleTerminalStatusItems,
  TerminalStatusBar,
  terminalStatusItemRegistry,
  useTerminalStatusBarItems,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

const context: PanelContext = {
  branch: "feature/worktree",
  contextId: "ctx-pier",
  cwd: "/Users/dev/ABC/pier",
  gitRoot: "/Users/dev/ABC/pier",
  openedPath: "/Users/dev/ABC/pier",
  projectRoot: "/Users/dev/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/dev/ABC/pier",
  worktreeRoot: "/Users/dev/ABC/pier",
};

function renderBar() {
  return render(
    <TerminalStatusBar
      context={context}
      cwd={context.cwd ?? null}
      panelId="terminal-1"
      title={null}
    />
  );
}

function setPrefs(
  items: Record<
    string,
    { alignment?: "left" | "right"; hidden?: boolean; order?: number }
  >
) {
  useTerminalStatusBarPrefsStore.setState({
    initialized: true,
    prefs: { items, version: 1 },
  });
}

afterEach(() => {
  terminalStatusItemRegistry.clearForTests();
  setPrefs({});
});

describe("terminal status bar grouped rendering", () => {
  it("无声明无覆盖时全部落左组,order 0 下按 id 字典序", () => {
    terminalStatusItemRegistry.register({
      id: "test.second",
      render: () => <span>Second</span>,
    });
    terminalStatusItemRegistry.register({
      id: "test.first",
      render: () => <span>First</span>,
    });

    renderBar();

    expect(screen.getByTestId("terminal-status-bar")).toHaveTextContent(
      "FirstSecond"
    );
    expect(
      screen.getByTestId("terminal-status-bar-spacer")
    ).toBeInTheDocument();
  });

  it("用户覆盖 alignment: right 的项渲染在 spacer 之后", () => {
    terminalStatusItemRegistry.register({
      id: "test.left",
      render: () => <span>L</span>,
    });
    terminalStatusItemRegistry.register({
      id: "test.right",
      render: () => <span>R</span>,
    });
    setPrefs({ "test.right": { alignment: "right" } });

    renderBar();

    const bar = screen.getByTestId("terminal-status-bar");
    const spacer = screen.getByTestId("terminal-status-bar-spacer");
    const children = Array.from(bar.children);
    expect(children.indexOf(spacer)).toBe(1);
    expect(bar).toHaveTextContent("LR");
  });

  it("hidden 覆盖过滤该项;全部隐藏时状态栏不渲染", () => {
    terminalStatusItemRegistry.register({
      id: "test.only",
      render: () => <span>Only</span>,
    });
    setPrefs({ "test.only": { hidden: true } });

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("isVisible 动态可见性在 hidden 过滤之后仍生效", () => {
    terminalStatusItemRegistry.register({
      id: "test.invisible",
      isVisible: () => false,
      render: () => <span>Invisible</span>,
    });

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });

  it("dispose 后移除状态项", () => {
    const dispose = terminalStatusItemRegistry.register({
      id: "test.item",
      render: () => <span>Visible</span>,
    });
    dispose();

    renderBar();

    expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
  });
});

describe("hasVisibleTerminalStatusItems", () => {
  it("左右任一组可见即 true", () => {
    const statusContext = {
      context,
      cwd: context.cwd ?? null,
      panelId: "terminal-1",
      title: null,
    };
    expect(
      hasVisibleTerminalStatusItems({ left: [], right: [] }, statusContext)
    ).toBe(false);
    expect(
      hasVisibleTerminalStatusItems(
        { left: [], right: [{ id: "x", render: () => null }] },
        statusContext
      )
    ).toBe(true);
  });
});

// 保持导出面完整性:hook 存在且可从组件文件 import(渲染路径已在上面覆盖)。
describe("useTerminalStatusBarItems export", () => {
  it("是函数", () => {
    expect(typeof useTerminalStatusBarItems).toBe("function");
  });
});
```

- [ ] 跑 `pnpm test:unit tests/unit/renderer/terminal-status-items.test.tsx tests/unit/renderer/git-plugin.test.tsx tests/unit/renderer/plugin-host-context.test.tsx`，预期全绿（若 `git-plugin.test.tsx` 渲染路径断言状态栏文本顺序，按分组语义微调断言——`pier.worktree.status` 声明 `order: 10`、默认左组，单项行为不变）。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] 人工验证（`pnpm dev`）：
  1. 打开含 git 仓库的终端 panel → 状态栏左下角出现 Worktree Status 项（与改造前一致）。
  2. 开发者工具 console 里执行不做——改用后续设置页验证；本步只确认无回归、`h-7` 高度预留仍随 `hasStatusBar` 正确。
- [ ] Commit：stage `src/renderer/panel-kits/terminal/terminal-status-bar.tsx src/renderer/panel-kits/terminal/terminal-panel.tsx tests/unit/renderer/terminal-status-items.test.tsx`（若微调了 `tests/unit/renderer/git-plugin.test.tsx` 一并 stage），message `feat(terminal): grouped status bar rendering driven by manifest + user overrides`，等用户确认后提交。

---

## Task 9 — menu 契约 checkbox 项 + 状态栏右键菜单 + 设置对话框 section 定向打开

**Files:**

- Modify: `src/shared/contracts/menu.ts`（`MenuItem` union 第 28-60 行区域）
- Modify: `src/main/menu/template-schema.ts`（叶子/非叶子 union）
- Modify: `src/main/ipc/menu.ts`（`toMenuItem` 第 29-59 行）
- Test: `tests/unit/main/menu/template-schema.test.ts`（追加用例）
- Modify: `src/renderer/stores/settings-dialog.store.ts`（加 `activeSection` / `openSection`）
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`（第 44-45 行 `useState` 改读 store）
- Create: `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts`
- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`（容器 div 接 `onContextMenu`）
- Modify: `src/renderer/i18n/locales/en/terminal.ts`、`src/renderer/i18n/locales/zh-CN/terminal.ts`（`statusBar.manage` 键）

**Interfaces:**

- Consumes: **Phase 0 `usePluginRegistryStore`**（`getState().plugins`）；Task 6 prefs store（`patchItemOverride`）；Task 7 `resolveEffectiveTerminalStatusItemConfig`；`resolvePluginTerminalStatusItemDisplay`（`src/renderer/lib/plugins/display.ts:192-212`）；`window.pier.menu.popup`（`src/preload/index.ts:389-392`）；`cssPointToContentViewPoint`（`src/renderer/lib/window-zoom/coordinates.ts`）+ `useZoomStore`。
- Produces:
  - menu 契约新增 `MenuItemCheckbox = { checked: boolean; enabled?: boolean; id: string; label: string; type: "checkbox" }`（入 `MenuItem` union；选中后按 action 同路 resolve `actionId`）
  - `openTerminalStatusBarContextMenu(event: ReactMouseEvent): Promise<void>`
  - `useSettingsDialogStore` 增 `activeSection: SettingsSectionId`、`setActiveSection(section)`、`openSection(section)`（打开对话框并定位 section；Phase 3 的「禁用插件 fallback」也将建在此之上）

**Steps:**

- [ ] TDD schema：`tests/unit/main/menu/template-schema.test.ts` 追加——

```ts
  it("接受 checkbox 项(状态栏显隐勾选用)", () => {
    const ok = [
      { type: "checkbox", id: "pier.x.toggle", label: "Item", checked: true },
      { type: "separator" },
      { type: "action", id: "pier.x.manage", label: "Manage" },
    ];
    expect(() => MenuTemplateSchema.parse(ok)).not.toThrow();
  });

  it("拒绝缺 checked 的 checkbox 项", () => {
    expect(() =>
      MenuTemplateSchema.parse([
        { type: "checkbox", id: "pier.x", label: "Item" },
      ])
    ).toThrow();
  });
```

- [ ] 跑 `pnpm test:unit tests/unit/main/menu/template-schema.test.ts`，预期新用例失败（union 不识别 `checkbox`）。
- [ ] `src/shared/contracts/menu.ts`：在 `MenuItemAction` 之后加接口并入 union——

```ts
export interface MenuItemCheckbox {
  /** 当前勾选态(菜单是一次性快照,点击后由调用方落库并重开). */
  checked: boolean;
  enabled?: boolean;
  /** popup resolve 回传此 id,由调用方自行 dispatch(不必经 actionRegistry). */
  id: string;
  label: string;
  type: "checkbox";
}

export type MenuItem =
  | MenuItemSeparator
  | MenuItemRole
  | MenuItemAction
  | MenuItemCheckbox
  | MenuItemSubmenu;
```

- [ ] `src/main/menu/template-schema.ts`：加 `checkboxSchema` 并加入两级 union（叶子层与带 submenu 层）——

```ts
const checkboxSchema = z.object({
  type: z.literal("checkbox"),
  id: idSchema,
  label: labelSchema,
  checked: z.boolean(),
  enabled: z.boolean().optional(),
});
```

  `makeItemSchema` 中 `z.union([separatorSchema, roleSchema, actionSchema, checkboxSchema])`（depth ≤ 0 分支）与 `z.union([separatorSchema, roleSchema, actionSchema, checkboxSchema, submenuSchema])`。
- [ ] `src/main/ipc/menu.ts`：`toMenuItem` 在 submenu 分支后加——

```ts
  if (item.type === "checkbox") {
    return {
      type: "checkbox",
      checked: item.checked,
      label: item.label,
      enabled: item.enabled ?? true,
      click: (_menuItem: MenuItem) => {
        onPicked(item.id);
      },
    };
  }
```

- [ ] 跑 `pnpm test:unit tests/unit/main/menu/`，预期全绿。
- [ ] `src/renderer/stores/settings-dialog.store.ts` 全量替换为：

```ts
import type { SettingsSectionId } from "@/pages/settings/data/appearance-nav.ts";
import { create } from "zustand";

interface SettingsDialogState {
  activeSection: SettingsSectionId;
  close: () => void;
  isOpen: boolean;
  open: () => void;
  /** 打开设置对话框并定位到指定 section(右键「管理状态栏…」等入口用)。 */
  openSection: (section: SettingsSectionId) => void;
  setActiveSection: (section: SettingsSectionId) => void;
  setOpen: (open: boolean) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  activeSection: "appearance",
  close: () => set({ isOpen: false }),
  isOpen: false,
  open: () => set({ isOpen: true }),
  openSection: (activeSection) => set({ activeSection, isOpen: true }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setOpen: (isOpen) => set({ isOpen }),
}));
```

- [ ] `src/renderer/pages/settings/settings-dialog.tsx`：删第 44-45 行的 `useState`（import 里去掉未用的 `useState`），改为——

```ts
  const activeSection = useSettingsDialogStore((s) => s.activeSection);
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection);
```

  （`SettingsSectionId` import 保留给类型；`NAV_ITEMS` 渲染与 section 条件渲染无需其它改动。）
- [ ] i18n：`src/renderer/i18n/locales/en/terminal.ts` 的 `terminal` 对象加——

```ts
  statusBar: {
    manage: "Manage Status Bar…",
  },
```

  `src/renderer/i18n/locales/zh-CN/terminal.ts` 加——

```ts
  statusBar: {
    manage: "管理状态栏…",
  },
```

- [ ] 新建 `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts`（完整内容）：

```ts
/**
 * 终端状态栏右键菜单 — 走原生 Menu.popup(window.pier.menu.popup)而非 Radix
 * ContextMenu:终端面板主体是原生 WebContentsView,层级恒在 base web content
 * 之上,web popover 自状态栏向上展开会被原生视图遮挡;原生菜单也是终端面板
 * 既有右键通道(lib/context-menu/use-context-menu.ts)。
 *
 * 勾选列表数据源 = 已启用插件 manifest 声明的 terminalStatusItems(与设置页
 * 管理块一致,含当前未注册渲染的项);标题经 resolvePluginTerminalStatusItemDisplay
 * i18n 解析。
 */
import type { MenuItem } from "@shared/contracts/menu.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import i18next from "i18next";
import type { MouseEvent as ReactMouseEvent } from "react";
import { resolvePluginTerminalStatusItemDisplay } from "@/lib/plugins/display.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { resolveEffectiveTerminalStatusItemConfig } from "./terminal-status-bar-merge.ts";

const MANAGE_ACTION_ID = "pier.terminalStatusBar.manage";
const TOGGLE_PREFIX = "pier.terminalStatusBar.toggle:";

interface DeclaredItemRow {
  hidden: boolean;
  itemId: string;
  title: string;
}

function declaredRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs
): DeclaredItemRow[] {
  const locale = i18next.language || "en";
  const rows: DeclaredItemRow[] = [];
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      const config = resolveEffectiveTerminalStatusItemConfig(
        item,
        prefs.items[item.id]
      );
      rows.push({
        hidden: config.hidden,
        itemId: item.id,
        title: resolvePluginTerminalStatusItemDisplay(
          entry.manifest,
          item,
          locale
        ).title,
      });
    }
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function openTerminalStatusBarContextMenu(
  event: ReactMouseEvent
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  const coords = cssPointToContentViewPoint(
    { x: event.clientX, y: event.clientY },
    useZoomStore.getState().windowZoomLevel
  );
  const rows = declaredRows(
    usePluginRegistryStore.getState().plugins,
    useTerminalStatusBarPrefsStore.getState().prefs
  );
  const template: MenuItem[] = [
    ...rows.map<MenuItem>((row) => ({
      checked: !row.hidden,
      id: `${TOGGLE_PREFIX}${row.itemId}`,
      label: row.title,
      type: "checkbox",
    })),
    ...(rows.length > 0
      ? [{ type: "separator" } satisfies MenuItem]
      : []),
    {
      id: MANAGE_ACTION_ID,
      label: i18next.t("terminal.statusBar.manage"),
      type: "action",
    },
  ];
  const result = await window.pier.menu.popup(template, coords);
  if (!result.actionId) {
    return;
  }
  if (result.actionId === MANAGE_ACTION_ID) {
    useSettingsDialogStore.getState().openSection("terminal");
    return;
  }
  if (result.actionId.startsWith(TOGGLE_PREFIX)) {
    const itemId = result.actionId.slice(TOGGLE_PREFIX.length);
    const row = rows.find((entry) => entry.itemId === itemId);
    if (!row) {
      return;
    }
    // 取消勾选 → hidden: true;重新勾选 → 清除 hidden 字段(回落默认可见)。
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride(itemId, { hidden: row.hidden ? null : true });
  }
}
```

- [ ] `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`：import 加 `import { openTerminalStatusBarContextMenu } from "./terminal-status-bar-menu.ts";`；`TerminalStatusBar` 容器 div 加——

```tsx
      onContextMenu={(event) => {
        openTerminalStatusBarContextMenu(event).catch((err: unknown) => {
          console.error("[terminal-status-bar] context menu failed:", err);
        });
      }}
```

- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] 人工验证（`pnpm dev`，真实 OS 鼠标操作）：
  1. 在 git 仓库终端 panel 的状态栏空白处**右键** → 原生菜单弹出，含勾选态「Worktree Status／工作树状态」（随语言）与分隔线 +「Manage Status Bar…／管理状态栏…」。
  2. 点掉勾选 → 状态栏项立即消失；仅此一项时整条状态栏消失（`h-7` 预留同步撤销，终端内容下边界下移）。
  3. 状态栏隐藏后无法右键唤起（预期行为：入口在设置页管理块，Task 10 验证恢复路径）。先重新显示：命令面板打开设置 → 终端 →（Task 10 完成后用状态栏块；Task 10 之前用 `userData/terminal-status-bar-prefs.json` 手动删 key 验证持久化通路）。
  4. 点「管理状态栏…」 → 设置对话框打开且左侧导航停在「终端」。
  5. 开第二个窗口重复步骤 2 → 两窗口状态栏同步变化（广播链路）。
  6. Esc / 点击菜单外部关闭 → 无副作用。
- [ ] Commit：stage `src/shared/contracts/menu.ts src/main/menu/template-schema.ts src/main/ipc/menu.ts tests/unit/main/menu/template-schema.test.ts src/renderer/stores/settings-dialog.store.ts src/renderer/pages/settings/settings-dialog.tsx src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts src/renderer/panel-kits/terminal/terminal-status-bar.tsx src/renderer/i18n/locales/en/terminal.ts src/renderer/i18n/locales/zh-CN/terminal.ts`，message `feat(terminal): status bar context menu with checkbox visibility toggles`，等用户确认后提交。

---

## Task 10 — 设置页「终端 → 状态栏」管理块 + 设置 i18n

**Files:**

- Create: `src/renderer/pages/settings/components/terminal-status-bar-block.tsx`
- Modify: `src/renderer/pages/settings/components/terminal-section.tsx`（`TerminalSection` 返回 JSX 末尾、既有 `</Card>` 之后追加块）
- Modify: `src/renderer/i18n/locales/en/settings.ts`、`src/renderer/i18n/locales/zh-CN/settings.ts`（`settings` 对象加 `statusBar` 子对象）

**Interfaces:**

- Consumes: **Phase 0 `usePluginRegistryStore`**（`(s) => s.plugins`，响应插件启停）；Task 6 `useTerminalStatusBarPrefsStore`（`prefs` / `patchItemOverride` / `resetItem`）；Task 7 `resolveEffectiveTerminalStatusItemConfig` / `compareOuterFirst` / `normalizedGroupOrders`；`resolvePluginTerminalStatusItemDisplay`；`@pier/ui` 的 `Button` / `Card` / `Switch`。
- Produces: `TerminalStatusBarBlock`（默认不导出细节；`terminal-section.tsx` 内使用）。重排语义：上移/下移 = 在外侧优先列表内交换相邻位置后按 `normalizedGroupOrders`（index×10）为该组**顺序有变化的项**写 `order` 覆盖；左右迁移 = 写 `alignment` 覆盖；显隐 = `hidden` patch（重新显示时清除字段）；恢复默认 = `resetItem`。

**Steps:**

- [ ] i18n：`src/renderer/i18n/locales/en/settings.ts` 的 `settings` 对象（与 `nav` / `section` / `row` 平级）加——

```ts
  statusBar: {
    title: "Status Bar",
    description:
      "Show, hide, and reorder terminal status bar items. Higher in the list means closer to the outer edge.",
    leftGroup: "Left",
    rightGroup: "Right",
    empty: "Enabled plugins declare no status bar items",
    moveUp: "Move up (outward)",
    moveDown: "Move down (inward)",
    moveToLeft: "Move to left group",
    moveToRight: "Move to right group",
    visible: "Visible",
    reset: "Reset to plugin default",
    modified: "Modified",
  },
```

  `src/renderer/i18n/locales/zh-CN/settings.ts` 加——

```ts
  statusBar: {
    title: "状态栏",
    description: "控制终端状态栏项的显隐与排序。列表越靠上越靠外侧。",
    leftGroup: "左侧",
    rightGroup: "右侧",
    empty: "已启用插件没有声明状态栏项",
    moveUp: "上移(向外侧)",
    moveDown: "下移(向内侧)",
    moveToLeft: "移到左侧",
    moveToRight: "移到右侧",
    visible: "显示",
    reset: "恢复插件默认",
    modified: "已修改",
  },
```

- [ ] 新建 `src/renderer/pages/settings/components/terminal-status-bar-block.tsx`（完整内容）：

```tsx
/**
 * 设置对话框「终端 → 状态栏」管理块。
 *
 * 数据来源 = plugin-registry.store 中已启用插件 manifest 声明的
 * terminalStatusItems(含当前未注册渲染的,按声明展示) × 用户覆盖镜像。
 * 排序交互为上移/下移按钮(首版不引入 dnd 依赖,spec §3.3);列表为外侧优先序,
 * 上移 = 向外侧。重排落库:交换后按 normalizedGroupOrders(index*10)给顺序有
 * 变化的项写 order 覆盖。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import i18next from "i18next";
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginTerminalStatusItemDisplay } from "@/lib/plugins/display.ts";
import {
  compareOuterFirst,
  normalizedGroupOrders,
  resolveEffectiveTerminalStatusItemConfig,
} from "@/panel-kits/terminal/terminal-status-bar-merge.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

interface StatusBarRow {
  alignment: "left" | "right";
  hasOverride: boolean;
  hidden: boolean;
  id: string;
  order: number;
  title: string;
}

function buildRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs
): { left: StatusBarRow[]; right: StatusBarRow[] } {
  const locale = i18next.language || "en";
  const left: StatusBarRow[] = [];
  const right: StatusBarRow[] = [];
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      const config = resolveEffectiveTerminalStatusItemConfig(
        item,
        prefs.items[item.id]
      );
      const row: StatusBarRow = {
        alignment: config.alignment,
        hasOverride: prefs.items[item.id] !== undefined,
        hidden: config.hidden,
        id: item.id,
        order: config.order,
        title: resolvePluginTerminalStatusItemDisplay(
          entry.manifest,
          item,
          locale
        ).title,
      };
      if (config.alignment === "right") {
        right.push(row);
      } else {
        left.push(row);
      }
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  return { left, right };
}

async function moveWithinGroup(
  rows: readonly StatusBarRow[],
  index: number,
  direction: -1 | 1
): Promise<void> {
  const target = index + direction;
  if (target < 0 || target >= rows.length) {
    return;
  }
  const ids = rows.map((row) => row.id);
  const moved = ids[index];
  const other = ids[target];
  if (moved === undefined || other === undefined) {
    return;
  }
  ids[index] = other;
  ids[target] = moved;
  const orders = normalizedGroupOrders(ids);
  const patch = useTerminalStatusBarPrefsStore.getState().patchItemOverride;
  for (const row of rows) {
    const nextOrder = orders[row.id];
    if (nextOrder !== undefined && nextOrder !== row.order) {
      await patch(row.id, { order: nextOrder });
    }
  }
}

function StatusBarRowView({
  index,
  row,
  rows,
}: {
  index: number;
  row: StatusBarRow;
  rows: readonly StatusBarRow[];
}) {
  const t = useT();
  const patchItemOverride = useTerminalStatusBarPrefsStore(
    (s) => s.patchItemOverride
  );
  const resetItem = useTerminalStatusBarPrefsStore((s) => s.resetItem);
  const swallow = (err: unknown) => {
    console.error("[status-bar-settings] update failed:", err);
  };
  return (
    <div
      className="flex items-center gap-2 py-1"
      data-testid={`status-bar-row-${row.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{row.title}</span>
          {row.hasOverride ? (
            <Badge variant="secondary">{t("settings.statusBar.modified")}</Badge>
          ) : null}
        </div>
        <div className="truncate font-mono text-muted-foreground text-xs">
          {row.id}
        </div>
      </div>
      <Switch
        aria-label={t("settings.statusBar.visible")}
        checked={!row.hidden}
        onCheckedChange={(checked) => {
          patchItemOverride(row.id, {
            hidden: checked ? null : true,
          }).catch(swallow);
        }}
      />
      <Button
        aria-label={t("settings.statusBar.moveUp")}
        disabled={index === 0}
        onClick={() => {
          moveWithinGroup(rows, index, -1).catch(swallow);
        }}
        size="icon-sm"
        title={t("settings.statusBar.moveUp")}
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={t("settings.statusBar.moveDown")}
        disabled={index === rows.length - 1}
        onClick={() => {
          moveWithinGroup(rows, index, 1).catch(swallow);
        }}
        size="icon-sm"
        title={t("settings.statusBar.moveDown")}
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={
          row.alignment === "left"
            ? t("settings.statusBar.moveToRight")
            : t("settings.statusBar.moveToLeft")
        }
        onClick={() => {
          patchItemOverride(row.id, {
            alignment: row.alignment === "left" ? "right" : "left",
          }).catch(swallow);
        }}
        size="icon-sm"
        title={
          row.alignment === "left"
            ? t("settings.statusBar.moveToRight")
            : t("settings.statusBar.moveToLeft")
        }
        type="button"
        variant="ghost"
      >
        <ArrowLeftRight />
      </Button>
      <Button
        aria-label={t("settings.statusBar.reset")}
        disabled={!row.hasOverride}
        onClick={() => {
          resetItem(row.id).catch(swallow);
        }}
        size="icon-sm"
        title={t("settings.statusBar.reset")}
        type="button"
        variant="ghost"
      >
        <RotateCcw />
      </Button>
    </div>
  );
}

function StatusBarGroup({
  heading,
  rows,
}: {
  heading: string;
  rows: readonly StatusBarRow[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 text-muted-foreground text-xs uppercase">
        {heading}
      </div>
      {rows.map((row, index) => (
        <StatusBarRowView index={index} key={row.id} row={row} rows={rows} />
      ))}
    </div>
  );
}

export function TerminalStatusBarBlock() {
  const t = useT();
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const prefs = useTerminalStatusBarPrefsStore((s) => s.prefs);
  const { left, right } = buildRows(plugins, prefs);
  return (
    <>
      <h2 className="mt-6 mb-2 text-base">{t("settings.statusBar.title")}</h2>
      <Card>
        <CardContent>
          <p className="mb-2 text-muted-foreground text-xs">
            {t("settings.statusBar.description")}
          </p>
          {left.length + right.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("settings.statusBar.empty")}
            </p>
          ) : (
            <>
              <StatusBarGroup
                heading={t("settings.statusBar.leftGroup")}
                rows={left}
              />
              <StatusBarGroup
                heading={t("settings.statusBar.rightGroup")}
                rows={right}
              />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
```

  注：`Button` 的 `size` 取值以 `packages/ui/src/button.tsx` 实际 variant 为准（`git-status-item.tsx` 用过 `size="xs"`；若无 `icon-sm` 用 `size="xs"` + `className="px-1"` 替代，执行时核对）。
- [ ] `src/renderer/pages/settings/components/terminal-section.tsx`：import 加 `import { TerminalStatusBarBlock } from "@/pages/settings/components/terminal-status-bar-block.tsx";`；`TerminalSection` 返回 JSX 中既有 `</Card>`（第 159 行）之后、外层 `</div>` 之前插入 `<TerminalStatusBarBlock />`。
- [ ] 跑 `pnpm check` 与 `pnpm test:unit`。
- [ ] 人工验证（`pnpm dev`，中英各过一遍——设置页切语言后复查标题/按钮文案）：
  1. 设置 → 终端：出现「状态栏」块，「左侧」组列出「工作树状态」（id `pier.worktree.status`，无「已修改」徽标；右侧组因空不渲染）。
  2. 关显示开关 → 终端状态栏立即隐藏；行出现「已修改」徽标；重开开关 → 覆盖清空（徽标消失，因 hidden 字段被清除后 override 为空走 resetItem）。
  3. 点「移到右侧」→ 终端状态栏该项跳到右下角（spacer 之后）；徽标出现；「恢复插件默认」→ 回左侧。
  4. （多项场景）临时把 git manifest 复制出第二个状态项或在 dev console 注册第二项后验证上移/下移：交换后终端状态栏顺序实时变化、`terminal-status-bar-prefs.json` 中写入 `order: 0/10`；验证完还原。
  5. 禁用 Git 插件 → 块显示空态文案「已启用插件没有声明状态栏项」；重新启用 → 行恢复且此前覆盖仍生效（覆盖保留不清理）。
  6. 退出应用重启 → 覆盖仍生效（退出 flush 链 + L1 持久化）。
- [ ] Commit：stage `src/renderer/pages/settings/components/terminal-status-bar-block.tsx src/renderer/pages/settings/components/terminal-section.tsx src/renderer/i18n/locales/en/settings.ts src/renderer/i18n/locales/zh-CN/settings.ts`，message `feat(settings): terminal status bar management block`，等用户确认后提交。

---

## Task 11 — 收尾全量验证

**Files:** 无新增/修改（只跑验证；发现问题回到对应 task 修复）。

**Interfaces:** —

**Steps:**

- [ ] 跑 `pnpm check`：typecheck + lint + depcruise + file-size 全绿（重点确认 `src/preload/index.ts` < 500 行；panel-kits → stores 无 depcruise 违规）。
- [ ] 跑 `pnpm test:unit`：全绿。
- [ ] `pnpm dev` 完整回归清单（真实 OS 输入）：
  1. 单窗口：状态栏项显示 → 右键取消勾选 → 消失 → 设置页重开 → 恢复。
  2. 双窗口：任一窗口改覆盖，另一窗口状态栏与设置块同步（`TERMINAL_STATUS_BAR_PREFS_CHANGED` 广播）。
  3. 换组 + 重排 + 恢复默认 各一次，观察 DOM 序符合「order 小靠外侧」。
  4. 完全退出应用（⌘Q）→ 检查 `~/Library/Application Support/pier*/terminal-status-bar-prefs.json` 内容与 UI 状态一致 → 重启后覆盖仍生效。
  5. 破坏性恢复：手动把该 JSON 改成非法内容 → 重启 → 状态栏回默认、文件被重置（ensureStore 路径）。
- [ ] E2E 备注：spec §6 的 Playwright 用例（右键隐藏 + 二次 launch 持久化）**不在本计划内**——右键菜单是原生 `Menu.popup`，Playwright/CDP 合成右键无法驱动原生菜单且时序失真（见项目 MEMORY「焦点类 bug 必须真实 OS 点击复现」）；持久化路径已由 Task 3 单测 + 上述人工步骤 4 覆盖。若后续要补，可绕过菜单直接经 `window.pier.terminalStatusBarPrefs` 驱动再断言重启后状态。
- [ ] 汇总变更清单给用户，讨论是否按 AGENTS.md 流程发 PR（分支操作需用户明确要求）。

---

## 附：本计划 Produces 接口总览

| 层 | 接口 | 位置 |
| --- | --- | --- |
| shared | `pluginTerminalStatusItemContributionSchema`（+`alignment?`/`order?`）、`terminalStatusItemAlignmentSchema` | `src/shared/contracts/plugin.ts` |
| shared | `terminalStatusBarItemOverrideSchema` / `terminalStatusBarPrefsSchema` / `emptyTerminalStatusBarPrefs` / `withItemOverridePatch` / `TerminalStatusBarItemOverridePatch` | `src/shared/contracts/terminal-status-bar.ts` |
| shared | `PierCommand` 三命令 `terminalStatusBar.prefs.getAll / setItemOverride / resetItem`；`PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED` | `src/shared/contracts/commands.ts`、`src/shared/ipc-channels.ts` |
| shared | `MenuItemCheckbox`（`MenuItem` union 扩展） | `src/shared/contracts/menu.ts` |
| plugins API | `RendererTerminalStatusItem`（**去 order**：`{ id; isVisible?; render }`） | `src/plugins/api/renderer.ts` |
| main | `createTerminalStatusBarPrefsStore(filePath)` + 默认单例 `readTerminalStatusBarPrefs / setTerminalStatusBarItemOverride / resetTerminalStatusBarItem / flushTerminalStatusBarPrefs` | `src/main/state/terminal-status-bar-prefs.ts` |
| main | `PierCoreServices.terminalStatusBarPrefs`（getAll/setItemOverride/resetItem，写路径 resolve 前广播） | `src/main/app-core/command-router-services.ts` / `app-core.ts` |
| preload | `window.pier.terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI`（getAll/setItemOverride/resetItem/onChanged） | `src/preload/terminal-status-bar-api.ts` |
| renderer store | `useTerminalStatusBarPrefsStore`（`{ initialized; prefs }` + `patchItemOverride`/`resetItem`）、`initTerminalStatusBarPrefs()` | `src/renderer/stores/terminal-status-bar-prefs.store.ts` |
| renderer 纯函数 | `mergeTerminalStatusItems` / `resolveEffectiveTerminalStatusItemConfig` / `compareOuterFirst` / `declaredTerminalStatusItemsById` / `normalizedGroupOrders` | `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts` |
| renderer 组件 | `useTerminalStatusBarItems()`、分组版 `visibleTerminalStatusItems` / `hasVisibleTerminalStatusItems`、分组渲染 `TerminalStatusBar` | `src/renderer/panel-kits/terminal/terminal-status-bar.tsx` |
| renderer 交互 | `openTerminalStatusBarContextMenu(event)`；`useSettingsDialogStore.openSection(section)`；`TerminalStatusBarBlock` | `terminal-status-bar-menu.ts`、`settings-dialog.store.ts`、`terminal-status-bar-block.tsx` |
| i18n | `terminal.statusBar.manage`；`settings.statusBar.*`（en + zh-CN） | `src/renderer/i18n/locales/{en,zh-CN}/{terminal,settings}.ts` |
