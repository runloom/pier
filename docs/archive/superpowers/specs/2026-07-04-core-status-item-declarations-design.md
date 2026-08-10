# Core 状态栏项声明注册表

**日期**：2026-07-04
**范围**：终端状态栏 core-owned 项（当前唯一实例：`core.agent-status`）
**关联文档**：[2026-07-02-plugin-configuration-and-statusbar-design.md](2026-07-02-plugin-configuration-and-statusbar-design.md)（现有 plugin/配置/状态栏合并管道）

## 1. 背景与问题

当前终端状态栏渲染两类 item：

- **插件声明项**：由已启用插件在 `manifest.terminalStatusItems` 中声明（例：Git 插件 `pier.worktree.status`），走完整合并管道（manifest 默认值 + 用户 prefs 覆盖 + 运行时 renderer 注册）。
- **核心项**：目前唯一实例是 `core.agent-status`，硬编码在 `agent-status-item.tsx` 里直接 import registry 单例注册，`id` 与 `order` 都是代码字面量。

Prefs 覆盖管道对核心项**底层已通**（`hidden` / `order` / `alignment` 三字段的 override 都会生效），但**上层三处 UI 数据源**都只遍历 `entry.manifest.terminalStatusItems`：

| 消费点 | 文件 | 函数 |
|---|---|---|
| 合并层排序/挂载判定 | `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts` | `declaredTerminalStatusItemsById` |
| 右键管理菜单 | `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts` | `declaredRows` |
| 设置对话框「终端 → 状态栏」管理块 | `src/renderer/pages/settings/components/terminal-status-bar-block.tsx` | `buildRows` |

后果：`core.agent-status` 不出现在右键菜单勾选列表、不出现在设置页管理块。用户想调整只能手改 userData 里的 `terminal-status-bar-prefs.json`，是"底层可配置，UI 无入口"的状态。

## 2. 目标 / 非目标

### 目标
- 让 `core.agent-status` 与插件声明项在**同一份管理 UI**中并列（右键菜单勾选、设置页开关/排序/左右切换/重置）。
- 保留核心归属：`agent-status-item.tsx` 组件本体、`registerAgentStatusItem` 注册入口、`foreground-activity-bridge.tsx` 里的 activity-key 变化 re-register 机制**都不动**。
- 抽象为**注册表**而非硬编码单例：`agent-status` 只是首个消费方，未来任何 core-owned 状态栏项（例：shell exit code、CWD 显示、连接状态）都能加进这份声明源，不用重新抽象。

### 非目标
- 不改归属：`core.agent-status` 不搬到插件（用户明确要求核心能力保留在 core）。
- 不重构 `foreground-activity-bridge.tsx` 里的 re-register 机制（独立技术债，本次不掺）。
- 不新增 core 声明的动态注册 API（就是个静态常量数组，YAGNI）。
- 不新增"是否显示子代理计数"这类新自定义维度（无需求）。
- 不新增 alignment 拖拽等交互（复用现有设置页管理块）。

## 3. 设计

### 3.1 契约层：`CoreTerminalStatusItemDeclaration`

在 `src/shared/contracts/terminal-status-bar.ts` 新增类型：

```ts
export interface CoreTerminalStatusItemDeclaration {
  id: string;
  /** 缺省时合并层落回 0（与 plugin 声明一致的语义） */
  order?: number;
  /** 缺省时合并层落回 "left"（与 plugin 声明一致的语义） */
  alignment?: "left" | "right";
  /**
   * 全局 i18n key，运行时经 i18next.t(titleKey) 解析。
   * 不复用 resolvePluginTerminalStatusItemDisplay（那个依赖 manifest.localization，
   * core 不走 manifest）。
   */
  titleKey: string;
}
```

**不含** `permissions` 字段——core 不走权限系统。

### 3.2 声明源：`core-terminal-status-items.ts`

新建 `src/renderer/panel-kits/terminal/core-terminal-status-items.ts`：

```ts
import type { CoreTerminalStatusItemDeclaration } from "@shared/contracts/terminal-status-bar.ts";

export const CORE_AGENT_STATUS_ITEM_ID = "core.agent-status";

export const CORE_TERMINAL_STATUS_ITEMS: readonly CoreTerminalStatusItemDeclaration[] = [
  {
    id: CORE_AGENT_STATUS_ITEM_ID,
    order: -10,
    titleKey: "terminal.statusBar.item.agentStatus.title",
  },
];
```

`id` 保留 `core.agent-status`（不改 `pier.agent.status`）——已经手改过 prefs 的用户不需要迁移。

### 3.3 合并层：`declaredTerminalStatusItemsById` 扩展签名

`src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts`：

```ts
export function declaredTerminalStatusItemsById(
  plugins: readonly PluginRegistryEntry[],
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): ReadonlyMap<string, DeclaredTerminalStatusItem> {
  const byId = new Map<string, DeclaredTerminalStatusItem>();
  // Core 先塞:同 id 时 core 优先,防止插件抢占 core id。
  for (const item of coreItems) {
    byId.set(item.id, { alignment: item.alignment, order: item.order });
  }
  for (const entry of plugins) {
    if (!entry.runtime.enabled) continue;
    for (const item of entry.manifest.terminalStatusItems) {
      if (byId.has(item.id)) continue; // core 已占位
      byId.set(item.id, item);
    }
  }
  return byId;
}
```

**为什么 `coreItems` 走参数而不是直接 import 常量**：`terminal-status-bar-merge.ts` 是 Vitest 单测主体的纯函数模块（见文件顶部注释），保持无副作用/无 module-scope import 依赖以便测试。

### 3.4 右键菜单：`declaredRows` 扩展签名

`src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts`：

```ts
export function declaredRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs,
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): DeclaredItemRow[] {
  const locale = i18next.language || "en";
  const rows: DeclaredItemRow[] = [];
  const seen = new Set<string>();

  // Core 先遍历(同 id 时 core 优先)
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
    if (!entry.runtime.enabled) continue;
    for (const item of entry.manifest.terminalStatusItems) {
      if (seen.has(item.id)) continue;
      const config = resolveEffectiveTerminalStatusItemConfig(item, prefs.items[item.id]);
      rows.push({
        hidden: config.hidden,
        itemId: item.id,
        title: resolvePluginTerminalStatusItemDisplay(entry.manifest, item, locale).title,
      });
    }
  }

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}
```

### 3.5 设置页管理块：`buildRows` 扩展签名

`src/renderer/pages/settings/components/terminal-status-bar-block.tsx`：

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
    declared: DeclaredTerminalStatusItem,
    title: string
  ) => {
    const config = resolveEffectiveTerminalStatusItemConfig(declared, prefs.items[id]);
    const row: StatusBarRow = {
      alignment: config.alignment,
      hasOverride: prefs.items[id] !== undefined,
      hidden: config.hidden,
      id,
      order: config.order,
      title,
    };
    (config.alignment === "right" ? right : left).push(row);
    seen.add(id);
  };

  for (const item of coreItems) {
    pushRow(item.id, { alignment: item.alignment, order: item.order }, i18next.t(item.titleKey));
  }
  for (const entry of plugins) {
    if (!entry.runtime.enabled) continue;
    for (const item of entry.manifest.terminalStatusItems) {
      if (seen.has(item.id)) continue;
      pushRow(item.id, item, resolvePluginTerminalStatusItemDisplay(entry.manifest, item, locale).title);
    }
  }

  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  return { left, right };
}
```

现有 `moveWithinGroup` / `StatusBarRowView`（switch / 上下移 / 左右切换 / reset）对 core row 天然工作——它们只依赖 `id` 走 prefs override 管道，不区分来源。

### 3.6 Caller 侧改动

四处 caller 传入 `CORE_TERMINAL_STATUS_ITEMS`：

- `terminal-status-bar.tsx:74` — `mergeTerminalStatusItems` 里 `declaredTerminalStatusItemsById(plugins)` → `(plugins, CORE_TERMINAL_STATUS_ITEMS)`
- `terminal-status-bar.tsx:114` — `hasDeclaredTerminalStatusItems` 里同上（**否则挂载判定不会认 core 声明**）
- `terminal-status-bar-menu.ts:75` — `declaredRows(plugins, prefs)` → `(plugins, prefs, CORE_TERMINAL_STATUS_ITEMS)`
- `terminal-status-bar-block.tsx:271` — `buildRows(plugins, prefs)` → `(plugins, prefs, CORE_TERMINAL_STATUS_ITEMS)`

Core 是静态常量，不需要额外订阅；locale 保持既有 render-time 读取。

### 3.7 `agent-status-item.tsx` 清理

```ts
// 顶部 import
import { CORE_AGENT_STATUS_ITEM_ID } from "./core-terminal-status-items.ts";

// registerAgentStatusItem 内部
return terminalStatusItemRegistry.register({
  id: CORE_AGENT_STATUS_ITEM_ID,
  isVisible: (ctx) => {
    const activity = useForegroundActivityStore.getState().activities[ctx.panelId];
    return activity?.kind === "agent";
  },
  // 删除:order: -10 —— 现由 core 声明表提供
  render: (ctx) => <AgentStatusItemView panelId={ctx.panelId} />,
});
```

- `id` 改用常量（单一真相源）
- 删除 `order: -10`（合并层文件注释 `terminal-status-bar.tsx:34` 明确"运行时注册对象不再承载排序"）
- `RendererTerminalStatusItem.order` 已经是 `order?: number`（见 `src/plugins/api/renderer.ts:143`），删除不引发 typecheck 错误

### 3.8 i18n

新增两个 key（en + zh-CN 各一份）：

- `terminal.statusBar.item.agentStatus.title`
  - en: `"Agent status"`
  - zh-CN: `"Agent 状态"`

namespace 待实施时按现有布局定（参考 `renderer/i18n/locales/en/settings.ts` 与右键菜单 key `terminal.statusBar.manage` 的所在位置）。

### 3.9 不动清单

- `foreground-activity-bridge.tsx` re-register 机制不动
- `AgentStatusItemView` UI 本体不动（含 badge 文案、shimmer、图标）
- 插件 manifest 契约 `PluginManifest.terminalStatusItems` 不动
- 用户 prefs schema `TerminalStatusBarPrefs` 不动（`prefs.items[id]` 索引已经天然支持任意 id）
- Main 侧 `terminal-status-bar-prefs.ts` 不动

## 4. 关键权衡

**Core 优先 vs Plugin 优先（id 冲突）**：选 core 优先。理由：core 声明是**已提交进主仓**的静态常量，语义强于插件在 manifest 里的自由声明；插件若与 core id 冲突意味着插件出错，应被跳过而不是遮盖 core。

**参数传入 vs Module-scope import**：`declaredTerminalStatusItemsById` 走参数是为了保持 `terminal-status-bar-merge.ts` 纯函数可测；`declaredRows` / `buildRows` 也走参数是为了对齐同一套 signature 风格，虽然它们已经 import 了大量 UI 依赖。

**保留 `order: -10` 硬编码 vs 挪到声明**：选挪到声明。合并层已经明确"运行时对象不承载排序"，硬编码在 `register` 调用里的 `order: -10` 已经是无效字段（应该已经被合并层忽略）。挪到声明表既是单一真相源，也让未来的 core-owned item 有统一注册位置。

**Core 声明放 renderer 还是 shared**：类型放 `shared/contracts/terminal-status-bar.ts`（跨 renderer/main 共享），常量放 `renderer/panel-kits/terminal/`（只在 renderer 消费）。

## 5. 影响面 / 兼容性

**修改文件（8 个）**：
1. `src/shared/contracts/terminal-status-bar.ts`
2. `src/renderer/panel-kits/terminal/terminal-status-bar-merge.ts`
3. `src/renderer/panel-kits/terminal/terminal-status-bar.tsx`
4. `src/renderer/panel-kits/terminal/terminal-status-bar-menu.ts`
5. `src/renderer/pages/settings/components/terminal-status-bar-block.tsx`
6. `src/renderer/panel-kits/terminal/agent-status-item.tsx`
7. `src/renderer/i18n/locales/en/*.ts`（具体文件实施时定）
8. `src/renderer/i18n/locales/zh-CN/*.ts`

**新增文件（1 个）**：
- `src/renderer/panel-kits/terminal/core-terminal-status-items.ts`

**测试影响**：
- `terminal-status-bar-merge.ts` 单测：所有调用 `declaredTerminalStatusItemsById` / `mergeTerminalStatusItems` 的用例需要补 `coreItems` 参数（大多传 `[]` 即可保持行为等价，新增一两个 case 覆盖 core 声明生效路径与 id 冲突路径）
- 实施时先 `grep -rn "declaredTerminalStatusItemsById\|mergeTerminalStatusItems" src/` 定位所有测试用例

**兼容性**：
- 用户已有 `terminal-status-bar-prefs.json` 里若有 `core.agent-status` 键，本次改动**完全兼容**（id 未变）
- 未启用任何插件 + 未启用 `AgentStatusItemView` 时，`hasDeclaredTerminalStatusItems` 现在会返回 `true`（core 声明存在），导致状态栏容器挂载。这是**期望行为**——用户能通过右键菜单看到"Agent 状态"这一项以决定隐藏与否。

## 6. 验收

- [ ] 右键状态栏 → 菜单里出现"Agent 状态"勾选项，勾选状态与 activity 存在与否解耦（纯 hidden 覆盖）
- [ ] 设置对话框「终端 → 状态栏」管理块里出现"Agent 状态"行，可开关、可上下移、可切左右、可 reset
- [ ] 现有 Git 插件 `pier.worktree.status` 行为无回归（依然出现在菜单与设置页、位置正确）
- [ ] 用户手动改 prefs 里 `core.agent-status.order` 后仍生效（兼容性）
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test:unit` 全绿
- [ ] `pnpm depcruise` 无新违规
