# Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 pier 原生右键菜单系统，初期覆盖 dockview tab 右键 + terminal panel 内容区右键，并把 `actionRegistry.surfaces` 暴露成"插件 contribution 接口"，让后续 panel-kit 自助贡献菜单项（不改基础设施）。

**Architecture:** 三层协作：
1. **Renderer**：`buildMenuEntries(surface, args)` 从 `actionRegistry.list(surface)` 投影菜单条目，按 `metadata.group` 字典序自动分段加 separator，从 `keybindingRegistry.getBindingsFor` 反查快捷键 hint。
2. **IPC**：`window.pier.menu.popup(template, options)` 把模板传给 main 进程 Zod 校验后 `Menu.popup({ window, x, y })` 弹原生菜单，菜单关闭时 resolve 选中的 `actionId`（或 `null`）。
3. **触发**：dockview tab 用自定义 `defaultTabComponent` 走 React `onContextMenu`；terminal panel 因为 NSView 吞事件，走 swift `NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown)` 拦截 + N-API ThreadSafeFunction → main → IPC 通知 renderer。

**Tech Stack:** Electron `Menu.popup` + zod 4 + N-API ThreadSafeFunction + Swift NSEvent local monitor + dockview-react `defaultTabComponent` + i18next

**Scope:** Phase 1 覆盖 surface `dockview-tab` 与 `terminal/content`，最小 action 集合（关闭/关闭其他/关闭所有/拆分/新建终端/重置布局）。Copy/Paste/Clear 等需要 Ghostty SDK 配合的 terminal action 留 Phase 2。

**插件 contribution 接口（Phase 1 形态）**：
- 第三方/后续 panel-kit 在自身模块内调 `actionRegistry.register({ id: "pier.<kit>.<name>", surfaces: ["<kit>/<surface>", ...], ... })`
- `metadata.group` + `metadata.sortOrder` 决定菜单内位置
- 主程序不感知具体 kit，零侵入

---

## File Structure

新建：
- `src/shared/contracts/menu.ts` — MenuTemplate / MenuPopupOptions / MenuPopupResult 跨进程共享类型
- `src/main/menu/template-schema.ts` — zod schema：深度/数量/role 白名单
- `src/main/menu/template-schema.test.ts` — zod schema 单元测试
- `src/main/ipc/menu.ts` — `pier:menu:popup` handler
- `src/renderer/lib/context-menu/build-entries.ts` — `buildMenuEntries(surface, args)`：actionRegistry 投影 + group 分段 + 快捷键反查
- `src/renderer/lib/context-menu/build-entries.test.ts` — 单元测试
- `src/renderer/lib/context-menu/use-context-menu.ts` — React hook：onContextMenu handler
- `src/renderer/components/workspace/panel-tab-header.tsx` — dockview 自定义 tab 组件
- `src/renderer/panel-kits/terminal/register-actions.ts` — terminal panel 的 actions（surface=terminal/content）

修改：
- `src/renderer/lib/actions/types.ts` — `ActionMetadata` 加 `group?: string`
- `src/renderer/lib/actions/panel-actions.ts` — 现有 actions 加 group / 新增 close/closeOthers/closeAll/splitRight/splitDown 5 个 dockview-tab actions
- `src/renderer/lib/actions/config-actions.ts` — 回填 group
- `src/renderer/lib/actions/command-palette-action.ts` — 回填 group
- `src/renderer/lib/actions/settings-actions.ts` — 回填 group
- `src/renderer/main.tsx` — 加 `registerTerminalActions()` 调用
- `src/renderer/stores/workspace.store.ts` — 加 `closePanel(panelId)` / `closeOthers(panelId)` / `closeAll()` / `splitPanel(panelId, direction)`
- `src/renderer/components/workspace/workspace-host.tsx` — 加 `defaultTabComponent={PanelTabHeader}`
- `src/renderer/panel-kits/terminal/terminal-panel.tsx` — 订阅 `onContextMenuRequest` IPC，触发 popup
- `src/preload/index.ts` — 加 `PierMenuAPI` + `terminal.onContextMenuRequest`
- `src/main/index.ts` — 注册 `registerMenuIpc`
- `src/main/ipc/terminal.ts` — 注册 mouse forward callback + 转发 IPC
- `src/renderer/i18n/locales/zh-cn.ts` + `en.ts` — 新增 menu action / category 翻译
- `native/Sources/GhosttyBridge/GhosttyBridge.swift` — `EventRouterView` 加 `attachMouseRouting` / `routeRightMouseDown` + C ABI export
- `native/src/addon.mm` — 加 mouse forward N-API binding (ThreadSafeFunction)

---

## Surface 命名约定

| Surface ID | 来源 | 触发 | 说明 |
|---|---|---|---|
| `command-palette` | 已存在 | — | 命令面板（不动） |
| `dockview-tab` | 本 plan 新增 | React `onContextMenu` on tab | 所有 panel 的 tab 右键共用此 surface |
| `terminal/content` | 本 plan 新增 | swift mouse monitor → IPC | terminal panel 内容区右键 |
| 未来 `<kit>/<sub>` | 后续 panel-kit | panel-kit 自实现 | 命名格式：kit-id 前缀 + 子区域 |

---

## Group 命名约定

数字前缀字典序：

| Group | 用途示例 |
|---|---|
| `navigation` | 永远第一（VSCode 保留约定） |
| `1_<x>` ~ `8_<x>` | 中间段（如 `1_modification`、`2_split`） |
| `9_close` | 关闭类 |
| `9_other` | **未指定时的默认值**（中后段） |
| `z_<x>` | 永远末尾（如 `z_debug`、`z_dev`） |

不同 group 之间渲染自动插 separator；同 group 内按 `metadata.sortOrder` 升序。

---

### Task 1: Action 类型加 `group` 字段 + 回填现有 actions

**Goal:** 给 `ActionMetadata` 加 `group?` 字段（默认 `"9_other"`），不破坏现有 actions。

**Files:**
- Modify: `src/renderer/lib/actions/types.ts:7-11`
- Modify: `src/renderer/lib/actions/panel-actions.ts`
- Modify: `src/renderer/lib/actions/config-actions.ts`
- Modify: `src/renderer/lib/actions/command-palette-action.ts`
- Modify: `src/renderer/lib/actions/settings-actions.ts`

- [ ] **Step 1: 类型加 `group` 字段**

修改 `src/renderer/lib/actions/types.ts`：

```ts
/**
 * Action 域 model. Action 只描述"能做什么", Keybinding 描述"怎么触发".
 * 二者一对多, 通过 commandId 字符串关联.
 */
import type { LucideIcon } from "lucide-react";

export interface ActionMetadata {
  /**
   * 菜单/命令面板内分段 key. 不同 group 之间渲染时自动插 separator;
   * 同 group 内按 sortOrder 升序. 字典序排列, 数字前缀控制大段顺序:
   *   - "navigation"   永远第一 (VSCode 保留)
   *   - "1_*" ~ "8_*"  中间段
   *   - "9_close"      关闭类
   *   - "9_other"      未指定时默认
   *   - "z_*"          永远末尾
   * 缺省视作 "9_other".
   */
  group?: string;
  iconComponent?: LucideIcon;
  keywords?: readonly string[];
  sortOrder?: number;
}

export interface Action {
  category: string;
  enabled?: () => boolean;
  handler: () => void | Promise<void>;
  id: string;
  metadata?: ActionMetadata;
  /** 命令面板 / 右键菜单 surface 列表。空数组 = 仅快捷键触发，不在任何 surface 展示。 */
  surfaces?: readonly (string & {})[];
  /** 返回当前 locale 下的显示文本; 函数式以便随 i18n 实时更新。 */
  title: () => string;
}
```

- [ ] **Step 2: 回填 `panel-actions.ts` 现有 5 个 action 的 group**

修改 `src/renderer/lib/actions/panel-actions.ts`，5 个 register 调用的 metadata 块加 `group`：

```ts
// pier.panel.closeActive
actionRegistry.register({
  category: "Panel",
  enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
  handler: () => useWorkspaceStore.getState().closeActivePanel(),
  id: "pier.panel.closeActive",
  metadata: { group: "9_close" },
  surfaces: [],
  title: () => "Close Active Panel",
})

// pier.panel.newTab
actionRegistry.register({
  category: "Panel",
  enabled: () => useWorkspaceStore.getState().api != null,
  handler: () => useWorkspaceStore.getState().addTab(),
  id: "pier.panel.newTab",
  metadata: { group: "1_new" },
  surfaces: [],
  title: () => "New Tab",
})

// pier.panel.newTerminal
actionRegistry.register({
  category: "Panel",
  enabled: () => useWorkspaceStore.getState().api != null,
  handler: () => useWorkspaceStore.getState().addTerminal(),
  id: "pier.panel.newTerminal",
  metadata: { group: "1_new" },
  surfaces: [],
  title: () => "New Terminal",
})

// pier.window.newWindow
actionRegistry.register({
  category: "Window",
  handler: () => {
    createWindow().catch((err) => {
      console.error("[actions] newWindow failed:", err);
    });
  },
  id: "pier.window.newWindow",
  metadata: { group: "1_new" },
  surfaces: [],
  title: () => "New Window",
})

// pier.workspace.resetLayout — 在已有 metadata 内补 group
metadata: {
  group: "z_workspace",
  iconComponent: RotateCcw,
  keywords: ["reset", "layout", "重置", "布局", "panel", "面板"],
  sortOrder: 6,
},
```

- [ ] **Step 3: 回填 `config-actions.ts` 中 3 个 action**

修改 `src/renderer/lib/actions/config-actions.ts`：在 `pier.config.theme` / `pier.config.stylePreset` / `pier.config.locale` 的 metadata 内各加 `group: "5_appearance"`（前两个）和 `group: "5_appearance"`（locale 也归此组），保持与命令面板已有显示顺序一致。

```ts
// pier.config.theme metadata
metadata: {
  group: "5_appearance",
  iconComponent: Palette,
  sortOrder: 10,
  keywords: ["theme", "主题", "dark", "light", "深色", "浅色"],
},

// pier.config.stylePreset metadata
metadata: {
  group: "5_appearance",
  iconComponent: Paintbrush,
  sortOrder: 11,
  keywords: ["style", "风格", "theme", "preset", "配色"],
},

// pier.config.locale metadata
metadata: {
  group: "5_appearance",
  iconComponent: Languages,
  sortOrder: 20,
  keywords: ["language", "locale", "i18n", "语言"],
},
```

- [ ] **Step 4: 回填 `settings-actions.ts`**

修改 `src/renderer/lib/actions/settings-actions.ts` 内 `pier.settings.open` 的 metadata：

```ts
metadata: {
  group: "5_appearance",
  iconComponent: SlidersHorizontal,
  sortOrder: 5,
  keywords: ["settings", "preferences", "设置", "偏好"],
},
```

- [ ] **Step 5: 回填 `command-palette-action.ts`**

`pier.commandPalette.toggle` 现在没有 metadata，加：

```ts
actionRegistry.register({
  id: "pier.commandPalette.toggle",
  category: "View",
  title: () => i18next.t("commandPalette.action.toggleCommandPalette"),
  surfaces: [],
  metadata: { group: "9_other" },
  handler: () => {
    useCommandPaletteController.getState().toggle();
  },
})
```

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: PASS, 无 error

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/actions/
git commit -m "feat(actions): 加 metadata.group 字段, 回填现有 actions"
```

---

### Task 2: 共享 menu contract 类型

**Goal:** 定义 main + renderer 都用的 `MenuTemplate` / `MenuPopupOptions` 类型，放 `src/shared/contracts/`（preload narrow-import 规则允许）。

**Files:**
- Create: `src/shared/contracts/menu.ts`

- [ ] **Step 1: 创建 menu contract**

```ts
// src/shared/contracts/menu.ts
/**
 * 右键菜单跨进程类型契约. renderer 构建 MenuTemplate → preload IPC → main Zod 校验 →
 * Electron Menu.popup. 用户选中后 main resolve actionId (或 null = 关闭未选中).
 *
 * role 白名单 14 个 — Electron 原生编辑/窗口操作, 不走 actionRegistry handler.
 * 列举所有允许的 role 是为防 main 端拼 menu 时被 renderer 注入 quit/openDevTools 等
 * 高权限 role (template injection 防御).
 */
export const ALLOWED_ROLES = [
  "cut",
  "copy",
  "paste",
  "pasteAndMatchStyle",
  "selectAll",
  "undo",
  "redo",
  "delete",
  "resetZoom",
  "zoomIn",
  "zoomOut",
  "togglefullscreen",
  "minimize",
  "close",
] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export interface MenuItemSeparator {
  type: "separator";
}

export interface MenuItemRole {
  type: "role";
  role: AllowedRole;
  /** 用户可见 label, 缺省走 Electron 内置. */
  label?: string;
  enabled?: boolean;
}

export interface MenuItemAction {
  type: "action";
  /** actionRegistry.get(id) 查 handler, click 回传时用. */
  id: string;
  label: string;
  /** Electron accelerator 格式 (例: "CmdOrCtrl+Shift+P"). 仅显示, 不绑定快捷键. */
  accelerator?: string;
  enabled?: boolean;
}

export interface MenuItemSubmenu {
  type: "submenu";
  label: string;
  enabled?: boolean;
  submenu: MenuItem[];
}

export type MenuItem =
  | MenuItemSeparator
  | MenuItemRole
  | MenuItemAction
  | MenuItemSubmenu;

export type MenuTemplate = readonly MenuItem[];

/** Menu.popup 位置. 缺省由 Electron 用当前光标位置. 坐标系: BrowserWindow contentView. */
export interface MenuPopupOptions {
  x?: number;
  y?: number;
}

export interface MenuPopupResult {
  /** action id (action 项被选中) / null (用户 Esc 或点击外部关闭). role 项不回传. */
  actionId: string | null;
}

/**
 * 安全限制 — main 端 Zod 校验, 与 schema 一一对应:
 *   - top-level ≤ 50 项
 *   - submenu 深度 ≤ 5
 *   - 每层 ≤ 50 项
 *   - label / id ≤ 256 字符
 *   - accelerator ≤ 64 字符
 */
export const MENU_LIMITS = {
  topLevelMax: 50,
  submenuMaxDepth: 5,
  itemsPerLevelMax: 50,
  labelMaxLength: 256,
  idMaxLength: 256,
  acceleratorMaxLength: 64,
} as const;
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/contracts/menu.ts
git commit -m "feat(menu): 加 MenuTemplate / MenuPopupOptions 共享类型"
```

---

### Task 3: main 端 Zod schema + 单元测试

**Goal:** main 进程拒绝任何非法 / 超出限制的 MenuTemplate（防 renderer 注入 / DoS）。

**Files:**
- Create: `src/main/menu/template-schema.ts`
- Create: `src/main/menu/template-schema.test.ts`

- [ ] **Step 1: 写测试（红）**

```ts
// src/main/menu/template-schema.test.ts
import { describe, expect, it } from "vitest";
import { MenuTemplateSchema } from "./template-schema.ts";

describe("MenuTemplateSchema", () => {
  it("接受合法的 action 项", () => {
    const ok = [{ type: "action", id: "pier.x.y", label: "Do It" }];
    expect(MenuTemplateSchema.parse(ok)).toEqual(ok);
  });

  it("接受 separator + role", () => {
    const ok = [
      { type: "role", role: "copy" },
      { type: "separator" },
      { type: "action", id: "a.b", label: "X" },
    ];
    expect(() => MenuTemplateSchema.parse(ok)).not.toThrow();
  });

  it("拒绝非白名单 role", () => {
    expect(() =>
      MenuTemplateSchema.parse([{ type: "role", role: "quit" }])
    ).toThrow();
  });

  it("拒绝 top-level 超 50 项", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({
      type: "action",
      id: `x.${i}`,
      label: `Item ${i}`,
    }));
    expect(() => MenuTemplateSchema.parse(big)).toThrow();
  });

  it("拒绝深度超过 5 的 submenu", () => {
    type AnyMenuItem = unknown;
    const build = (n: number): AnyMenuItem =>
      n === 0
        ? { type: "action", id: "leaf", label: "leaf" }
        : { type: "submenu", label: `L${n}`, submenu: [build(n - 1)] };
    expect(() => MenuTemplateSchema.parse([build(6)])).toThrow();
  });

  it("拒绝 label 超过 256 字符", () => {
    const longLabel = "x".repeat(257);
    expect(() =>
      MenuTemplateSchema.parse([
        { type: "action", id: "a", label: longLabel },
      ])
    ).toThrow();
  });

  it("拒绝 accelerator 超过 64 字符", () => {
    expect(() =>
      MenuTemplateSchema.parse([
        {
          type: "action",
          id: "a",
          label: "x",
          accelerator: "x".repeat(65),
        },
      ])
    ).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test -- src/main/menu/template-schema.test.ts`
Expected: FAIL，找不到 template-schema 模块

- [ ] **Step 3: 实现 schema**

```ts
// src/main/menu/template-schema.ts
/**
 * MenuTemplate 的 zod 校验 — renderer → main IPC 的安全边界. 任何不符 schema 的
 * template 直接拒绝, 不调 Menu.popup. 限制见 MENU_LIMITS.
 */
import {
  ALLOWED_ROLES,
  MENU_LIMITS,
  type MenuItem,
  type MenuTemplate,
} from "@shared/contracts/menu.ts";
import { z } from "zod";

const labelSchema = z.string().min(1).max(MENU_LIMITS.labelMaxLength);
const idSchema = z.string().min(1).max(MENU_LIMITS.idMaxLength);
const acceleratorSchema = z
  .string()
  .max(MENU_LIMITS.acceleratorMaxLength)
  .optional();

const separatorSchema = z.object({ type: z.literal("separator") });

const roleSchema = z.object({
  type: z.literal("role"),
  role: z.enum(ALLOWED_ROLES),
  label: labelSchema.optional(),
  enabled: z.boolean().optional(),
});

const actionSchema = z.object({
  type: z.literal("action"),
  id: idSchema,
  label: labelSchema,
  accelerator: acceleratorSchema,
  enabled: z.boolean().optional(),
});

/**
 * 递归 submenu — 深度限制走显式递归层数. zod recursive lazy 不能直接限深, 用工厂函数
 * 按层 build (depth=0 为叶子层, 不允许再 submenu).
 */
function makeItemSchema(depth: number): z.ZodType<MenuItem> {
  if (depth <= 0) {
    return z.union([separatorSchema, roleSchema, actionSchema]) as z.ZodType<MenuItem>;
  }
  const submenuSchema = z.object({
    type: z.literal("submenu"),
    label: labelSchema,
    enabled: z.boolean().optional(),
    submenu: z
      .array(makeItemSchema(depth - 1))
      .max(MENU_LIMITS.itemsPerLevelMax),
  });
  return z.union([
    separatorSchema,
    roleSchema,
    actionSchema,
    submenuSchema,
  ]) as z.ZodType<MenuItem>;
}

export const MenuTemplateSchema: z.ZodType<MenuTemplate> = z
  .array(makeItemSchema(MENU_LIMITS.submenuMaxDepth))
  .max(MENU_LIMITS.topLevelMax);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm test -- src/main/menu/template-schema.test.ts`
Expected: PASS（7 个用例全过）

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/menu/
git commit -m "feat(menu): 加 MenuTemplateSchema zod 校验 + 单元测试"
```

---

### Task 4: main IPC handler `pier:menu:popup`

**Goal:** main 端接收模板 → Zod 校验 → `Menu.buildFromTemplate` → `Menu.popup` → resolve 选中的 actionId。

**Files:**
- Create: `src/main/ipc/menu.ts`
- Modify: `src/main/index.ts:10-15`（import + register）

- [ ] **Step 1: 创建 IPC handler**

```ts
// src/main/ipc/menu.ts
/**
 * pier:menu:popup IPC — renderer 通过 contextBridge 提交 MenuTemplate, main 在
 * BrowserWindow 上弹原生菜单. resolve 返回用户选中的 actionId (action 项) 或 null
 * (Esc / 点击外部 / role 项).
 *
 * 安全: 任何 schema 不合法的 template 立即 reject, 不调 Menu.popup; role 仅允许
 * ALLOWED_ROLES 白名单, 防 renderer 注入 quit 等高权限操作.
 *
 * 时序: Menu.popup 是同步弹出 + 异步响应, 用 menu-will-close 事件标识菜单消失,
 * 通过 click 闭包捕获选中的 actionId. setImmediate resolve 让 close 后的 OS
 * 焦点回归先完成, 再 resolve renderer 端 Promise.
 */
import type {
  MenuItem as PierMenuItem,
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import {
  BrowserWindow,
  type IpcMain,
  Menu,
  type MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
import { MenuTemplateSchema } from "../menu/template-schema.ts";

function toMenuItem(
  item: PierMenuItem,
  onPicked: (id: string) => void
): MenuItemConstructorOptions {
  if (item.type === "separator") {
    return { type: "separator" };
  }
  if (item.type === "role") {
    return {
      role: item.role,
      label: item.label,
      enabled: item.enabled ?? true,
    };
  }
  if (item.type === "submenu") {
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      submenu: item.submenu.map((child) => toMenuItem(child, onPicked)),
    };
  }
  // action
  return {
    label: item.label,
    accelerator: item.accelerator,
    enabled: item.enabled ?? true,
    click: (_menuItem: MenuItem) => {
      onPicked(item.id);
    },
  };
}

export function registerMenuIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:menu:popup",
    async (
      event,
      rawTemplate: unknown,
      rawOptions: unknown
    ): Promise<MenuPopupResult> => {
      let template: MenuTemplate;
      try {
        template = MenuTemplateSchema.parse(rawTemplate);
      } catch (err) {
        console.error("[menu] template schema rejected:", err);
        return { actionId: null };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return { actionId: null };
      }

      // options 可选 — undefined / null 走 Electron 默认 (光标位置).
      const options: MenuPopupOptions =
        rawOptions && typeof rawOptions === "object"
          ? (rawOptions as MenuPopupOptions)
          : {};

      return new Promise<MenuPopupResult>((resolve) => {
        let pickedId: string | null = null;
        const items = template.map((item) =>
          toMenuItem(item, (id) => {
            pickedId = id;
          })
        );
        const menu = Menu.buildFromTemplate(items);
        // menu-will-close 在用户选中 (click 已经 fire) 或关闭 (Esc / 外部点击) 后触发.
        // setImmediate 让 click handler 先 run 完, pickedId 才反映真实选择.
        menu.on("menu-will-close", () => {
          setImmediate(() => resolve({ actionId: pickedId }));
        });
        const popupOpts: { window: BrowserWindow; x?: number; y?: number } = {
          window: win,
        };
        if (typeof options.x === "number" && typeof options.y === "number") {
          popupOpts.x = Math.round(options.x);
          popupOpts.y = Math.round(options.y);
        }
        menu.popup(popupOpts);
      });
    }
  );
}
```

- [ ] **Step 2: 注册到 main bootstrap**

修改 `src/main/index.ts`，在 import 区加 `registerMenuIpc`，在 `app.whenReady().then(...)` 内的 IPC 注册块加调用：

```ts
import { registerMenuIpc } from "./ipc/menu.ts";
// ... 其他 import

// app.whenReady().then(...) 内:
registerWindowIpc(ipcMain);
registerPreferencesIpc(ipcMain);
registerTerminalIpc(ipcMain);
registerThemeIpc(ipcMain);
registerWorkspaceIpc(ipcMain);
registerMenuIpc(ipcMain);  // ← 加这行
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/menu.ts src/main/index.ts
git commit -m "feat(menu): main 进程注册 pier:menu:popup IPC handler"
```

---

### Task 5: preload 暴露 `window.pier.menu.popup`

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 加 PierMenuAPI 类型 + 实现**

修改 `src/preload/index.ts`：

1. 在文件头部 import 区加：
```ts
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
```

2. 在 `PierKeybindingAPI` 接口下方加：

```ts
export interface PierMenuAPI {
  popup: (
    template: MenuTemplate,
    options?: MenuPopupOptions
  ) => Promise<MenuPopupResult>;
}
```

3. 在 `PierWindowAPI` 接口加 `menu` 字段：

```ts
export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  createWindow: () => Promise<{ windowId: string }>;
  focusWindow: (windowId: string) => Promise<void>;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  menu: PierMenuAPI;  // ← 加这行
  platform: NodeJS.Platform;
  preferences: PierPreferencesAPI;
  terminal: TerminalAPI;
  theme: PierThemeAPI;
  workspace: PierWorkspaceAPI;
}
```

4. 在 `workspaceApi` 后加 `menuApi` 实现：

```ts
const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};
```

5. 在 `const api: PierWindowAPI = { ... }` 内加：

```ts
const api: PierWindowAPI = {
  // ... 现有字段
  menu: menuApi,  // ← 加这行
  // ...
};
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(menu): preload 暴露 window.pier.menu.popup"
```

---

### Task 6: `buildMenuEntries` 函数（带单元测试）

**Goal:** 纯函数 `buildMenuEntries(surface, args?)`：从 `actionRegistry.list(surface)` 投影，按 `metadata.group` 字典序分段（自动 separator），同 group 内按 `sortOrder` 升序，反查 `keybindingRegistry` 加 accelerator。

**Files:**
- Create: `src/renderer/lib/context-menu/build-entries.ts`
- Create: `src/renderer/lib/context-menu/build-entries.test.ts`

- [ ] **Step 1: 写测试（红）**

```ts
// src/renderer/lib/context-menu/build-entries.test.ts
//
// Test isolation 策略: actionRegistry 是单例无 clear() — 每个用例用 **唯一 surface
// 字符串** (test/empty, test/single, ...) 让 list(surface) 只返回本用例的 actions.
// 测试间 register 残留不互相影响.
import { describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { buildMenuEntries } from "./build-entries.ts";

describe("buildMenuEntries", () => {
  it("空 surface 返回空数组", () => {
    expect(buildMenuEntries("test/empty")).toEqual([]);
  });

  it("单 group 内按 sortOrder 升序, 无 separator", () => {
    actionRegistry.register({
      id: "t.a",
      category: "T",
      title: () => "A",
      surfaces: ["test/single"],
      metadata: { group: "1_x", sortOrder: 2 },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.b",
      category: "T",
      title: () => "B",
      surfaces: ["test/single"],
      metadata: { group: "1_x", sortOrder: 1 },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/single");
    expect(entries.map((e) => (e.type === "action" ? e.id : e.type))).toEqual([
      "t.b",
      "t.a",
    ]);
  });

  it("不同 group 之间插 separator (group 字典序)", () => {
    actionRegistry.register({
      id: "t.first",
      category: "T",
      title: () => "First",
      surfaces: ["test/two-groups"],
      metadata: { group: "1_a" },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.second",
      category: "T",
      title: () => "Second",
      surfaces: ["test/two-groups"],
      metadata: { group: "9_z" },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/two-groups");
    expect(entries.map((e) => e.type)).toEqual([
      "action",
      "separator",
      "action",
    ]);
  });

  it("无 group 视作 9_other (落到中后段)", () => {
    actionRegistry.register({
      id: "t.no-group",
      category: "T",
      title: () => "NoGroup",
      surfaces: ["test/no-group"],
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.first",
      category: "T",
      title: () => "First",
      surfaces: ["test/no-group"],
      metadata: { group: "1_first" },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.last",
      category: "T",
      title: () => "Last",
      surfaces: ["test/no-group"],
      metadata: { group: "z_last" },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/no-group");
    const ids = entries
      .filter((e) => e.type === "action")
      .map((e) => (e.type === "action" ? e.id : ""));
    expect(ids).toEqual(["t.first", "t.no-group", "t.last"]);
  });

  it("enabled() 函数结果写到 entry.enabled", () => {
    actionRegistry.register({
      id: "t.disabled",
      category: "T",
      title: () => "Disabled",
      surfaces: ["test/enabled"],
      enabled: () => false,
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/enabled");
    expect(entries[0]).toMatchObject({ type: "action", enabled: false });
  });

  it("有 keybinding 时反查 accelerator (Electron 格式)", () => {
    actionRegistry.register({
      id: "t.with-key",
      category: "T",
      title: () => "WithKey",
      surfaces: ["test/key"],
      handler: () => undefined,
    });
    keybindingRegistry.registerDefaults([
      { commandId: "t.with-key", keys: "Mod+KeyK", scope: "global" },
    ]);
    const entries = buildMenuEntries("test/key");
    const a = entries[0];
    expect(a.type === "action" && a.accelerator).toBe("CmdOrCtrl+K");
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm test -- src/renderer/lib/context-menu/build-entries.test.ts`
Expected: FAIL（模块未实现）

- [ ] **Step 3: 实现 buildMenuEntries + toElectronAccelerator helper**

```ts
// src/renderer/lib/context-menu/build-entries.ts
/**
 * 从 actionRegistry 把 surface 上的 actions 投影成 MenuTemplate.
 *
 * 分段算法 (VSCode 风格):
 *   1. 按 metadata.group 分组 (缺省 "9_other"), group 字典序排
 *   2. 不同 group 之间插 separator
 *   3. 同 group 内按 metadata.sortOrder 升序 (缺省 0), 同 sortOrder 按 title 字典序
 *
 * 快捷键 hint: 反查 keybindingRegistry.getBindingsFor(action.id), 取第一个 chord,
 * 用 toElectronAccelerator 转 Electron 格式 (仅显示, 不绑定; 实际触发在 web keymap 路径).
 */
import type { MenuItem, MenuTemplate } from "@shared/contracts/menu.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import type { KeyChord } from "@/lib/keybindings/types.ts";

const DEFAULT_GROUP = "9_other";

const CODE_TO_ELECTRON: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Delete",
  Enter: "Return",
  Equal: "=",
  Escape: "Escape",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

/**
 * KeyChord → Electron accelerator 字符串. KeyboardEvent.code 编码 → Electron 期待的
 * "CmdOrCtrl+Shift+K" / "Down" 风格. KeyN/KeyP 等去掉 Key 前缀; Digit1 → "1".
 */
export function toElectronAccelerator(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.cmdOrCtrl) {
    parts.push("CmdOrCtrl");
  }
  if (chord.alt) {
    parts.push("Alt");
  }
  if (chord.shift) {
    parts.push("Shift");
  }
  let key: string;
  if (chord.code.startsWith("Key")) {
    key = chord.code.slice(3);
  } else if (chord.code.startsWith("Digit")) {
    key = chord.code.slice(5);
  } else {
    key = CODE_TO_ELECTRON[chord.code] ?? chord.code;
  }
  parts.push(key);
  return parts.join("+");
}

function groupOf(a: Action): string {
  return a.metadata?.group ?? DEFAULT_GROUP;
}

function sortOrderOf(a: Action): number {
  return a.metadata?.sortOrder ?? 0;
}

export function buildMenuEntries(
  surface: string,
  _args?: Record<string, unknown>
): MenuTemplate {
  const actions = actionRegistry.list(surface);
  if (actions.length === 0) {
    return [];
  }

  // 按 group 收集
  const buckets = new Map<string, Action[]>();
  for (const a of actions) {
    const g = groupOf(a);
    const list = buckets.get(g) ?? [];
    list.push(a);
    buckets.set(g, list);
  }

  // group 字典序排
  const sortedGroups = Array.from(buckets.keys()).sort();

  const items: MenuItem[] = [];
  for (const [idx, g] of sortedGroups.entries()) {
    if (idx > 0) {
      items.push({ type: "separator" });
    }
    const bucket = buckets.get(g) ?? [];
    bucket.sort((a, b) => {
      const so = sortOrderOf(a) - sortOrderOf(b);
      if (so !== 0) {
        return so;
      }
      return a.title().localeCompare(b.title());
    });
    for (const a of bucket) {
      const binding = keybindingRegistry.getBindingsFor(a.id)[0];
      const accelerator = binding
        ? toElectronAccelerator(binding.chord)
        : undefined;
      const enabled = a.enabled?.() ?? true;
      items.push({
        type: "action",
        id: a.id,
        label: a.title(),
        accelerator,
        enabled,
      });
    }
  }

  return items;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm test -- src/renderer/lib/context-menu/build-entries.test.ts`
Expected: PASS（6 个用例全过）

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/context-menu/
git commit -m "feat(menu): buildMenuEntries 按 group 分段 + accelerator 反查"
```

---

### Task 7: `useContextMenu` hook

**Goal:** React hook 暴露 `onContextMenu` handler — 一行集成给 surface 的 React 组件用。

**Files:**
- Create: `src/renderer/lib/context-menu/use-context-menu.ts`

- [ ] **Step 1: 实现 hook**

```ts
// src/renderer/lib/context-menu/use-context-menu.ts
/**
 * 给 React 组件提供 onContextMenu handler — 阻止浏览器默认菜单, 调 main popup,
 * dispatch 选中的 action.
 *
 * usage:
 *   const onContextMenu = useContextMenu("dockview-tab", { panelId });
 *   <div onContextMenu={onContextMenu}>...</div>
 *
 * args 透传给 action.handler 暂未启用 (Action.handler 当前签名是 () => void).
 * 后续要让 action 知道 target panelId 时, 把 args 通过 closure 或 context 传给 handler.
 * Phase 1 的 actions 都用 store.getState() 读 active panel 决策, 不需 args.
 */
import { type MouseEvent, useCallback } from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "./build-entries.ts";

export interface UseContextMenuOptions {
  /**
   * 自定义触发坐标 — 默认用 React event.clientX / clientY (BrowserWindow 内坐标).
   * 来自 swift 转发的右键事件需要由调用方提前转好坐标传入.
   */
  getCoords?: (event: MouseEvent) => { x: number; y: number };
}

export function useContextMenu(
  surface: string,
  _args?: Record<string, unknown>,
  options?: UseContextMenuOptions
): (event: MouseEvent) => void {
  return useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const coords = options?.getCoords?.(event) ?? {
        x: event.clientX,
        y: event.clientY,
      };
      void popupAndDispatch(surface, coords);
    },
    [surface, options]
  );
}

/**
 * 不在 React tree 内时 (例 swift 转发的右键) 直接调用: 不需要 hook 上下文,
 * 同样的逻辑给坐标 + surface 即可弹菜单.
 */
export async function popupContextMenuAt(
  surface: string,
  coords: { x: number; y: number }
): Promise<void> {
  await popupAndDispatch(surface, coords);
}

async function popupAndDispatch(
  surface: string,
  coords: { x: number; y: number }
): Promise<void> {
  const template = buildMenuEntries(surface);
  if (template.length === 0) {
    return;
  }
  let result;
  try {
    result = await window.pier.menu.popup(template, coords);
  } catch (err) {
    console.error(`[menu] popup ${surface} failed:`, err);
    return;
  }
  if (!result.actionId) {
    return;
  }
  const action = actionRegistry.get(result.actionId);
  if (!action) {
    console.warn(
      `[menu] action ${result.actionId} not found (registered after menu open?)`
    );
    return;
  }
  if (action.enabled?.() === false) {
    return;
  }
  try {
    await action.handler();
  } catch (err) {
    console.error(`[menu] action ${result.actionId} threw:`, err);
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/context-menu/use-context-menu.ts
git commit -m "feat(menu): useContextMenu hook + popupContextMenuAt 函数"
```

---

### Task 8: workspace store 加 panel 操作方法

**Goal:** 给 store 加 `closePanel(panelId)` / `closeOthers(panelId)` / `closeAll()` / `splitPanel(panelId, direction)`，被新的 dockview-tab actions 调用。

**Files:**
- Modify: `src/renderer/stores/workspace.store.ts`

- [ ] **Step 1: 扩展 WorkspaceState 接口**

修改 `src/renderer/stores/workspace.store.ts`，在 `WorkspaceState` 接口加 4 个方法签名（保持其余不变）：

```ts
interface WorkspaceState {
  addPanel: (opts: { id: string; title: string; component: string }) => void;
  addTab: () => void;
  addTerminal: () => void;
  api: DockviewApi | null;
  closeActivePanel: () => void;
  closeAll: () => void;
  closeOthers: (panelId: string) => void;
  closePanel: (panelId: string) => void;
  resetLayout: () => Promise<void>;
  setApi: (api: DockviewApi | null) => void;
  splitPanel: (panelId: string, direction: "right" | "below") => void;
}
```

- [ ] **Step 2: 实现 closePanel / closeOthers / closeAll**

在 `create<WorkspaceState>((set, get) => ({ ... }))` 内 `closeActivePanel` 之后加：

```ts
closePanel: (panelId) => {
  const api = get().api;
  if (!api) {
    return;
  }
  const panel = api.panels.find((p) => p.id === panelId);
  if (!panel) {
    return;
  }
  // 同 closeActivePanel: 主动先发 terminal close IPC, 再 removePanel
  if (panel.view.contentComponent === "terminal") {
    window.pier?.terminal?.close?.(panel.id);
  }
  api.removePanel(panel);
},

closeOthers: (panelId) => {
  const api = get().api;
  if (!api) {
    return;
  }
  const keepPanel = api.panels.find((p) => p.id === panelId);
  if (!keepPanel) {
    return;
  }
  // 复制数组防遍历过程中 mutate. terminal panel 先发 close IPC.
  const toClose = api.panels.filter((p) => p.id !== panelId);
  for (const p of toClose) {
    if (p.view.contentComponent === "terminal") {
      window.pier?.terminal?.close?.(p.id);
    }
    api.removePanel(p);
  }
},

closeAll: () => {
  const api = get().api;
  if (!api) {
    return;
  }
  const all = [...api.panels];
  for (const p of all) {
    if (p.view.contentComponent === "terminal") {
      window.pier?.terminal?.close?.(p.id);
    }
    api.removePanel(p);
  }
},
```

- [ ] **Step 3: 实现 splitPanel**

接着加：

```ts
splitPanel: (panelId, direction) => {
  const api = get().api;
  if (!api) {
    return;
  }
  const panel = api.panels.find((p) => p.id === panelId);
  if (!panel) {
    return;
  }
  // 用源 panel 同 component + 新建唯一 id; terminal 类共享前缀, welcome 同理.
  const component = panel.view.contentComponent;
  const prefix = component === "terminal" ? "terminal" : component;
  const newId = `${prefix}-${Date.now()}`;
  api.addPanel({
    id: newId,
    component,
    title: panel.title,
    position: {
      referencePanel: panel.id,
      direction,
    },
  });
},
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/workspace.store.ts
git commit -m "feat(workspace): store 加 closePanel/closeOthers/closeAll/splitPanel"
```

---

### Task 9: dockview-tab actions（5 个新 + 1 个已有复用）

**Goal:** 注册 5 个 actions（close / closeOthers / closeAll / splitRight / splitDown），surface=`dockview-tab`。复用现有 `pier.panel.newTerminal`、`pier.workspace.resetLayout`。

**Files:**
- Modify: `src/renderer/lib/actions/panel-actions.ts`

注意：当前 `Action.handler` 签名是 `() => void | Promise<void>`，**handler 拿不到 target panelId**。Phase 1 简化方案：右键 tab 的 5 个 close/split action 操作 `api.activePanel`（右键 tab 时 dockview 会先把该 tab 设为 active，再触发 onContextMenu）。这与 vscode tab 右键行为一致。

- [ ] **Step 1: 加 5 个 tab actions**

修改 `src/renderer/lib/actions/panel-actions.ts`，在 `registerPanelActions()` 的 disposers 数组末尾（`pier.workspace.resetLayout` 之前）加：

```ts
// ─── dockview-tab surface actions ───────────────────────────────────
// 右键 tab 时 dockview 先把该 tab 设为 activePanel (onPointerDown), 再 fire
// onContextMenu — 所以 handler 用 activePanel 等价于"右键的那个 tab".
disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
    handler: () => {
      const api = useWorkspaceStore.getState().api;
      const p = api?.activePanel;
      if (p) {
        useWorkspaceStore.getState().closePanel(p.id);
      }
    },
    id: "pier.panel.close",
    metadata: { group: "9_close", sortOrder: 1 },
    surfaces: ["dockview-tab"],
    title: () => i18next.t("contextMenu.action.closePanel"),
  })
);

disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => {
      const api = useWorkspaceStore.getState().api;
      return api != null && api.panels.length > 1;
    },
    handler: () => {
      const api = useWorkspaceStore.getState().api;
      const p = api?.activePanel;
      if (p) {
        useWorkspaceStore.getState().closeOthers(p.id);
      }
    },
    id: "pier.panel.closeOthers",
    metadata: { group: "9_close", sortOrder: 2 },
    surfaces: ["dockview-tab"],
    title: () => i18next.t("contextMenu.action.closeOthers"),
  })
);

disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => {
      const api = useWorkspaceStore.getState().api;
      return api != null && api.panels.length > 0;
    },
    handler: () => useWorkspaceStore.getState().closeAll(),
    id: "pier.panel.closeAll",
    metadata: { group: "9_close", sortOrder: 3 },
    surfaces: ["dockview-tab"],
    title: () => i18next.t("contextMenu.action.closeAll"),
  })
);

disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
    handler: () => {
      const api = useWorkspaceStore.getState().api;
      const p = api?.activePanel;
      if (p) {
        useWorkspaceStore.getState().splitPanel(p.id, "right");
      }
    },
    id: "pier.panel.splitRight",
    metadata: { group: "2_split", sortOrder: 1 },
    surfaces: ["dockview-tab"],
    title: () => i18next.t("contextMenu.action.splitRight"),
  })
);

disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
    handler: () => {
      const api = useWorkspaceStore.getState().api;
      const p = api?.activePanel;
      if (p) {
        useWorkspaceStore.getState().splitPanel(p.id, "below");
      }
    },
    id: "pier.panel.splitDown",
    metadata: { group: "2_split", sortOrder: 2 },
    surfaces: ["dockview-tab"],
    title: () => i18next.t("contextMenu.action.splitDown"),
  })
);
```

- [ ] **Step 2: 给 pier.panel.newTerminal 加 `dockview-tab` surface**

修改 `pier.panel.newTerminal` 的 `surfaces`：

```ts
surfaces: ["dockview-tab"],
```

并更新 `metadata`：

```ts
metadata: { group: "1_new", sortOrder: 1 },
```

让"新建终端"出现在右键菜单顶部。

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/actions/panel-actions.ts
git commit -m "feat(menu): 加 5 个 dockview-tab actions (close/split/closeOthers...)"
```

---

### Task 10: i18n keys 加 menu action 翻译

**Files:**
- Modify: `src/renderer/i18n/locales/zh-cn.ts:73-80`
- Modify: `src/renderer/i18n/locales/en.ts:73-80`

- [ ] **Step 1: zh-cn.ts 加 contextMenu 节**

修改 `src/renderer/i18n/locales/zh-cn.ts`，在 `commandPalette` 节之后（`} as const;` 之前）加：

```ts
  contextMenu: {
    action: {
      closePanel: "关闭",
      closeOthers: "关闭其他",
      closeAll: "关闭所有",
      splitRight: "向右拆分",
      splitDown: "向下拆分",
      newTerminal: "新建终端",
    },
  },
```

并把 `commandPalette.action` 块加 newTerminal key 来兼容（如果命令面板将来也要显示）：

```ts
    action: {
      // ... 已有
      newTerminal: "新建终端",
    },
```

- [ ] **Step 2: en.ts 同步**

修改 `src/renderer/i18n/locales/en.ts`：

```ts
  contextMenu: {
    action: {
      closePanel: "Close",
      closeOthers: "Close Others",
      closeAll: "Close All",
      splitRight: "Split Right",
      splitDown: "Split Down",
      newTerminal: "New Terminal",
    },
  },
```

并在 `commandPalette.action` 节加 `newTerminal: "New Terminal"`。

- [ ] **Step 3: typecheck（i18n 类型自动同步两个 locale）**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/
git commit -m "feat(i18n): 加 contextMenu.action 中英翻译"
```

---

### Task 11: PanelTabHeader 自定义 tab + dockview 集成

**Goal:** 自定义 `defaultTabComponent` 把 React `onContextMenu` 接上 `dockview-tab` surface。

**Files:**
- Create: `src/renderer/components/workspace/panel-tab-header.tsx`
- Modify: `src/renderer/components/workspace/workspace-host.tsx:150-160`

- [ ] **Step 1: 创建 PanelTabHeader 组件**

```tsx
// src/renderer/components/workspace/panel-tab-header.tsx
/**
 * Dockview 自定义 tab 组件 — 接管 onContextMenu, 弹 surface="dockview-tab" 菜单.
 *
 * 不传 getTabContextMenuItems 给 DockviewReact: dockview 内置 contextmenu listener
 * 在没传该 prop 时 early-return 不 preventDefault, 事件冒泡到这里的 onContextMenu
 * (dockview-react@6.6.1, components/tab/tab.js:116 + contextMenu.js:118-132).
 *
 * 右键 → 显式 setActive 确保 actions 拿到的 activePanel 就是被右键的 tab. dockview
 * onPointerDown 在 contextmenu 之前 fire 时本会顺带激活, 但 macOS 上鼠标右键的
 * pointerdown→contextmenu 顺序与 dockview tab 内部 setActive 触发条件未必每次都满
 * (单 group 内已 active 的 tab 上再右键不会重新 setActive, 但行为也无需变更, 安全).
 *
 * 样式: 用 dockview 默认 `.dv-default-tab` class 维持 hover/active 状态. 若样式与
 * 改前不一致, inspect DOM 取 dockview 实际默认 tab 的 class 对齐.
 */
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { type MouseEvent, useCallback } from "react";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const baseOnContextMenu = useContextMenu("dockview-tab", {
    panelId: props.api.id,
  });
  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      props.api.setActive();
      baseOnContextMenu(event);
    },
    [baseOnContextMenu, props.api]
  );
  return (
    <div className="dv-default-tab" onContextMenu={onContextMenu}>
      <span className="dv-default-tab-content">{props.api.title}</span>
    </div>
  );
}
```

- [ ] **Step 2: workspace-host.tsx 加 defaultTabComponent**

修改 `src/renderer/components/workspace/workspace-host.tsx`：

1. 顶部 import 加：
```ts
import { PanelTabHeader } from "./panel-tab-header.tsx";
```

2. `<DockviewReact ... />` 调用加 `defaultTabComponent={PanelTabHeader}`：

```tsx
<DockviewReact
  components={panelComponents}
  defaultTabComponent={PanelTabHeader}
  leftHeaderActionsComponent={AddPanelAction}
  onReady={handleReady}
  theme={pierTheme}
/>
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 手测**

Run: `pnpm dev`
检验：
- ✅ tab 上右键 → 出现原生菜单（"关闭"/"关闭其他"/"关闭所有"/"向右拆分"/"向下拆分"/"新建终端"），含快捷键 hint
- ✅ 关闭/拆分等操作生效
- ✅ tab 视觉与改前一致（label / hover 状态）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/workspace/panel-tab-header.tsx src/renderer/components/workspace/workspace-host.tsx
git commit -m "feat(menu): dockview tab 自定义 + 右键弹原生菜单"
```

---

### Task 12: Swift 端 mouse forward callback + monitor

**Goal:** swift `EventRouterView` 加 `.rightMouseDown` 监听，命中 terminal target rect 时 forward `(windowId, panelId, x, y)` 给 main，事件被消费（return nil）阻止 Ghostty SDK 自处理。

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`

- [ ] **Step 1: EventRouterView 加 forwardRightMouseCallback static var + mouseMonitor 字段**

修改 `EventRouterView` 类，在 `forwardCmdKeyCallback` 之后加：

```swift
/// Right-mouse 转发: 用户在 terminal 区域右键 → main → renderer → 弹原生菜单.
/// 签名 (browserWindowId, panelId, contentX, contentY) — 坐标系是 BrowserWindow
/// 的 contentView (top-left origin, flipped), 即 Electron renderer 内坐标, 也是
/// Electron Menu.popup({x,y}) 期待的格式.
static var forwardRightMouseCallback: ((Int, String, Double, Double) -> Void)?
```

在 `keyMonitor` 字段下方加：

```swift
private var mouseMonitor: Any?
```

- [ ] **Step 2: 扩展 attachKeyboardRouting → 同时挂 mouse monitor**

把 `attachKeyboardRouting(window:browserWindowId:)` 改成 `attachInputRouting`（含 keyboard + mouse）。修改方法体：

```swift
/// 在 setupWindow 后调用一次, 绑定 window 并安装 keyboard + mouse 监听.
/// browserWindowId 来自 Electron BrowserWindow.id, forward 时回传给 main 路由.
func attachInputRouting(window: NSWindow, browserWindowId: Int) {
    ownerWindow = window
    self.browserWindowId = browserWindowId
    if keyMonitor == nil {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) {
            [weak self] event in
            guard let self else { return event }
            return self.routeKeyDown(event)
        }
    }
    if mouseMonitor == nil {
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) {
            [weak self] event in
            guard let self else { return event }
            return self.routeRightMouseDown(event)
        }
    }
}
```

更新 `detachKeyboardRouting` → `detachInputRouting`：

```swift
func detachInputRouting() {
    if let monitor = keyMonitor {
        NSEvent.removeMonitor(monitor)
        keyMonitor = nil
    }
    if let monitor = mouseMonitor {
        NSEvent.removeMonitor(monitor)
        mouseMonitor = nil
    }
    ownerWindow = nil
}
```

`deinit` 内同步加 mouseMonitor 清理：

```swift
deinit {
    if let monitor = keyMonitor {
        NSEvent.removeMonitor(monitor)
    }
    if let monitor = mouseMonitor {
        NSEvent.removeMonitor(monitor)
    }
}
```

- [ ] **Step 3: 实现 routeRightMouseDown**

在 `routeKeyDown` 后添加：

```swift
/// 路由 rightMouseDown:
/// - 非 owner window: 放行
/// - 不在任何 terminal target rect 内: 放行 (空白区 / web panel 让 React onContextMenu 处理)
/// - 在 terminal rect 内: forward (windowId, panelId, x, y) 给 main, 消费事件
private func routeRightMouseDown(_ event: NSEvent) -> NSEvent? {
    guard let window = ownerWindow, event.window === window else { return event }
    // 把 window 坐标转 EventRouterView 局部坐标 (与 hitTest 同套坐标变换);
    // EventRouterView.isFlipped=true 让 local 坐标系是 top-left origin, 跟 Electron
    // BrowserWindow contentView 一致, 可直接给 main 做 Menu.popup({x,y}).
    let local = self.convert(event.locationInWindow, from: nil)
    for (panelId, target) in targets {
        if target.rect.contains(local) {
            EventRouterView.forwardRightMouseCallback?(
                browserWindowId, panelId, Double(local.x), Double(local.y)
            )
            return nil  // 消费, 不让 terminal NSView 收到右键
        }
    }
    return event
}
```

- [ ] **Step 4: 替换 attachKeyboardRouting / detachKeyboardRouting 现有调用**

在 `GhosttyBridgeImpl.setupWindow` 内找到 `router.attachKeyboardRouting(...)` 行，改为：

```swift
router.attachInputRouting(window: parent, browserWindowId: browserWindowId)
```

在 `detachWindow(parent:)` 内找到 `router.detachKeyboardRouting()` 行，改为：

```swift
router.detachInputRouting()
```

- [ ] **Step 5: 加 setMouseForwardCallback method**

在 `GhosttyBridgeImpl` 内 `setKeyboardForwardCallback` 之后加：

```swift
/// 注册右键事件 forward callback. 与 keyboard 同构: swift EventRouterView 拦到
/// terminal 区域 rightMouseDown 后, 通过此 callback 把 (windowId, panelId, x, y)
/// 转给 main, main IPC 通知 renderer 弹菜单.
func setMouseForwardCallback(_ cb: @escaping (Int, String, Double, Double) -> Void) {
    EventRouterView.forwardRightMouseCallback = cb
}
```

- [ ] **Step 6: 加 C ABI export**

在文件末尾 `ghostty_bridge_set_keyboard_forward_callback` 之后加：

```swift
/// C 函数指针: (browserWindowId, panelId C string, x, y).
public typealias MouseForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, Double, Double) -> Void

@_cdecl("ghostty_bridge_set_mouse_forward_callback")
public func ghosttyBridgeSetMouseForwardCallback(_ cb: MouseForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            GhosttyBridgeImpl.shared.setMouseForwardCallback { wid, panelId, x, y in
                panelId.withCString { ptr in cb(wid, ptr, x, y) }
            }
        } else {
            GhosttyBridgeImpl.shared.setMouseForwardCallback { _, _, _, _ in }
        }
    }
}
```

- [ ] **Step 7: 重 build native addon**

Run: `pnpm --filter "@pier/native" run build`（或项目根的 native build 命令；查 package.json scripts 找到对应入口，通常是 `pnpm build:native` 或 `node-gyp rebuild` 包装）

注意：如果不确定确切命令，跑 `pnpm dev` 时 native 模块会按需触发重 build；这里独立 build 是为了快速验证 swift 编译通过。

Expected: 编译成功，生成 `native/build/Release/ghostty_native.node`

- [ ] **Step 8: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "feat(native): swift 加 rightMouseDown 路由 + forward callback"
```

---

### Task 13: addon.mm 加 mouse forward N-API binding

**Files:**
- Modify: `native/src/addon.mm`

- [ ] **Step 1: extern "C" 声明**

修改 `native/src/addon.mm`，在 `KeyboardForwardFn` typedef 之后加：

```cpp
typedef void (*MouseForwardFn)(long browserWindowId, const char* panelId, double x, double y);
void ghostty_bridge_set_mouse_forward_callback(MouseForwardFn cb);
```

- [ ] **Step 2: 加 ThreadSafeFunction + trampoline**

在 `JsSetKeyboardForwardCallback` 之后加：

```cpp
// ---- Right-mouse forward callback (swift → main JS) ----
//
// 同 keyboard forward 模式: swift NSEvent monitor 命中 terminal 区域右键时调
// trampoline, ThreadSafeFunction 把 (windowId, panelId, x, y) 转到 JS 线程.
static Napi::ThreadSafeFunction g_mouseTSFN;

struct MouseForwardPayload {
    long windowId;
    std::string panelId;
    double x;
    double y;
};

static void g_mouseForwardTrampoline(long windowId, const char* panelId, double x, double y) {
    if (!g_mouseTSFN) return;
    auto* payload = new MouseForwardPayload{ windowId, std::string(panelId), x, y };
    auto status = g_mouseTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, MouseForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::String::New(env, p->panelId),
            Napi::Number::New(env, p->x),
            Napi::Number::New(env, p->y),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetMouseForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_mouseTSFN) {
            g_mouseTSFN.Release();
            g_mouseTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_mouse_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_mouseTSFN) g_mouseTSFN.Release();
    g_mouseTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierMouseForward", 0, 1);
    ghostty_bridge_set_mouse_forward_callback(&g_mouseForwardTrampoline);
    return env.Undefined();
}
```

- [ ] **Step 3: Init 块加 export**

修改 `Init` 函数末尾（`setActivePanelKind` export 之后）：

```cpp
exports.Set("setMouseForwardCallback", Napi::Function::New(env, JsSetMouseForwardCallback));
```

- [ ] **Step 4: 重 build native addon**

Run: 与 Task 12 Step 7 相同命令
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add native/src/addon.mm
git commit -m "feat(native): addon.mm 加 setMouseForwardCallback N-API binding"
```

---

### Task 14: main 进程注册 mouse callback + IPC 转发

**Goal:** main 启动时注册 mouse forward callback，收到后查到正确 BrowserWindow，`webContents.send("pier:terminal:request-context-menu", { panelId, x, y })`。

**Files:**
- Modify: `src/main/ipc/terminal.ts:8-43`（NativeAddon interface 加方法）
- Modify: `src/main/ipc/terminal.ts:71-102`（registerTerminalIpc 注册 callback）

- [ ] **Step 1: NativeAddon interface 加 setMouseForwardCallback**

修改 `src/main/ipc/terminal.ts` 的 `NativeAddon` interface（在 `setKeyboardForwardCallback` 之后）：

```ts
setMouseForwardCallback(
  cb:
    | ((browserWindowId: number, panelId: string, x: number, y: number) => void)
    | null
): void;
```

- [ ] **Step 2: registerTerminalIpc 注册 mouse callback**

修改 `src/main/ipc/terminal.ts` 的 `registerTerminalIpc`，在 `addon?.setKeyboardForwardCallback(...)` 块之后加：

```ts
// Right-mouse forward: swift NSEvent monitor 命中 terminal 区域时调到这里, 通过
// windowId 找 BrowserWindow, send IPC 通知 renderer 弹菜单. 与 keyboard forward
// 同构 — 不能用 getFocusedWindow (swift monitor 跨线程 + 多窗口下不准).
addon?.setMouseForwardCallback((browserWindowId, panelId, x, y) => {
  try {
    const targetWindow = BrowserWindow.fromId(browserWindowId);
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const wc = targetWindow.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    wc.send("pier:terminal:request-context-menu", { panelId, x, y });
  } catch (err) {
    console.error("[pier-mouse-forward] send failed:", err);
  }
});
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/terminal.ts
git commit -m "feat(menu): main 注册 mouse forward → 发 pier:terminal:request-context-menu"
```

---

### Task 15: preload + TerminalAPI 加 `onContextMenuRequest`

**Goal:** renderer 通过 `window.pier.terminal.onContextMenuRequest(cb)` 订阅终端右键请求。

**Files:**
- Modify: `src/shared/contracts/terminal.ts:18-31`
- Modify: `src/preload/index.ts:76-90`

- [ ] **Step 1: TerminalAPI 接口加 onContextMenuRequest**

修改 `src/shared/contracts/terminal.ts`：

```ts
export interface TerminalContextMenuRequest {
  panelId: string;
  /** BrowserWindow contentView 坐标 (top-left origin, flipped). */
  x: number;
  y: number;
}

export interface TerminalAPI {
  close(panelId: string): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  focus(panelId: string): void;
  hide(panelId: string): void;
  /** 订阅 swift 转发的右键事件. 返回 unsubscribe. */
  onContextMenuRequest: (
    cb: (req: TerminalContextMenuRequest) => void
  ) => () => void;
  setActivePanelKind: (
    kind: "terminal" | "web",
    panelId: string | null
  ) => void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setup(): Promise<CreateTerminalResult>;
  show(panelId: string): void;
}
```

- [ ] **Step 2: preload 实现**

修改 `src/preload/index.ts` 的 `terminalApi` 对象，在末尾加：

```ts
const terminalApi: TerminalAPI = {
  close: (panelId) => ipcRenderer.invoke("pier:terminal:close", panelId),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  focus: (panelId) => ipcRenderer.send("pier:terminal:focus", panelId),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  onContextMenuRequest: (cb) => {
    const listener = (
      _event: unknown,
      req: { panelId: string; x: number; y: number }
    ) => {
      cb(req);
    };
    ipcRenderer.on("pier:terminal:request-context-menu", listener);
    return () => {
      ipcRenderer.off("pier:terminal:request-context-menu", listener);
    };
  },
  setActivePanelKind: (kind, panelId) =>
    ipcRenderer.send("pier:terminal:set-active-panel-kind", kind, panelId),
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  setOverlayActive: (active) =>
    ipcRenderer.send("pier:terminal:set-overlay", active),
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  show: (panelId) => ipcRenderer.send("pier:terminal:show", panelId),
};
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/contracts/terminal.ts src/preload/index.ts
git commit -m "feat(menu): preload 加 terminal.onContextMenuRequest 订阅"
```

---

### Task 16: terminal panel actions（`terminal/content` surface）

**Goal:** 注册 terminal panel 右键菜单的 minimal actions（Phase 1 范围）：新建终端 / 关闭当前 / 重置布局。Copy/Paste/Clear 留 Phase 2（需 Ghostty SDK 配合）。

**Files:**
- Create: `src/renderer/panel-kits/terminal/register-actions.ts`
- Modify: `src/renderer/main.tsx:31-36`

- [ ] **Step 1: 创建 terminal panel actions**

```ts
// src/renderer/panel-kits/terminal/register-actions.ts
/**
 * Terminal panel-kit 自有 actions — surface="terminal/content" 投影到终端内右键菜单.
 *
 * 这是 "panel-kit 作为后续插件" 的样板: kit 自己 import actionRegistry, 在自己模块
 * 内 register, 主程序 bootstrap 调一次 registerTerminalActions(). 未来第三方 kit
 * 同样模式 (panel-kits/<name>/register-actions.ts), 不需改 main.tsx.
 *
 * Phase 1 只放 1 个 kit 独有 action (close terminal); newTerminal / resetLayout 在
 * panel-actions.ts 内通过 surfaces 数组扩到 "terminal/content" 直接复用, 不在此文件
 * 重复注册. copy / paste / clear 等需要 Ghostty SDK 配合的操作留 Phase 2.
 */
import i18next from "i18next";
import { X } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function registerTerminalActions(): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => useWorkspaceStore.getState().closeActivePanel(),
      id: "pier.terminal.close",
      metadata: { group: "9_close", iconComponent: X, sortOrder: 1 },
      surfaces: ["terminal/content"],
      title: () => i18next.t("contextMenu.action.closeTerminal"),
    })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
```

- [ ] **Step 2: 给 pier.panel.newTerminal 加 terminal/content surface**

修改 `src/renderer/lib/actions/panel-actions.ts` 的 `pier.panel.newTerminal`：

```ts
disposers.push(
  actionRegistry.register({
    category: "Panel",
    enabled: () => useWorkspaceStore.getState().api != null,
    handler: () => useWorkspaceStore.getState().addTerminal(),
    id: "pier.panel.newTerminal",
    metadata: { group: "1_new", iconComponent: Plus, sortOrder: 1 },
    surfaces: ["dockview-tab", "terminal/content"],
    title: () => i18next.t("contextMenu.action.newTerminal"),
  })
);
```

注意：title 改为 i18n key（之前是硬编码 "New Terminal"）。需要 import `Plus` 与 `i18next`（i18next 已 import）。

也给 `pier.workspace.resetLayout` 加 `terminal/content` surface 让终端右键也能重置布局：

```ts
// 修改 pier.workspace.resetLayout 的 surfaces
surfaces: ["command-palette", "terminal/content"],
```

- [ ] **Step 3: i18n keys 加 closeTerminal**

修改 `src/renderer/i18n/locales/zh-cn.ts` 的 `contextMenu.action`：

```ts
contextMenu: {
  action: {
    closePanel: "关闭",
    closeOthers: "关闭其他",
    closeAll: "关闭所有",
    closeTerminal: "关闭终端",
    splitRight: "向右拆分",
    splitDown: "向下拆分",
    newTerminal: "新建终端",
  },
},
```

`en.ts`：

```ts
contextMenu: {
  action: {
    closePanel: "Close",
    closeOthers: "Close Others",
    closeAll: "Close All",
    closeTerminal: "Close Terminal",
    splitRight: "Split Right",
    splitDown: "Split Down",
    newTerminal: "New Terminal",
  },
},
```

- [ ] **Step 4: main.tsx 调 registerTerminalActions**

修改 `src/renderer/main.tsx`：

1. import 加：
```ts
import { registerTerminalActions } from "./panel-kits/terminal/register-actions.ts";
```

2. bootstrap 内 (其他 register 调用之后) 加：
```ts
registerConfigActions();
registerCommandPaletteAction();
registerPanelActions();
registerSettingsActions();
registerTerminalActions();  // ← 加这行
keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
```

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panel-kits/terminal/register-actions.ts src/renderer/lib/actions/panel-actions.ts src/renderer/i18n/ src/renderer/main.tsx
git commit -m "feat(menu): 加 terminal/content surface actions + i18n"
```

---

### Task 17: terminal-panel 订阅 IPC + 触发 popup

**Goal:** terminal-panel.tsx 启动时订阅 `onContextMenuRequest`，收到匹配自身 panelId 的请求时调 `popupContextMenuAt('terminal/content', { x, y })`。

**Files:**
- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx:52-159`

- [ ] **Step 1: 加 useEffect 订阅 onContextMenuRequest**

修改 `src/renderer/panel-kits/terminal/terminal-panel.tsx`：

1. 顶部 import 加：
```ts
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
```

2. 在现有 `useEffect(() => { ... }, [api, panelId])` （管理 terminal lifecycle 的那个）**之后**加一个新的独立 useEffect：

```tsx
// 订阅 swift 转发的右键: panel 的 NSView 吞掉 React 层 onContextMenu, 唯一拿到
// 右键的方式是 swift NSEvent monitor 拦截 + IPC 转发. 这里按 panelId 过滤 (一个
// terminal panel 的菜单只该响应它自己的右键).
useEffect(() => {
  const unsubscribe = window.pier?.terminal?.onContextMenuRequest?.(
    (req) => {
      if (req.panelId !== panelId) {
        return;
      }
      void popupContextMenuAt("terminal/content", { x: req.x, y: req.y });
    }
  );
  return () => {
    unsubscribe?.();
  };
}, [panelId]);
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/panel-kits/terminal/terminal-panel.tsx
git commit -m "feat(menu): terminal-panel 订阅 swift 转发右键 → 弹原生菜单"
```

---

### Task 18: 端到端验证（typecheck + lint + 手测 6 场景）

**Goal:** 完整跑 check + dev 验证 6 个场景符合预期。如有 regression 立即修复并补单测。

**Files:** 无（验证为主）

- [ ] **Step 1: 跑 full check**

Run: `pnpm check`
Expected: PASS（typecheck + biome + depcruise + file-size 全过）

如有 dependency-cruiser 报错（renderer panel-kit 跨域 import / dockview 边界违反），定位违规 import 后修正：terminal panel-kit 内的 register-actions 只 import actionRegistry / workspace store / i18next，不应触发 cruiser 规则。

- [ ] **Step 2: 跑单元测试**

Run: `pnpm test:unit`
Expected: 所有测试 PASS（含本 plan 新加的 schema + build-entries 测试）

- [ ] **Step 3: 手测场景 1 — dockview tab 右键基础**

启 `pnpm dev`，在 tab 上右键：
- ✅ 弹出原生菜单（mac 上是系统圆角，跟随当前 light/dark）
- ✅ 菜单顺序：新建终端 → separator → 向右拆分/向下拆分 → separator → 关闭/关闭其他/关闭所有
- ✅ 快捷键 hint 在右侧（"新建终端" 显示 `⌃\``，"关闭" 不显示 hint 因为它没绑全局快捷键）
- ✅ 点击"关闭" → 该 tab 消失
- ✅ 点击"向右拆分" → 同 panel 类型在右侧出现新实例
- ✅ Esc 关菜单 → 返回 web 焦点正常，按 Cmd+T 仍能新建 tab（无 keydown 双触发）

- [ ] **Step 4: 手测场景 2 — terminal panel 内容区右键**

在终端内容区域右键：
- ✅ 弹出原生菜单（顺序：新建终端 → separator → 关闭终端 → separator → 重置布局）
- ✅ 菜单弹出位置在鼠标点击点附近
- ✅ 点击"新建终端" → 同 group 内出现第二个终端 tab
- ✅ 点击"关闭终端" → 当前终端 panel 关闭
- ✅ Esc 关菜单 → 终端焦点恢复，按字符能输入

- [ ] **Step 5: 手测场景 3 — 多窗口隔离**

按 Cmd+N 开第二个窗口，在 window-A 终端右键弹菜单时：
- ✅ window-B 的终端不受影响（forward callback 按 windowId 路由）
- ✅ window-A 菜单内点击不会影响 window-B 的 panel

- [ ] **Step 6: 手测场景 4 — 菜单 disabled 状态**

在只剩 1 个 panel 时右键 tab：
- ✅ "关闭其他" 显示 disabled（灰色不可点）— enabled() 返回 false 的反映
- ✅ "关闭所有" 可点（关掉所有 panel 后**自动关窗口** — 与 closePanel/closeActivePanel 最后一个 panel 时的行为对称, 防留空 dockview 用户无路可走）

- [ ] **Step 7: 手测场景 5 — i18n 切换**

命令面板里切语言到英语：
- ✅ 右键菜单的所有 label 立即变英语（Action.title() 函数式）
- ✅ separator / accelerator 格式不变
- 切回中文同样验证

- [ ] **Step 8: 手测场景 6 — keyboard routing 未被破坏**

菜单关闭后立即测：
- ✅ Cmd+T 新建 tab — 正常
- ✅ Cmd+Shift+P 命令面板 — 正常
- ✅ 终端按 Cmd+\` 新建终端 — 正常
- ✅ Esc 在终端中按下 — 不会误触发任何 web 端 handler（确认无 keydown 双触发）

- [ ] **Step 9: 如有任何 regression**

定位问题：
- 菜单不弹 → 检查 main `pier:menu:popup` log，确认 schema 校验通过
- terminal 右键无响应 → swift 日志（`Console.app` 过滤 pier）+ 检查 forward callback 是否注册
- 快捷键 hint 错 → 检查 `toElectronAccelerator` 测试，对照 KeyChord 输出

补充单测覆盖发现的边界，commit fix 后回 Step 1 重跑。

- [ ] **Step 10: 最终 Commit 验证记录**

把场景 1-6 的手测结果填入 `docs/superpowers/specs/2026-06-23-context-menu-design.md`（如未创建则不要求；本 plan 是 plan-only 实施，验证结果 commit message 描述即可）：

```bash
git add -u
git commit -m "test(menu): 6 个核心场景 user 手测全过, ready to merge"
```

---

## 完成检查清单

- [ ] Task 1 — Action 类型加 group + 回填
- [ ] Task 2 — 共享 menu contract
- [ ] Task 3 — Zod schema + 单测
- [ ] Task 4 — main IPC handler
- [ ] Task 5 — preload menu API
- [ ] Task 6 — buildMenuEntries + 单测
- [ ] Task 7 — useContextMenu hook
- [ ] Task 8 — workspace store 加 panel 操作
- [ ] Task 9 — dockview-tab 5 个新 actions
- [ ] Task 10 — i18n keys
- [ ] Task 11 — PanelTabHeader + workspace-host 集成
- [ ] Task 12 — swift mouse forward
- [ ] Task 13 — addon.mm N-API binding
- [ ] Task 14 — main 注册 mouse callback
- [ ] Task 15 — preload onContextMenuRequest
- [ ] Task 16 — terminal panel actions + i18n + main.tsx bootstrap
- [ ] Task 17 — terminal-panel 订阅 IPC
- [ ] Task 18 — 端到端验证

---

## 后续 Phase 2 待办

1. **Terminal copy / paste / clear / select-all**：需要 Ghostty SDK 暴露 selection 与 paste 接口；clear 可走 PTY 写入 `\x1bc` 但需要 swift 端中转
2. **真正的插件 manifest**：当前 panel-kit 在主程序 import 时同步注册 actions，未来支持 panel-kit dynamic import + manifest JSON 时把 `registerTerminalActions()` 改为 PanelKit.activate(ctx) 形态
3. **`when` clause DSL**：当前 `enabled?: () => boolean` 是 imperative 函数，未来如需 declarative when 表达式（参考 vscode）再加 mini-parser
4. **submenu 渲染**：`buildMenuEntries` 目前不生成 `submenu` 项；如需要"风格"等 picker 进 submenu，扩展 `Action.metadata.submenu()` 与 `buildMenuEntries` 的分段逻辑
5. **tab area 空白区右键**：dockview 不给 hook，需要在 `workspace-host.tsx` 容器上 event delegation 监听 `contextmenu` + `target.closest('.dv-void-container')`
6. **`headerComponent` 替换**：dockview tab 右键已覆盖；如需 group header（多 tab 顶部条）也加右键菜单，用 `headerComponent` 同样模式
