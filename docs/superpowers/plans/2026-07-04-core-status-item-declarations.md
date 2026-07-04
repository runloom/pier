# Core 状态栏项声明注册表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `core.agent-status` 与插件声明项在同一份管理 UI(右键菜单/设置页)里并列,通过引入 core-owned 状态栏项静态声明注册表,统一被三处 UI 数据源消费。

**Architecture:** 新增一份 renderer 侧静态常量数组 `CORE_TERMINAL_STATUS_ITEMS`(类型放 shared/contracts),三个既有数据源函数(`declaredTerminalStatusItemsById` / `declaredRows` / `buildRows`)新增 `coreItems` 参数,遍历时 core 先入 map、同 id 时 core 优先。运行时 register 端(`agent-status-item.tsx`)去掉硬编码字面量,`id` 改用声明表常量、`order` 删除(合并层已忽略运行时对象的 order)。

**Tech Stack:** TypeScript 6 strict · React 19 · Vitest 4 · Zustand 5 · i18next

## Global Constraints

- 不 auto-commit:参照 `AGENTS.md` §05 安全边界,每个 task 结尾跑对应验证命令即可,commit 由用户在全部完成后统一决策
- 不 mock 数据库:本 plan 不涉及数据库/IPC 集成,主要为 renderer 纯函数与组件测试
- Biome + Ultracite:所有新代码遵循既有格式;不要用 `@ts-ignore` / `as any` 压制类型
- id 保留:`core.agent-status` 不改名(用户已有 prefs 兼容)
- Core 优先规则:同 id 时 core 声明优先,plugin 声明跳过(防止插件抢占 core id)
- 三处数据源必须同步改:合并层(`declaredTerminalStatusItemsById`)、右键菜单(`declaredRows`)、设置页(`buildRows`)——任一漏改都会导致 UI 数据不一致
- 底层 prefs 覆盖管道不动:`prefs.items[id]` 索引已经天然支持任意 id;不需要动 `terminal-status-bar-prefs.ts`(main)或 `TerminalStatusBarPrefs` schema(shared)

---

## File Structure

**新增(1)**:
- `src/renderer/panel-kits/terminal/core-terminal-status-items.ts` — core 声明常量数组 + `CORE_AGENT_STATUS_ITEM_ID` 常量

**修改(9)**:
- `src/shared/contracts/terminal-status-bar.ts` — 新增 `CoreTerminalStatusItemDeclaration` 类型
- `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts` — `declaredTerminalStatusItemsById` 加 `coreItems` 参数,core 优先规则
- `src/renderer/panel-kits/terminal/terminal-status-bar.tsx` — 两处 caller 传入 `CORE_TERMINAL_STATUS_ITEMS`
- `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts` — `declaredRows` 加 `coreItems` 参数,内部 caller 传入常量
- `src/renderer/pages/settings/components/terminal-status-bar-block.tsx` — `buildRows` 加 `coreItems` 参数,内部 caller 传入常量
- `src/renderer/panel-kits/terminal/agent-status-item.tsx` — `id` 改常量,删除 `order: -10`
- `src/renderer/i18n/locales/en/terminal.ts` — 新增 `statusBar.item.agentStatus.title`
- `src/renderer/i18n/locales/zh-CN/terminal.ts` — 同上
- 测试用例更新(见各 Task 具体清单)

---

## Task 1: 契约层类型 + core 声明源常量

**Files:**
- Modify: `src/shared/contracts/terminal-status-bar.ts`(尾部追加类型)
- Create: `src/renderer/panel-kits/terminal/core-terminal-status-items.ts`

**Interfaces:**
- Consumes: 无(纯类型 + 数据)
- Produces:
  - Type `CoreTerminalStatusItemDeclaration { id: string; order?: number; alignment?: "left" | "right"; titleKey: string }` — 后续 Task 2/4/5 的参数类型
  - Const `CORE_AGENT_STATUS_ITEM_ID = "core.agent-status"` — 后续 Task 6 的 id 常量
  - Const `CORE_TERMINAL_STATUS_ITEMS: readonly CoreTerminalStatusItemDeclaration[]` — 后续 Task 3/4/5 的 caller 数据

- [ ] **Step 1: 加类型到 shared 契约**

Open `src/shared/contracts/terminal-status-bar.ts`。在文件末尾追加:

```ts
/**
 * Core-owned(非插件贡献)终端状态栏项静态声明。
 * 与 PluginTerminalStatusItemContribution 平行,同 id 冲突时 core 优先。
 * titleKey 走全局 i18next.t 解析(不复用 manifest.localization)。
 */
export interface CoreTerminalStatusItemDeclaration {
  id: string;
  order?: number;
  alignment?: "left" | "right";
  titleKey: string;
}
```

- [ ] **Step 2: 创建 core 声明源常量**

写入 `src/renderer/panel-kits/terminal/core-terminal-status-items.ts`:

```ts
import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";

export const CORE_AGENT_STATUS_ITEM_ID = "core.agent-status";

/**
 * Core-owned 状态栏项声明。目前仅 agent-status,未来任何非插件贡献的核心项
 * 都加到这里,由合并层 / 右键菜单 / 设置页三处数据源统一遍历。
 */
export const CORE_TERMINAL_STATUS_ITEMS: readonly CoreTerminalStatusItemDeclaration[] = [
  {
    id: CORE_AGENT_STATUS_ITEM_ID,
    order: -10,
    titleKey: "terminal.statusBar.item.agentStatus.title",
  },
];
```

- [ ] **Step 3: 跑 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS(仅新增导出,无既有代码 break)

---

## Task 2: 合并层 `declaredTerminalStatusItemsById` 扩展 + core 优先规则

**Files:**
- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts:58-74`
- Modify: `tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`

**Interfaces:**
- Consumes: `CoreTerminalStatusItemDeclaration`(Task 1)
- Produces:
  - `declaredTerminalStatusItemsById(plugins, coreItems)` — 后续 Task 3 的 caller 签名
  - 契约:同 id 时 core 优先 plugin 跳过

- [ ] **Step 1: 写失败测试(core-only 场景)**

Open `tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`,在文件末尾(现有 `describe("declaredTerminalStatusItemsById(F12:口径统一用 runtime.enabled)")` 块之后)追加:

```ts
import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";

describe("declaredTerminalStatusItemsById(core 声明源)", () => {
  const coreItem: CoreTerminalStatusItemDeclaration = {
    id: "core.foo",
    order: -5,
    alignment: "left",
    titleKey: "core.foo.title",
  };

  it("core 声明进入 map,与插件声明并列", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.a", { enabled: true, runtimeEnabled: true })],
      [coreItem]
    );
    expect(byId.has("core.foo")).toBe(true);
    expect(byId.has("pier.a.item")).toBe(true);
    expect(byId.get("core.foo")).toEqual({ alignment: "left", order: -5 });
  });

  it("同 id 时 core 优先,plugin 声明被跳过", () => {
    const collisionPlugin: PluginRegistryEntry = {
      ...pluginEntry("pier.collide", { enabled: true, runtimeEnabled: true }),
    };
    collisionPlugin.manifest = {
      ...collisionPlugin.manifest,
      terminalStatusItems: [
        { id: "core.foo", order: 999, permissions: [], title: "Plugin Steal" },
      ],
    };
    const byId = declaredTerminalStatusItemsById([collisionPlugin], [coreItem]);
    expect(byId.get("core.foo")).toEqual({ alignment: "left", order: -5 });
  });

  it("无 core 声明时行为等价旧签名(coreItems=[])", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.a", { enabled: true, runtimeEnabled: true })],
      []
    );
    expect(byId.size).toBe(1);
    expect(byId.has("pier.a.item")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`
Expected: FAIL,报 `declaredTerminalStatusItemsById` 签名不匹配(只接受 1 参),或运行时报参数少。

- [ ] **Step 3: 更新既有测试用例的调用点补 `coreItems=[]`**

现有测试 `terminal-status-bar-merge.test.ts:198,205` 两处 `declaredTerminalStatusItemsById([...])` 加第二个参数 `[]`:

```ts
// L198
const byId = declaredTerminalStatusItemsById(
  [pluginEntry("pier.drift", { enabled: false, runtimeEnabled: true })],
  []
);
// L205
const byId = declaredTerminalStatusItemsById(
  [pluginEntry("pier.drift", { enabled: true, runtimeEnabled: false })],
  []
);
```

- [ ] **Step 4: 修改函数签名 + 实现**

Open `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts`。改 import(顶部加类型):

```ts
import type {
  CoreTerminalStatusItemDeclaration,
  TerminalStatusBarItemOverride,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
```

替换 L58-74 的 `declaredTerminalStatusItemsById` 整段:

```ts
/** 已启用插件 manifest 声明的状态栏项 + core 声明源合并索引(设置页与合并管道共用数据源)。
 *  同 id 时 core 优先(防插件抢占 core id)。 */
export function declaredTerminalStatusItemsById(
  plugins: readonly PluginRegistryEntry[],
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): ReadonlyMap<string, PluginTerminalStatusItemContribution | DeclaredTerminalStatusItem> {
  const byId = new Map<
    string,
    PluginTerminalStatusItemContribution | DeclaredTerminalStatusItem
  >();
  // Core 先塞:同 id 时 core 优先,防止插件抢占 core id。
  for (const item of coreItems) {
    byId.set(item.id, { alignment: item.alignment, order: item.order });
  }
  for (const entry of plugins) {
    // F12:口径统一用 entry.runtime.enabled(与 runtime 激活、pluginNavItems、
    // collectEnabledConfigurationProperties 同源),而不是顶层 entry.enabled
    // (manifest/配置期望值,可能与运行时实际激活态漂移)。
    if (!entry.runtime.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      if (byId.has(item.id)) {
        continue;
      }
      byId.set(item.id, item);
    }
  }
  return byId;
}
```

**注意**:返回类型改成联合类型 `PluginTerminalStatusItemContribution | DeclaredTerminalStatusItem`。下游只依赖 `alignment` 和 `order` 字段(见 `resolveEffectiveTerminalStatusItemConfig`),联合类型仍满足 `DeclaredTerminalStatusItem` 结构。

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/renderer/panel-kits/terminal-status-bar-merge.test.ts`
Expected: PASS,包含新增 3 个 core-声明源 case + 既有全部 case。

- [ ] **Step 6: 跑全量 typecheck 验证**

Run: `pnpm typecheck`
Expected: FAIL(因为 `terminal-status-bar.tsx`、`terminal-status-bar-menu.ts` 等其他 caller 尚未补 `coreItems` 参数)——这是预期的中间态,由 Task 3-5 逐一修复。

---

## Task 3: `terminal-status-bar.tsx` caller 传入 core 常量 + F4 挂载判定测试

**Files:**
- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar.tsx:74,114`
- Modify: `tests/unit/renderer/terminal-status-items.test.tsx`(3 处既有 F4 case 断言更新)

**Interfaces:**
- Consumes: `CORE_TERMINAL_STATUS_ITEMS`(Task 1)、扩展后的 `declaredTerminalStatusItemsById`(Task 2)
- Produces: 组件层能看到 core 声明;`hasDeclaredTerminalStatusItems` 现在因 core 声明恒返回 true → 状态栏容器恒挂载(即使无插件启用、无 agent activity 也保留 h-7 高度与右键管理入口)

**背景 — 语义变化必须理解**:引入 core 声明后,`declaredTerminalStatusItemsById` 永远至少包含 `core.agent-status`,`hasDeclaredTerminalStatusItems` 恒返回 true,`shouldMountTerminalStatusBar` 恒返回 true。这意味着 F4 "零声明项不挂载"分支实际上不再触发。这是 spec §5 明确承认的期望行为(见 spec 里"这是期望行为——用户能通过右键菜单看到'Agent 状态'这一项以决定隐藏与否")。既有测试文件里 3 处断言"容器不挂载"的 case 都要改为断言"容器挂载但内容为空"。

- [ ] **Step 1: 修改既有 3 处 F4 case 的断言(仍失败)**

Open `tests/unit/renderer/terminal-status-items.test.tsx`。定位到 L126-138、L156-167、L169-181 三个 case,逐一替换。

**替换 1 (L126-138)**——把 case 名和断言改为"承认 core 声明"版本:

原:
```ts
it("hidden 覆盖过滤该项渲染;无插件声明状态项时容器整体不挂载", () => {
  terminalStatusItemRegistry.register({
    id: "test.only",
    render: () => <span>Only</span>,
  });
  setPrefs({ "test.only": { hidden: true } });

  renderBar();

  // 本测试从未往 plugin-registry.store 写入声明项,declaredTerminalStatusItemsById
  // 为空 —— 属于 F4「零声明项」分支,容器整体不挂载(与「有声明但全隐藏」区分)。
  expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
});
```

改为:
```ts
it("hidden 覆盖过滤该项渲染;core 声明恒存在使容器恒挂载(内容为空但入口保留)", () => {
  terminalStatusItemRegistry.register({
    id: "test.only",
    render: () => <span>Only</span>,
  });
  setPrefs({ "test.only": { hidden: true } });

  renderBar();

  // core 声明表恒含 core.agent-status → hasDeclaredTerminalStatusItems=true → 容器挂载。
  // test.only 因 hidden 被过滤;本测试未走 registerAgentStatusItem 故 agent-status 也不渲染。
  const bar = screen.getByTestId("terminal-status-bar");
  expect(bar).toBeInTheDocument();
  expect(bar).toHaveTextContent("");
});
```

**替换 2 (L156-167)**——把 case 名改为反映 core 声明的新语义:

原:
```ts
it("F4:零声明项(无已启用插件声明 terminalStatusItems)时容器整体不挂载", () => {
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: true,
    plugins: [],
  });

  renderBar();

  expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
});
```

改为:
```ts
it("F4:仅 core 声明时容器仍挂载(agent activity 无关)", () => {
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: true,
    plugins: [],
  });

  renderBar();

  // 无插件声明,但 core 声明恒含 core.agent-status → 容器挂载。
  const bar = screen.getByTestId("terminal-status-bar");
  expect(bar).toBeInTheDocument();
});
```

**替换 3 (L169-181)**——原 case 断言 isVisible=false 时容器不挂载,现在改为断言 isVisible 生效不影响挂载:

原(注意 L179-181 是该 case 的尾部,原完整 case 从 L169 起):
```ts
it("isVisible 动态可见性在 hidden 过滤之后仍生效(不影响挂载判定,只影响渲染内容)", () => {
  terminalStatusItemRegistry.register({
    id: "test.invisible",
    isVisible: () => false,
    render: () => <span>Invisible</span>,
  });

  renderBar();

  // 同上:未声明任何插件状态项,零声明分支容器不挂载。
  expect(screen.queryByTestId("terminal-status-bar")).toBeNull();
});
```

改为:
```ts
it("isVisible 动态可见性在 hidden 过滤之后仍生效(容器因 core 声明挂载,test.invisible 因 isVisible=false 不渲染)", () => {
  terminalStatusItemRegistry.register({
    id: "test.invisible",
    isVisible: () => false,
    render: () => <span>Invisible</span>,
  });

  renderBar();

  // core 声明恒存在,容器挂载;test.invisible 被 isVisible 过滤,不出现在 DOM。
  const bar = screen.getByTestId("terminal-status-bar");
  expect(bar).toBeInTheDocument();
  expect(bar).not.toHaveTextContent("Invisible");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-items.test.tsx`
Expected: FAIL —— `terminal-status-bar.tsx` 里 `declaredTerminalStatusItemsById(plugins)` 尚未补 `coreItems` 参数,运行时会因 for-of 遍历 undefined 而 throw(或 typecheck 直接失败);断言"容器挂载"因此走不到。

- [ ] **Step 3: 修改 `terminal-status-bar.tsx` 两处调用点**

Open `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`。在顶部 import 里追加:

```ts
import { CORE_TERMINAL_STATUS_ITEMS } from "./core-terminal-status-items.ts";
```

替换 L74 的调用:

```ts
declaredTerminalStatusItemsById(plugins, CORE_TERMINAL_STATUS_ITEMS),
```

替换 L114 的调用(在 `hasDeclaredTerminalStatusItems` 函数体内):

```ts
return declaredTerminalStatusItemsById(plugins, CORE_TERMINAL_STATUS_ITEMS).size > 0;
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-items.test.tsx`
Expected: PASS,3 处改写后的 F4 case + 既有其他 case 全部通过。

- [ ] **Step 5: 再跑一次 typecheck**

Run: `pnpm typecheck`
Expected: 仍 FAIL(menu 和 settings block 未改),预期,由 Task 4/5 逐一修复。

---

## Task 4: 右键菜单 `declaredRows` 扩展 + 测试

**Files:**
- Modify: `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts:35-64,75-78`
- Modify: `tests/unit/renderer/terminal-status-bar-menu.test.ts`

**Interfaces:**
- Consumes: `CoreTerminalStatusItemDeclaration`(Task 1)、`CORE_TERMINAL_STATUS_ITEMS`(Task 1)
- Produces: 右键菜单出现 core 声明项;`declaredRows(plugins, prefs, coreItems)` 新签名(测试直接调此函数)

- [ ] **Step 1: 写失败测试(core 声明出现在 rows)**

Open `tests/unit/renderer/terminal-status-bar-menu.test.ts`。在 `describe("declaredRows", () => {` 块内(约 L83 起)、`beforeAll` 之后追加两个 case:

```ts
it("core 声明源的项出现在 rows 里,title 走 i18next.t(titleKey)", () => {
  const rows = declaredRows(
    [],
    prefsOf(),
    [
      {
        id: "core.foo",
        titleKey: "terminal.statusBar.item.agentStatus.title", // 复用已翻译 key(Task 6 添加)
      },
    ]
  );

  expect(rows.map((row) => row.itemId)).toContain("core.foo");
});

it("同 id 时 core 优先,plugin 声明被跳过", () => {
  const rows = declaredRows(
    [
      terminalStatusItemEntry(
        "pier.a",
        [{ id: "core.foo", title: "Plugin Steal" }],
        true
      ),
    ],
    prefsOf(),
    [{ id: "core.foo", titleKey: "terminal.statusBar.item.agentStatus.title" }]
  );

  const fooRows = rows.filter((row) => row.itemId === "core.foo");
  expect(fooRows).toHaveLength(1);
  // core 走 i18next.t,plugin 走 resolvePluginTerminalStatusItemDisplay;
  // core 优先意味着不会看到 "Plugin Steal"
  expect(fooRows[0]?.title).not.toBe("Plugin Steal");
});
```

- [ ] **Step 2: 更新既有 declaredRows 调用补 `coreItems=[]`**

`terminal-status-bar-menu.test.ts` 里 L89, 109, 125, 141, 155 五处 `declaredRows(...)` 都加第三个参数 `[]`。示例(L89):

```ts
const rows = declaredRows(
  [
    terminalStatusItemEntry(
      "pier.enabled",
      [{ id: "enabled.item", title: "Enabled Item" }],
      true
    ),
    terminalStatusItemEntry(
      "pier.disabled",
      [{ id: "disabled.item", title: "Disabled Item" }],
      false
    ),
  ],
  prefsOf(),
  []
);
```

其余四处同理(每次尾部加 `[]`)。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-bar-menu.test.ts`
Expected: FAIL — `declaredRows` 签名不匹配。

- [ ] **Step 4: 修改 `terminal-status-bar-menu.ts`**

Open `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts`。顶部 import 追加:

```ts
import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";
import { CORE_TERMINAL_STATUS_ITEMS } from "./core-terminal-status-items.ts";
```

替换 L35-64 的 `declaredRows` 整段:

```ts
/** 导出供单测直接覆盖(过滤 disabled 插件 / 按 title 排序 / hidden 生效值解析)。
 *  Core 声明源与 plugin manifest 声明源合并,同 id 时 core 优先。 */
export function declaredRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs,
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): DeclaredItemRow[] {
  const locale = i18next.language || "en";
  const rows: DeclaredItemRow[] = [];
  const seen = new Set<string>();

  for (const item of coreItems) {
    const config = resolveEffectiveTerminalStatusItemConfig(
      { alignment: item.alignment, order: item.order },
      prefs.items[item.id]
    );
    rows.push({
      hidden: config.hidden,
      itemId: item.id,
      title: i18next.t(item.titleKey),
    });
    seen.add(item.id);
  }

  for (const entry of plugins) {
    // F12:与 merge.ts / terminal-status-bar-block.tsx 同口径,用
    // entry.runtime.enabled(实际运行时激活态)而非顶层 entry.enabled。
    if (!entry.runtime.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      if (seen.has(item.id)) {
        continue;
      }
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
```

替换 L75-78 的 `openTerminalStatusBarContextMenu` 内调用(补 `CORE_TERMINAL_STATUS_ITEMS`):

```ts
const rows = declaredRows(
  usePluginRegistryStore.getState().plugins,
  useTerminalStatusBarPrefsStore.getState().prefs,
  CORE_TERMINAL_STATUS_ITEMS
);
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-bar-menu.test.ts`
Expected: PASS(所有 `declaredRows` case + 新增 2 个 core case + `openTerminalStatusBarContextMenu` 弹菜单 case 全部通过)。

---

## Task 5: 设置页管理块 `buildRows` 扩展 + 测试

**Files:**
- Modify: `src/renderer/pages/settings/components/terminal-status-bar-block.tsx:47-86,267-271`
- Modify: `tests/unit/renderer/terminal-status-bar-block.test.tsx`

**Interfaces:**
- Consumes: `CoreTerminalStatusItemDeclaration`(Task 1)、`CORE_TERMINAL_STATUS_ITEMS`(Task 1)
- Produces: 设置页管理块出现 core 声明行,可开关/上下移/切左右/reset

- [ ] **Step 1: 读现有测试文件确定风格**

Read: `tests/unit/renderer/terminal-status-bar-block.test.tsx` L1-70(setup)以确保新增 case 用同一个 helper 风格。

- [ ] **Step 2: 写失败测试(core 声明行出现在设置页)**

在该测试文件的 `describe("TerminalStatusBarBlock", () => {` 块内追加:

```ts
it("core 声明源的项出现在设置页管理块(即使无任何插件启用)", async () => {
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: true,
    plugins: [],
  });
  useTerminalStatusBarPrefsStore.setState({
    error: null,
    initialized: true,
    prefs: { items: {}, version: 1 },
  });

  render(<TerminalStatusBarBlock />);

  // Core 声明表恒有 core.agent-status,应出现一行
  expect(
    screen.getByTestId("status-bar-row-core.agent-status")
  ).toBeInTheDocument();
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-bar-block.test.tsx`
Expected: FAIL —— `buildRows` 尚未接 core 源,DOM 里找不到 `status-bar-row-core.agent-status`。

- [ ] **Step 4: 修改 `terminal-status-bar-block.tsx`**

Open `src/renderer/pages/settings/components/terminal-status-bar-block.tsx`。顶部 import 追加:

```ts
import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";
import { CORE_TERMINAL_STATUS_ITEMS } from "@/panel-kits/terminal/core-terminal-status-items.ts";
```

替换 L47-86 的 `buildRows` 整段:

```ts
function buildRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs,
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): { left: StatusBarRow[]; right: StatusBarRow[] } {
  const locale = i18next.language || "en";
  const left: StatusBarRow[] = [];
  const right: StatusBarRow[] = [];
  const seen = new Set<string>();

  const pushRow = (
    id: string,
    declaredAlignment: "left" | "right" | undefined,
    declaredOrder: number | undefined,
    title: string
  ) => {
    const config = resolveEffectiveTerminalStatusItemConfig(
      { alignment: declaredAlignment, order: declaredOrder },
      prefs.items[id]
    );
    const row: StatusBarRow = {
      alignment: config.alignment,
      hasOverride: prefs.items[id] !== undefined,
      hidden: config.hidden,
      id,
      order: config.order,
      title,
    };
    if (config.alignment === "right") {
      right.push(row);
    } else {
      left.push(row);
    }
    seen.add(id);
  };

  for (const item of coreItems) {
    pushRow(item.id, item.alignment, item.order, i18next.t(item.titleKey));
  }
  for (const entry of plugins) {
    // F12:与 merge.ts / menu.ts 同口径,用 entry.runtime.enabled(实际运行时激活态)。
    if (!entry.runtime.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      if (seen.has(item.id)) {
        continue;
      }
      pushRow(
        item.id,
        item.alignment,
        item.order,
        resolvePluginTerminalStatusItemDisplay(entry.manifest, item, locale).title
      );
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  return { left, right };
}
```

替换 L271 的调用:

```ts
const { left, right } = buildRows(plugins, prefs, CORE_TERMINAL_STATUS_ITEMS);
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-bar-block.test.tsx`
Expected: PASS(新增 core case + 既有全部 case 通过)。

---

## Task 6: `agent-status-item.tsx` 清理 + i18n key

**Files:**
- Modify: `src/renderer/panel-kits/terminal/agent-status-item.tsx:94-105`
- Modify: `src/renderer/i18n/locales/en/terminal.ts:21-23`
- Modify: `src/renderer/i18n/locales/zh-CN/terminal.ts:21-23`

**Interfaces:**
- Consumes: `CORE_AGENT_STATUS_ITEM_ID`(Task 1)、i18n key `terminal.statusBar.item.agentStatus.title`(本 Task 添加)
- Produces: agent-status 硬编码字面量清除;i18n 到位使 Task 4/5 的 title 显示为可读文本

- [ ] **Step 1: 加 i18n key(en)**

Open `src/renderer/i18n/locales/en/terminal.ts`。替换 L21-23(`statusBar` 对象):

```ts
statusBar: {
  item: {
    agentStatus: {
      title: "Agent status",
    },
  },
  manage: "Manage Status Bar…",
},
```

- [ ] **Step 2: 加 i18n key(zh-CN)**

Open `src/renderer/i18n/locales/zh-CN/terminal.ts`。替换 L21-23:

```ts
statusBar: {
  item: {
    agentStatus: {
      title: "Agent 状态",
    },
  },
  manage: "管理状态栏…",
},
```

- [ ] **Step 3: 修改 `agent-status-item.tsx`**

Open `src/renderer/panel-kits/terminal/agent-status-item.tsx`。顶部 import 追加:

```ts
import { CORE_AGENT_STATUS_ITEM_ID } from "./core-terminal-status-items.ts";
```

替换 L94-105 的 `registerAgentStatusItem` 整段:

```ts
/**
 * 注册核心 agent 状态栏 item。
 * isVisible 按面板是否有 agent kind 的 activity 门控——否则每个终端都会为空状态
 * 预留状态栏高度(违反"未启用/无 agent 时零影响")。getState 为非响应式读取;
 * 响应性由调用方(foreground-activity-bridge)在 activity key 集合变化时重新
 * register 驱动。
 *
 * id 与默认 order/alignment 来自 core-terminal-status-items.ts 声明表(单一真相源);
 * 用户覆盖(hidden/order/alignment)由合并层从 prefs 读取。
 */
export function registerAgentStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: CORE_AGENT_STATUS_ITEM_ID,
    isVisible: (ctx) => {
      const activity =
        useForegroundActivityStore.getState().activities[ctx.panelId];
      return activity?.kind === "agent";
    },
    render: (ctx) => <AgentStatusItemView panelId={ctx.panelId} />,
  });
}
```

**注意**:删除了 `order: -10`(现由 core 声明表提供;合并层不看运行时对象的 order,`RendererTerminalStatusItem.order` 已为 optional)。

- [ ] **Step 4: 跑相关测试**

Run: `pnpm test:unit -- tests/unit/renderer/terminal-status-items.test.tsx tests/unit/renderer/terminal-status-bar-menu.test.ts tests/unit/renderer/terminal-status-bar-block.test.tsx`
Expected: PASS(Task 4/5 的测试如果依赖 `terminal.statusBar.item.agentStatus.title` 的 i18n 值,此时该 key 应能解析出 "Agent status" 而非返回 key 本身)。

- [ ] **Step 5: 跑全量 typecheck**

Run: `pnpm typecheck`
Expected: PASS(所有 caller 已补 `coreItems` 参数,`RendererTerminalStatusItem.order` 已 optional,无 typecheck 报错)。

---

## Task 7: 全量验证 + 手动 UI 核验

**Files:** 无代码变更

**Interfaces:** 无

- [ ] **Step 1: 全量单元测试**

Run: `pnpm test:unit`
Expected: 所有单元测试通过。

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 无错误(warning 视既有基线接受)。

- [ ] **Step 4: 依赖边界检查**

Run: `pnpm depcruise`
Expected: 无新违规。特别检查 `terminal-status-bar-block.tsx` import `panel-kits/terminal/core-terminal-status-items.ts` 不违反 `pages/settings/` → `panel-kits/` 的边界(既有 pattern 已有:见 `terminal-status-bar-block.tsx:34` import merge 层)。

- [ ] **Step 5: 完整检查**

Run: `pnpm check`
Expected: PASS(typecheck + lint + depcruise + file-size 综合)。

- [ ] **Step 6: 手动 UI 核验(需要 pnpm dev)**

Run: `pnpm dev`(如尚未起 dev server)

打开一个终端面板,分别验证:
1. **右键状态栏 → 菜单里出现 "Agent status" 勾选项**(en 语言下)。切到 zh-CN 应显示 "Agent 状态"。
2. **打开设置对话框 → 「终端 → 状态栏」管理块**,应看到 "Agent status" 行,`hidden` switch 可切、上下移按钮可用、左右切换按钮可用、reset 按钮在有 override 时可用。
3. **勾选/取消 hidden 后重启应用**,状态保留(prefs 持久化)。
4. **Git 插件 `pier.worktree.status` 无回归**:右键菜单里同时能看到 "Worktree Status" 与 "Agent status" 两个勾选项;设置页两行并列。
5. **无 activity 时 agent-status item 不渲染**(容器仍挂载但内容空——`isVisible` 生效,agent activity 不存在返回 false)。

- [ ] **Step 7: 交付**

工作完成。等待用户 review + commit。参照 `AGENTS.md` §05,不自动 commit;stage 与 commit message 由用户决策。

---

## Self-Review 记录

**Spec coverage:** Spec §3.1 类型 → Task 1 Step 1;§3.2 声明源 → Task 1 Step 2;§3.3 合并层 → Task 2;§3.4 右键菜单 → Task 4;§3.5 设置页 → Task 5;§3.6 caller → Task 3(terminal-status-bar.tsx)+ Task 4/5(内部 caller);§3.7 agent-status-item 清理 → Task 6;§3.8 i18n → Task 6 Step 1/2;§3.9 不动清单 → 全 plan 未触碰;§6 验收 → Task 7 Step 6。

**Placeholder scan:** 无 TBD/TODO;每个 code step 都有完整代码;每个 command 都有 expected output。

**Type consistency:** `CoreTerminalStatusItemDeclaration`(Task 1)所有字段名 `id / order / alignment / titleKey` 在 Task 2-5 里签名与消费保持一致;`CORE_AGENT_STATUS_ITEM_ID` / `CORE_TERMINAL_STATUS_ITEMS` 常量名在 Task 1/3/4/5/6 引用一致。返回类型联合 `PluginTerminalStatusItemContribution | DeclaredTerminalStatusItem`(Task 2)对下游 `resolveEffectiveTerminalStatusItemConfig`(接受 `DeclaredTerminalStatusItem | undefined`)兼容。
