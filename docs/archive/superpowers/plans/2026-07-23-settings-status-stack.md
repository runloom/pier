# 设置页状态带（Settings Status Stack）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用单一 `StatusStack` 外壳呈现设置页多条常驻状态，消除插件/通知/技能多完整 Alert 叠放；workspace/hooks 降为 info；多诊断共壳。

**Architecture:** `packages/ui` 提供无业务文案的 `StatusStack`（单壳 + 行级 StatusIcon，外壳 tone = 最高 item tone）。业务页组装 `StatusItem[]`。插件状态带只挂在 `PluginsSection`；`ManagedPluginsSection` 上报 catalog 元数据、不再自绘顶栏 Alert。M0 原语 → M1 插件 → M2 通知+技能主路径 → M3 收尾与治理收紧。

**Tech Stack:** React 19 · `@pier/ui` (cva/StatusIcon/Button) · Vitest 4 · Testing Library · 既有 settings i18n

**Spec:** [docs/archive/superpowers/specs/2026-07-23-settings-status-stack-design.md](../specs/2026-07-23-settings-status-stack-design.md)

## Global Constraints

- P1：同一 Card/Section 顶部不得并排多个完整 `Alert` 外壳
- P2：多状态 = 多 item，共一个 stack
- P3：排序 `destructive` → `warning` → `info` → `default`；同权重稳定序
- P4：workspace / hooks 关闭 → **info**
- P5：N 诊断 → **一条** warning item + 列表；禁止 `groups.map → <Alert>`
- P6：导入成功默认 **toast.success**，不进常驻带
- P7：状态带在 Card/CardContent 内
- P8：操作失败仍 toast / `showAppAlert`
- P9：单 item 外观接近单条 Alert
- Stack **禁止** `items.map(() => <Alert data-slot="alert">)` 
- 用户文案全部 i18n；文件硬顶 500 行
- **本执行若用户要求不 commit：跳过所有 git commit 步骤**，仅改工作区并跑测
- 工作区可能已有未提交的「插件全部更新」改动（`managed-plugins-section.tsx` 等）——**保留并适配**，不要回滚无关 diff

---

## File map

| 文件 | 职责 |
| --- | --- |
| Create: `packages/ui/src/status-stack.tsx` | StatusStack 原语 + 导出 sort helper |
| Create: `tests/unit/ui/status-stack.test.tsx` | 原语单测（空/排序/单壳/dismiss） |
| Create: `src/renderer/pages/settings/components/plugin-status-items.ts` | 插件 items 纯组装 |
| Create: `tests/unit/renderer/plugin-status-items.test.ts` | 组装单测 |
| Modify: `plugin-diagnostics-summary.tsx` | 去掉 map-Alert；可删组件或改为只导出 group 辅助 |
| Modify: `plugins-section.tsx` | 唯一 StatusStack |
| Modify: `managed-plugins-section.tsx` | 去掉顶栏 workspace/error Alert；上报 catalog 状态 |
| Modify: `notifications-section.tsx` | PolicyCard 用 StatusStack；hooks→info |
| Modify: skills 三处 | 项目详情 / 导入审阅 stack；导入成功 toast |
| Modify: en/zh-CN `settings-plugins.ts` 等 i18n | 诊断汇总 title、dismiss 等 |
| Create: `tests/unit/renderer/settings-status-stack-governance.test.ts` | 禁止 map-Alert / managed 顶栏 Alert |
| Modify: 既有 plugins/notifications/skills 测 | 适配 |

导出：`@pier/ui/status-stack` 经 package `"./*": "./src/*.tsx"` 自动可用。

---

### Task 1: M0 — StatusStack 原语 + 单测

**Files:**
- Create: `packages/ui/src/status-stack.tsx`
- Create: `tests/unit/ui/status-stack.test.tsx`（若 `tests/unit/ui` 不存在则创建；或放 `tests/component` 若项目 UI 测惯例在那——优先与现有 ui 测目录一致，可 `glob tests/**/alert*`）

**Interfaces:**

```ts
// packages/ui/src/status-stack.tsx
import type { ReactNode } from "react";

export type StatusStackTone = "destructive" | "warning" | "info" | "default";

export interface StatusStackItem {
  id: string;
  tone: StatusStackTone;
  title: string;
  description?: string;
  body?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function sortStatusStackItems(
  items: readonly StatusStackItem[]
): StatusStackItem[];

export function statusStackShellTone(
  items: readonly StatusStackItem[]
): StatusStackTone;

export function StatusStack(props: {
  items: readonly StatusStackItem[];
  className?: string;
  "data-testid"?: string;
  /** aria-label for dismiss buttons; caller supplies i18n */
  dismissLabel?: string;
}): React.JSX.Element | null;
```

视觉要点：

- 根节点 `data-slot="status-stack"`，**唯一**；`data-shell-tone={shellTone}`
- 复用 `alertVariants` 的 border/bg token（import `alertVariants` 或复制同 token class），`rounded-2xl border px-4 py-3`
- 多 item：纵向 `gap-3`；每行 `data-slot="status-stack-item"` + `data-tone` + 行级 `StatusIcon`（default 可无 icon）
- action：行内右/下方 `Button` size="sm"；dismiss：ghost icon 按钮，`aria-label={dismissLabel ?? "Dismiss"}`
- **不要**渲染子级 `data-slot="alert"`

- [ ] **Step 1: 定位测试目录并写失败测**

```bash
# 找现有 ui 组件测位置
rg -l "data-slot=\"alert\"|@pier/ui/alert" tests --glob '*.tsx' | head
```

在对应目录创建 `status-stack.test.tsx`：

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sortStatusStackItems,
  StatusStack,
  statusStackShellTone,
} from "@pier/ui/status-stack.tsx";

afterEach(() => cleanup());

describe("sortStatusStackItems", () => {
  it("orders destructive > warning > info > default and keeps stable order", () => {
    const sorted = sortStatusStackItems([
      { id: "d1", tone: "default", title: "D1" },
      { id: "i1", tone: "info", title: "I1" },
      { id: "w1", tone: "warning", title: "W1" },
      { id: "x1", tone: "destructive", title: "X1" },
      { id: "w2", tone: "warning", title: "W2" },
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["x1", "w1", "w2", "i1", "d1"]);
  });
});

describe("statusStackShellTone", () => {
  it("picks highest tone", () => {
    expect(
      statusStackShellTone([
        { id: "a", tone: "info", title: "a" },
        { id: "b", tone: "warning", title: "b" },
      ])
    ).toBe("warning");
  });
});

describe("StatusStack", () => {
  it("returns null for empty items", () => {
    const { container } = render(<StatusStack items={[]} />);
    expect(container.querySelector('[data-slot="status-stack"]')).toBeNull();
  });

  it("renders one shell with multiple items and no nested alert slots", () => {
    render(
      <StatusStack
        items={[
          { id: "w", tone: "warning", title: "Warn", description: "W body" },
          { id: "i", tone: "info", title: "Info", description: "I body" },
        ]}
      />
    );
    const shells = document.querySelectorAll('[data-slot="status-stack"]');
    expect(shells).toHaveLength(1);
    expect(shells[0]).toHaveAttribute("data-shell-tone", "warning");
    expect(document.querySelectorAll('[data-slot="status-stack-item"]')).toHaveLength(
      2
    );
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("invokes dismiss handler", () => {
    const onDismiss = vi.fn();
    render(
      <StatusStack
        dismissLabel="Close"
        items={[
          {
            id: "x",
            tone: "info",
            title: "Hint",
            dismissible: true,
            onDismiss,
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm exec vitest run tests/unit/ui/status-stack.test.tsx`  
（路径以 Step 1 实际为准）  
Expected: FAIL resolve or missing export

- [ ] **Step 3: 实现 `status-stack.tsx`**

```ts
const TONE_RANK: Record<StatusStackTone, number> = {
  destructive: 0,
  warning: 1,
  info: 2,
  default: 3,
};

export function sortStatusStackItems(items: readonly StatusStackItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((x) => x.item);
}

export function statusStackShellTone(items: readonly StatusStackItem[]) {
  let best: StatusStackTone = "default";
  let bestRank = TONE_RANK.default;
  for (const item of items) {
    const rank = TONE_RANK[item.tone];
    if (rank < bestRank) {
      best = item.tone;
      bestRank = rank;
    }
  }
  return best;
}
```

StatusStack 渲染：sort → shellTone → 一个 div 用与 Alert 相同的 variant class（可 `cn(alertVariants({ variant: shellTone === "default" ? "default" : shellTone }))`，注意 alert 有 success 无 default 外的映射——destructive/warning/info/default 均已在 alertVariants）。

行：icon via StatusIcon kind map（同 ALERT_STATUS_ICON）；title；description；body；action Button；dismiss X 用 lucide `X` + Button ghost icon-sm。

- [ ] **Step 4: GREEN** — 同上 vitest PASS

- [ ] **Step 5: Commit**（若会话禁止 commit 则跳过）

```bash
git add packages/ui/src/status-stack.tsx tests/unit/ui/status-stack.test.tsx
git commit -m "feat(ui): add StatusStack for settings banners"
```

---

### Task 2: M1 — 插件 status items 纯函数 + i18n

**Files:**
- Create: `src/renderer/pages/settings/components/plugin-status-items.ts`
- Create: `tests/unit/renderer/plugin-status-items.test.ts`
- Modify: `src/renderer/i18n/locales/en/settings-plugins.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/settings-plugins.ts`

**Interfaces:**

```ts
import type { StatusStackItem } from "@pier/ui/status-stack.tsx";
import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/runtime-diagnostics.ts";

export function buildPluginStatusItems(input: {
  pageError: string | null; // toggleError ?? storeError
  catalogError: string | null;
  diagnostics: readonly PluginRegistryDiagnostic[];
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[];
  pluginMode: "workspace" | "release" | null | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): StatusStackItem[];
```

逻辑：

1. 若 `pageError` 与 `catalogError` 都有：一条 `{ id: "plugins-error", tone: "destructive", title: t("settings.plugins.errorTitle"), body: <两行文本> }` 或 description 用 `\n` 拼接两行（StatusStack description 可 whitespace-pre-wrap）
2. 仅一个 error：一条 destructive
3. 诊断：调用现有 `groupPluginDiagnostics`；0 跳过；1 → title kindLabel + description detail；≥2 → title `t("settings.plugins.diagnostics.summaryTitle")` + body 为 `<ul>` 列表（纯函数若不宜 JSX，可返回 `description` 多行字符串 `lines.join("\n")` 并在 stack 对 description 设 `whitespace-pre-wrap`——**推荐字符串**避免 ts 文件 JSX，文件用 `.ts`）
4. `pluginMode === "workspace"` → info item id `plugins-workspace`，title/body 现有 pluginMode keys

kindLabel：从 `plugin-diagnostics-summary.tsx` **导出** `pluginDiagnosticKindLabel` 或把 label 逻辑挪到 `plugin-status-items.ts` 避免循环依赖。

i18n 新增：

```ts
// en diagnostics
summaryTitle: "Plugin issues",
// zh
summaryTitle: "插件存在问题",
```

- [ ] **Step 1: 单测**（合并 error、单/多诊断、workspace info、空）
- [ ] **Step 2: RED**
- [ ] **Step 3: 实现 + i18n**
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Commit 或跳过**

---

### Task 3: M1 — 插件 Section 接线

**Files:**
- Modify: `src/renderer/pages/settings/components/plugins-section.tsx`
- Modify: `src/renderer/pages/settings/components/managed-plugins-section.tsx`
- Modify: `src/renderer/pages/settings/components/plugin-diagnostics-summary.tsx`（删除 Alert UI 或文件仅保留 group 导出）
- Modify/Create tests: `tests/unit/renderer/plugins-section.test.tsx` 或扩展 `managed-plugins-section.test.tsx` + 新 `plugins-status-stack.test.tsx`

**Interfaces:**

```ts
// ManagedPluginsSection 新增可选回调或回传 props：
onCatalogStatusChange?(status: {
  pluginMode: "workspace" | "release";
  catalogError: string | null;
}): void;
// 或更简单：把 useCatalog 上提到 PluginsSection（改动面大）
// 推荐：ManagedPluginsSection 调用 onCatalogStatusChange 在 catalog/error 变化时
```

**ManagedPluginsSection 变更：**

- 删除 workspace `<Alert>` 块
- 删除自身 catalog `error` 的 destructive Alert（改上报）
- `useEffect`：当 `catalog?.pluginMode` / `error` 变化 → `onCatalogStatusChange?.({ pluginMode, catalogError: error })`
- **保留** Update All 顶栏与其它逻辑（勿破坏未提交的 update-all）

**PluginsSection 变更：**

```tsx
const [catalogStatus, setCatalogStatus] = useState<{
  pluginMode: "workspace" | "release";
  catalogError: string | null;
}>({ pluginMode: "release", catalogError: null });

const items = buildPluginStatusItems({
  pageError: error,
  catalogError: catalogStatus.catalogError,
  diagnostics,
  runtimeDiagnostics,
  pluginMode: catalogStatus.pluginMode,
  t,
});

// CardContent 顶部：
<div className="px-(--card-spacing)">
  <StatusStack items={items} />
</div>
// 删除旧 error Alert + PluginDiagnosticsSummary 的 Alert 列表
```

- [ ] **Step 1: UI 测**

场景 A：mock diagnostics 一条 invalid_manifest + managed list 返回 pluginMode workspace → 文档中 **一个** `status-stack`，item 含诊断文案与「Local development loading」/中文「本地开发加载」，**零**个 `data-slot="alert"`（在状态区；行内无需 alert）。

场景 B：仅 workspace → shell-tone info。

场景 C：page error + catalog error → 单 destructive item。

- [ ] **Step 2: RED**
- [ ] **Step 3: 接线实现**
- [ ] **Step 4: GREEN** + 跑  
  `pnpm exec vitest run tests/unit/renderer/managed-plugins-section.test.tsx tests/unit/renderer/plugins-section.test.tsx tests/unit/renderer/managed-plugins-update-all-ui.test.tsx`（若存在 update-all 测，确保不挂）
- [ ] **Step 5: Commit 或跳过**

---

### Task 4: M1 — 插件治理规则

**Files:**
- Create: `tests/unit/renderer/settings-status-stack-governance.test.ts`

规则（静态读源码字符串）：

1. `plugin-diagnostics-summary.tsx` 若仍存在，**不得**含 `<Alert`
2. `managed-plugins-section.tsx` **不得**含 `pluginMode.workspaceTitle` 的 Alert 渲染（可允许 i18n key 出现在上报/注释外的 title 引用——更严：不得出现 `<Alert` 与 `workspaceTitle` 同文件邻近；最简：`managed-plugins-section.tsx` 中 `<Alert` 出现次数为 0，若 update-all 无关。检查当前文件是否还有其它 Alert——catalog error 删后应无 Alert）
3. `plugins-section.tsx` 状态区使用 `StatusStack` 或 `status-stack`

```ts
it("managed plugins section does not render Alert banners", () => {
  const src = readFileSync("src/renderer/pages/settings/components/managed-plugins-section.tsx", "utf8");
  expect(src).not.toMatch(/<Alert\b/);
});

it("plugin diagnostics summary does not map to Alert", () => {
  // file may be deleted or only export groupPluginDiagnostics
  ...
});
```

- [ ] 实现治理测 GREEN
- [ ] Commit 或跳过

---

### Task 5: M2 — 通知 PolicyCard

**Files:**
- Modify: `src/renderer/pages/settings/components/notifications-section.tsx`
- Modify: tests if any `notifications-section.test.*`

**变更：**

- `PermissionBanner` + `StatusHooksHint` 不再各自 return `<Alert>`
- 组装 items：

```ts
const items: StatusStackItem[] = [];
if (showPermission && snapshot) {
  // map status → tone/title/body 同现文案
  items.push({ id: "notif-permission", tone: permissionTone, title, description: body });
}
if (showHooksOff) {
  items.push({
    id: "notif-hooks-off",
    tone: "info", // 降级
    title: t("settings.notifications.hooksOffTitle"),
    description: t("settings.notifications.hooksOffBody"),
  });
}
// PolicyCard 顶部 <StatusStack items={items} />
```

- 删除独立 `StatusHooksHint` Alert 组件或改为 push item 的 helper

- [ ] 测：hooks off + denied 权限 → 一个 stack、两 item、hooks 行为 info（`data-tone="info"`）
- [ ] GREEN
- [ ] Commit 或跳过

---

### Task 6: M2 — 技能项目详情 + 导入成功 toast

**Files:**
- Modify: `src/renderer/pages/settings/components/skills/skills-project-detail.tsx`
- Modify: 相关 store/调用 `setRecentImportNotice` 的路径 → toast
- Modify: tests

**变更：**

1. 删除 `recentImportNotice` 的常驻 Alert；在设置 notice 的地方（查找 `setRecentImportNotice`）改为 `toast.success(...)` 后不 set 或 set 后立即 clear；若仅 UI 读 notice，则在 effect 里 toast 并 clear
2. 将其余 banner 收为 `StatusStack` items（reload/frozen/error、degraded、git、sessionRefresh dismissible）
3. `SkillsDetailBanner` 可改为产出 item 的数据 helper，或内联

- [ ] 测：同时 mock sessionRefresh + git risk → 一个 stack；无 multiple `data-slot="alert"`
- [ ] 测：recentImport 路径触发 toast.success（mock sonner）
- [ ] GREEN / Commit 或跳过

---

### Task 7: M2 — 技能导入审阅

**Files:**
- Modify: `src/renderer/pages/settings/components/skills/skills-import-review.tsx`
- Tests

将 hasRisk / conflict / reload / blocked / expired 收为单一 `StatusStack`；保留 conflict↔reload 互斥。

- [ ] 测：risk + conflict → 一个 stack，tones warning+destructive
- [ ] GREEN / Commit 或跳过

---

### Task 8: M3 — 收尾与治理收紧

**Files:**
- Optional: skill detail drift / readonly 单条保持 Alert（文档允许）
- Optional: Claude `apiKeyMode` → `tone: info` 若当前 default 需对齐 P4
- Modify: `settings-status-stack-governance.test.ts` 增加：
  - `notifications-section.tsx`：`hooksOff` 不得与 `variant="warning"` 绑定
  - `skills-project-detail.tsx` / `skills-import-review.tsx`：`<Alert` 计数为 0（全改 stack 后）
- Run full focused suite + biome on touched paths
- Spec 完成标准 checklist 人工勾选

- [ ] 验证命令：

```bash
pnpm exec vitest run \
  tests/unit/ui/status-stack.test.tsx \
  tests/unit/renderer/plugin-status-items.test.ts \
  tests/unit/renderer/settings-status-stack-governance.test.ts \
  tests/unit/renderer/managed-plugins-section.test.tsx \
  tests/unit/renderer/plugins-section.test.tsx \
  tests/unit/renderer/managed-plugins-update-all-ui.test.tsx \
  tests/unit/renderer/managed-plugin-update-all.test.ts
# + notifications/skills 相关测
```

- [ ] 文件行数 ≤500；超则抽 hook
- [ ] Commit 或跳过

---

## Spec coverage

| Spec | Task |
| --- | --- |
| StatusStack 原语 P1–P3 P9 | 1 |
| 插件诊断共壳 + workspace info + 单带 | 2–3 |
| 双 error 合并 | 2 |
| 治理 map-Alert / managed 无 Alert | 4 |
| 通知 hooks info + 单带 | 5 |
| 技能项目详情 + toast 导入成功 | 6 |
| 导入审阅 stack | 7 |
| M3 收紧 / 账号 info | 8 |
| Card 内布局 | 3/5 保持 CardContent 内 |
| 不改 dialog/toast 体系 | 全局约束 |

**Placeholder scan:** 无 TBD。  
**类型名:** `StatusStackItem` / `StatusStackTone` 全任务统一（业务侧可 `import type { StatusStackItem as SettingsStatusItem }` 别名，但不强制）。

---

## Execution handoff

Plan: `docs/archive/superpowers/plans/2026-07-23-settings-status-stack.md`.

**执行约束（本会话用户已指定）：中途不提交代码** —— 所有 Task 的 Commit 步骤跳过。

**两选一：**

1. **Subagent-Driven（推荐）** — 每任务子代理 + review  
2. **Inline Execution** — 本会话连续执行  

要哪种？
