# Workbench P0 Professional UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Workbench’s edit experience discoverable and safe (P0 from the gap analysis): visible lock state, always-findable add/lock/arrange/refresh actions, non-hover edit affordances, destructive confirm on remove, arrange feedback, and real error UI for system resources / widget crashes.

**Architecture:** Keep the existing 12-column RGL model, panel params, and right-click menu. Add an in-panel toolbar chrome as the primary non-context-menu action surface; tighten card affordance opacity; route remove through `showAppConfirm`; surface arrange success via i18n toast; extend `system-stats` store with an error bit so the system-resources widget can render `WidgetError` + retry.

**Tech Stack:** React 19, Vitest + Testing Library, `showAppConfirm` / sonner toast, existing `@pier/ui/widget-state`, i18n locales `en` / `zh-CN`.

## Global Constraints

- Scope is **P0 only** from `docs/superpowers/specs/2026-07-09-workbench-professional-ux-gap-analysis.md` (P0.1–P0.7). Do not implement P1/P2 items in this plan.
- Do not change 12-column basis persistence, narrow-container `deriveLayout`, or explicit-only auto-arrange.
- Do not replace `react-grid-layout`.
- Host dialogs: `showAppConfirm` with explicit `size: "sm"` and `intent: "destructive"` for remove.
- Toast copy must use i18n keys; no inline user-facing strings.
- Right-click menu may remain as a secondary shortcut, but must not be the only entry for add / lock / arrange / refresh-all.
- Prefer in-panel toolbar over dockview `WorkspaceHeaderActions` (panel-local state stays inside the kit; no cross-kit header plumbing).
- Follow TDD: failing test → implement → pass → commit per task.
- Do not use `@ts-ignore`, `@ts-expect-error`, or `as any`.

## File Map

| File | Responsibility |
| --- | --- |
| `src/renderer/panel-kits/workbench/workbench-toolbar.tsx` | **Create.** In-panel chrome: Add / Refresh All / Arrange / Lock(+indicator). |
| `src/renderer/panel-kits/workbench/workbench-panel.tsx` | Mount toolbar; keep context menu; wire handlers. |
| `src/renderer/panel-kits/workbench/workbench-widget-card.tsx` | Always-visible (low opacity) drag handle + menu; confirm before remove. |
| `src/renderer/panel-kits/workbench/workbench-add-card.tsx` | Locked-empty copy path (no “go add widgets” CTA semantics). |
| `src/renderer/panel-kits/workbench/use-workbench-panel-state.ts` | Arrange success toast; optional confirm helper used by card remove. |
| `src/renderer/panel-kits/workbench/workbench-widget-error-boundary.tsx` | i18n fallback message prop (no hardcoded English). |
| `src/renderer/panel-kits/workbench/core-widgets/system-resources-widget.tsx` | Render `WidgetError` when store reports error and no snapshot. |
| `src/renderer/stores/system-stats.store.ts` | Track `error`; clear on success; export `pollSystemStatsOnce` for retry. |
| `src/renderer/i18n/locales/en/workbench.ts` | New keys for toolbar, lock banner, locked empty, remove confirm, arrange toast, widget error, system error. |
| `src/renderer/i18n/locales/zh-CN/workbench.ts` | Matching zh-CN keys. |
| `tests/component/workbench-panel.test.tsx` | P0 component coverage; update opacity assertions. |
| `tests/unit/renderer/system-stats.store.test.ts` | **Create if missing** — error bit + retry clears error. |

---

### Task 1: i18n keys for P0 chrome and feedback

**Files:**
- Modify: `src/renderer/i18n/locales/en/workbench.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/workbench.ts`

**Interfaces:**
- Produces: keys under `workbench.toolbar.*`, `workbench.locked*`, `workbench.removeConfirm*`, `workbench.arrangeSuccess`, `workbench.widget.errorFallback`, `workbench.widget.systemResources.error` / `errorHint`

- [ ] **Step 1: Add English keys**

In `en/workbench.ts`, extend the export (keep existing keys; add):

```ts
toolbar: {
  add: "Add Widget",
  arrangeLayout: "Arrange Layout",
  lock: "Lock Layout",
  lockedBadge: "Locked",
  refreshAll: "Refresh All",
  unlock: "Unlock Layout",
},
lockedEmpty: "Layout is locked",
lockedEmptyDescription:
  "Unlock the layout from the toolbar to add widgets.",
lockedBanner: "Layout locked — drag, resize, and add are disabled.",
removeConfirmTitle: "Remove widget?",
removeConfirmBody: "This removes the widget from Workbench. You can add it again from the library.",
arrangeSuccess: "Layout arranged",
widget: {
  // ...existing...
  errorFallback: "Widget failed to render",
  systemResources: {
    // ...existing...
    error: "Couldn’t load system stats",
    errorHint: "Retry to sample CPU and memory again.",
  },
},
```

Mirror the same structure in `zh-CN/workbench.ts` with natural Chinese copy (e.g. `lockedBadge: "已锁定"`, `arrangeSuccess: "已整理布局"`, `removeConfirmTitle: "移除物料？"`, `errorFallback: "物料渲染失败"`).

- [ ] **Step 2: Typecheck i18n shape**

Run: `pnpm exec tsc -p tsconfig.renderer.json --noEmit`
Expected: PASS (or only pre-existing unrelated errors). If locales are `as const` and consumed via string keys, no extra types needed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/i18n/locales/en/workbench.ts src/renderer/i18n/locales/zh-CN/workbench.ts
git commit -m "$(cat <<'EOF'
feat(workbench): add P0 chrome and feedback i18n keys

EOF
)"
```

---

### Task 2: In-panel toolbar (P0.1 / P0.3 / P0.4)

**Files:**
- Create: `src/renderer/panel-kits/workbench/workbench-toolbar.tsx`
- Modify: `src/renderer/panel-kits/workbench/workbench-panel.tsx`
- Modify: `src/renderer/panel-kits/workbench/workbench-add-card.tsx`
- Test: `tests/component/workbench-panel.test.tsx`

**Interfaces:**
- Consumes: `locked: boolean`, `canArrange: boolean`, `onAdd`, `onRefreshAll`, `onArrange`, `onToggleLocked` from panel
- Produces: toolbar with test ids:
  - `workbench-toolbar`
  - `workbench-toolbar-add`
  - `workbench-toolbar-refresh-all`
  - `workbench-toolbar-arrange`
  - `workbench-toolbar-lock`
  - `workbench-locked-banner` (when locked)

- [ ] **Step 1: Write failing tests**

Append to `tests/component/workbench-panel.test.tsx`:

```tsx
describe("P0 toolbar chrome", () => {
  it("renders toolbar actions without opening context menu", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<WorkbenchPanel {...props} />);

    expect(screen.getByTestId("workbench-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-toolbar-add")).toBeEnabled();
    expect(
      screen.getByTestId("workbench-toolbar-refresh-all")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workbench-toolbar-arrange")
    ).toBeEnabled();
    expect(screen.getByTestId("workbench-toolbar-lock")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workbench-locked-banner")
    ).not.toBeInTheDocument();
  });

  it("shows locked banner and disables add/arrange when locked", () => {
    const props = makeProps({
      locked: true,
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<WorkbenchPanel {...props} />);

    expect(
      screen.getByTestId("workbench-locked-banner")
    ).toBeInTheDocument();
    expect(screen.getByTestId("workbench-toolbar-add")).toBeDisabled();
    expect(
      screen.getByTestId("workbench-toolbar-arrange")
    ).toBeDisabled();
  });

  it("locked empty state uses locked copy and hides add CTA", () => {
    const props = makeProps({ locked: true, widgets: [] });
    render(<WorkbenchPanel {...props} />);

    expect(screen.getByTestId("workbench-empty")).toHaveTextContent(
      /locked/i
    );
    expect(
      screen.queryByTestId("workbench-add-widget")
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "P0 toolbar"`
Expected: FAIL — `workbench-toolbar` not found.

- [ ] **Step 3: Implement toolbar component**

Create `workbench-toolbar.tsx`:

```tsx
import { Button } from "@pier/ui/button.tsx";
import { LayoutGrid, Lock, LockOpen, Plus, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";

interface WorkbenchToolbarProps {
  canArrange: boolean;
  locked: boolean;
  onAdd: () => void;
  onArrange: () => void;
  onRefreshAll: () => void;
  onToggleLocked: () => void;
}

export function WorkbenchToolbar({
  canArrange,
  locked,
  onAdd,
  onArrange,
  onRefreshAll,
  onToggleLocked,
}: WorkbenchToolbarProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 border-border/60 border-b px-3 py-2">
      {locked ? (
        <div
          className="rounded-md bg-muted/60 px-2.5 py-1.5 text-muted-foreground text-xs"
          data-testid="workbench-locked-banner"
        >
          {t("workbench.lockedBanner")}
        </div>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-1"
        data-testid="workbench-toolbar"
      >
        <Button
          data-testid="workbench-toolbar-add"
          disabled={locked}
          onClick={onAdd}
          size="xs"
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
          {t("workbench.toolbar.add")}
        </Button>
        <Button
          data-testid="workbench-toolbar-refresh-all"
          onClick={onRefreshAll}
          size="xs"
          type="button"
          variant="ghost"
        >
          <RefreshCw className="size-3.5" />
          {t("workbench.toolbar.refreshAll")}
        </Button>
        <Button
          data-testid="workbench-toolbar-arrange"
          disabled={locked || !canArrange}
          onClick={onArrange}
          size="xs"
          type="button"
          variant="ghost"
        >
          <LayoutGrid className="size-3.5" />
          {t("workbench.toolbar.arrangeLayout")}
        </Button>
        <Button
          aria-pressed={locked}
          data-testid="workbench-toolbar-lock"
          onClick={onToggleLocked}
          size="xs"
          type="button"
          variant={locked ? "default" : "ghost"}
        >
          {locked ? (
            <LockOpen className="size-3.5" />
          ) : (
            <Lock className="size-3.5" />
          )}
          {locked
            ? t("workbench.toolbar.unlock")
            : t("workbench.toolbar.lock")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount toolbar + locked empty copy**

In `workbench-panel.tsx`, render `<WorkbenchToolbar ... />` above the scrollable grid (sibling inside the outer flex column, **outside** the overflow scroller so it stays visible). Wire:

- `onAdd` → `setLibraryOpen(true)`
- `onRefreshAll` → `state.refreshAll`
- `onArrange` → `state.handleArrangeLayout`
- `onToggleLocked` → `state.handleToggleLocked`
- `canArrange={resolved.length > 0}`
- `locked={locked}`

In `workbench-add-card.tsx`, add optional `locked?: boolean`. When `isEmpty && locked`, use `workbench.lockedEmpty` / `lockedEmptyDescription` and never show the add button (caller may still pass `showAction={false}`; prefer reading `locked` for copy).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "P0 toolbar"`
Expected: PASS

Also run the existing lock/empty tests to ensure no regressions:
`pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "锁定"`

- [ ] **Step 6: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/workbench-toolbar.tsx \
  src/renderer/panel-kits/workbench/workbench-panel.tsx \
  src/renderer/panel-kits/workbench/workbench-add-card.tsx \
  tests/component/workbench-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): add in-panel toolbar and locked banner

EOF
)"
```

---

### Task 3: Always-visible edit affordances (P0.2)

**Files:**
- Modify: `src/renderer/panel-kits/workbench/workbench-widget-card.tsx`
- Modify: `src/renderer/panel-kits/workbench/workbench-panel.tsx` (resize handle opacity)
- Test: `tests/component/workbench-panel.test.tsx`

**Interfaces:**
- Produces: drag handle and menu trigger use `opacity-40` (or similar) at rest, `group-hover:opacity-100` / `focus-visible:opacity-100` / `data-[state=open]:opacity-100` — never `opacity-0` when unlocked.

- [ ] **Step 1: Update failing / outdated assertions**

Replace the test titled `menu trigger visible on group-hover (focus:opacity-100 assertion)` with:

```tsx
it("edit affordances stay faintly visible without hover", () => {
  const props = makeProps({
    widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
  });
  const { container } = render(<WorkbenchPanel {...props} />);

  const handle = container.querySelector(
    ".workbench-widget-drag-handle"
  );
  expect(handle).toBeTruthy();
  expect(handle?.className).not.toContain("opacity-0");
  expect(handle?.className).toMatch(/opacity-40|opacity-50|opacity-60/);

  const trigger = screen.getByLabelText(MENU_LABEL_RE);
  expect(trigger.className).not.toContain("opacity-0");
  expect(trigger.className).toContain("focus-visible:opacity-100");
});
```

Also assert resize handle rest opacity is not fully hidden — update panel class that currently sets `[&_.react-resizable-handle]:opacity-0` to a faint rest opacity (e.g. `opacity-40`) with hover `opacity-100`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "edit affordances"`
Expected: FAIL — still contains `opacity-0`.

- [ ] **Step 3: Implement affordance opacity**

In `workbench-widget-card.tsx` drag handle and menu button:

- Change `opacity-0` → `opacity-40`
- Keep `group-hover:opacity-100`, `focus-visible:opacity-100`, `data-[state=open]:opacity-100`

In `workbench-panel.tsx` grid chrome classes:

- Change `[&_.react-resizable-handle]:opacity-0` → `[&_.react-resizable-handle]:opacity-40`
- Keep hover → `opacity-100`

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "edit affordances|未锁定|锁定布局隐藏"`
Expected: PASS (locked still hides handles entirely).

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/workbench-widget-card.tsx \
  src/renderer/panel-kits/workbench/workbench-panel.tsx \
  tests/component/workbench-panel.test.tsx
git commit -m "$(cat <<'EOF'
fix(workbench): keep edit affordances faintly visible

EOF
)"
```

---

### Task 4: Destructive remove confirm (P0.5)

**Files:**
- Modify: `src/renderer/panel-kits/workbench/workbench-widget-card.tsx`
- Modify: `src/renderer/panel-kits/workbench/use-workbench-panel-state.ts` (optional: keep remove sync; confirm stays in card/UI layer)
- Test: `tests/component/workbench-panel.test.tsx`

**Interfaces:**
- Consumes: `showAppConfirm` from `@/stores/app-dialog.store.ts`
- Produces: remove only persists after confirm returns `true`

- [ ] **Step 1: Write failing test**

```tsx
import { useAppDialogStore } from "@/stores/app-dialog.store.ts";

it("asks for confirmation before removing a widget", async () => {
  const updateParameters = vi.fn();
  const props = makeProps(
    { widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }] },
    updateParameters
  );
  render(<WorkbenchPanel {...props} />);
  openWidgetMenu();
  fireEvent.click(
    await screen.findByTestId("workbench-widget-menu-remove")
  );

  const dialog = useAppDialogStore.getState().current;
  expect(dialog?.kind).toBe("confirm");
  expect(updateParameters).not.toHaveBeenCalled();

  // cancel
  dialog?.resolve(false);
  expect(updateParameters).not.toHaveBeenCalled();

  openWidgetMenu();
  fireEvent.click(
    await screen.findByTestId("workbench-widget-menu-remove")
  );
  const dialog2 = useAppDialogStore.getState().current;
  dialog2?.resolve(true);

  await vi.waitFor(() => {
    expect(updateParameters).toHaveBeenCalledWith({ widgets: [] });
  });
});
```

Update the existing test `removes a widget via the card menu` to resolve the confirm dialog `true` before asserting `updateParameters`, or delete it in favor of the new test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "asks for confirmation"`
Expected: FAIL — remove still persists immediately / no dialog.

- [ ] **Step 3: Implement confirm in card**

In `workbench-widget-card.tsx`, change remove menu item to async:

```tsx
onSelect={async (event) => {
  event.preventDefault();
  const confirmed = await showAppConfirm({
    title: t("workbench.removeConfirmTitle"),
    body: t("workbench.removeConfirmBody"),
    intent: "destructive",
    size: "sm",
  });
  if (confirmed) {
    onRemove();
  }
}}
```

Import `showAppConfirm` from `@/stores/app-dialog.store.ts`. Keep `onRemove` as the pure persist callback from the panel state hook.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "confirmation|removes a widget|锁定布局：保留刷新"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/workbench-widget-card.tsx \
  tests/component/workbench-panel.test.tsx
git commit -m "$(cat <<'EOF'
fix(workbench): confirm before removing widgets

EOF
)"
```

---

### Task 5: Arrange layout success feedback (P0.6)

**Files:**
- Modify: `src/renderer/panel-kits/workbench/use-workbench-panel-state.ts`
- Test: `tests/component/workbench-panel.test.tsx`

**Interfaces:**
- Consumes: `toast` from `sonner`, `i18next.t` or a passed translator — prefer importing `toast` and calling `toast.success(i18next.t("workbench.arrangeSuccess"))` inside `handleArrangeLayout` after a real persist (when JSON changed). If layout unchanged, do **not** toast.

- [ ] **Step 1: Write failing test**

```tsx
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

it("toasts after explicit arrange layout writeback", async () => {
  const updateParameters = vi.fn();
  const props = makeProps(
    {
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
        { h: 3, id: "core.system-resources", w: 4, x: 4, y: 0 },
      ],
    },
    updateParameters
  );
  render(<WorkbenchPanel {...props} />);
  fireEvent.click(screen.getByTestId("workbench-toolbar-arrange"));

  await vi.waitFor(() => {
    expect(updateParameters).toHaveBeenCalled();
  });
  expect(toast.success).toHaveBeenCalled();
});
```

Place `vi.mock("sonner", ...)` at top of file (Vitest hoists). If an existing arrange test uses context menu, keep it; toolbar path is the P0 primary.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "toasts after explicit arrange"`
Expected: FAIL — `toast.success` not called.

- [ ] **Step 3: Implement toast in `handleArrangeLayout`**

```ts
import { toast } from "sonner";
import i18next from "i18next";

// inside handleArrangeLayout, after detecting newJson !== prev:
persist(next);
toast.success(i18next.t("workbench.arrangeSuccess"));
```

Do not toast when geometry is unchanged.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/component/workbench-panel.test.tsx -t "arrange|整理"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/panel-kits/workbench/use-workbench-panel-state.ts \
  tests/component/workbench-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(workbench): toast when arrange layout persists

EOF
)"
```

---

### Task 6: System resources error + widget error i18n (P0.7)

**Files:**
- Modify: `src/renderer/stores/system-stats.store.ts`
- Create: `tests/unit/renderer/system-stats.store.test.ts` (if no existing unit file)
- Modify: `src/renderer/panel-kits/workbench/core-widgets/system-resources-widget.tsx`
- Modify: `src/renderer/panel-kits/workbench/workbench-widget-error-boundary.tsx`
- Modify: `src/renderer/panel-kits/workbench/workbench-widget-card.tsx` (pass `fallbackMessage`)
- Test: `tests/component/workbench-panel.test.tsx` (existing ErrorBoundary test) + unit store test

**Interfaces:**
- Produces on store:

```ts
interface SystemStatsState {
  cpuHistory: readonly SystemStatsHistoryPoint[];
  error: string | null;
  snapshot: SystemStatsSnapshot | null;
}

export async function pollSystemStatsOnce(): Promise<void>;
```

- `pollOnce` sets `error: null` on success; on failure sets `error` to `err instanceof Error ? err.message : String(err)` and leaves prior `snapshot` intact.
- Widget: if `snapshot === null && error` → `WidgetError` with retry calling `pollSystemStatsOnce`.
- If `snapshot === null && !error` → keep `WidgetSkeleton` (initial load).
- ErrorBoundary: require `fallbackMessage: string` prop; use `error.message || fallbackMessage`.

- [ ] **Step 1: Write failing unit test for store error bit**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollSystemStatsOnce,
  useSystemStatsStore,
} from "@/stores/system-stats.store.ts";

describe("system-stats store errors", () => {
  beforeEach(() => {
    useSystemStatsStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
  });

  it("records error when snapshot fails and clears on success", async () => {
    const snapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        appMemoryRss: 1,
        cpuCount: 8,
        cpuUsage: 0.1,
        loadAvg1: 1,
        loadAvg5: 1,
        loadAvg15: 1,
        memoryFree: 1,
        memoryTotal: 2,
        sampledAt: 1,
      });
    (
      window as unknown as {
        pier: { systemStats: { snapshot: typeof snapshot } };
      }
    ).pier = { systemStats: { snapshot } };

    await pollSystemStatsOnce();
    expect(useSystemStatsStore.getState().error).toMatch(/boom/);
    expect(useSystemStatsStore.getState().snapshot).toBeNull();

    await pollSystemStatsOnce();
    expect(useSystemStatsStore.getState().error).toBeNull();
    expect(useSystemStatsStore.getState().snapshot).not.toBeNull();
  });
});
```

Stub `window.pier` with the same `window as unknown as { pier: ... }` pattern as `tests/unit/font-store.test.ts`. If `pollSystemStatsOnce` is not exported yet, the test fails on import — that is the intended red state.

- [ ] **Step 2: Run unit test to verify fail**

Run: `pnpm exec vitest run tests/unit/renderer/system-stats.store.test.ts`
Expected: FAIL (missing export / no error field).

- [ ] **Step 3: Implement store error + export poll**

Update `system-stats.store.ts`:

- Add `error: null` to initial state.
- Rename internal poll body to exported `pollSystemStatsOnce`.
- On catch: `useSystemStatsStore.setState({ error: message })` (keep snapshot).
- On success: set snapshot/history and `error: null`.
- `acquireSystemStatsPolling` continues to call `pollSystemStatsOnce`.

- [ ] **Step 4: Wire widget + error boundary**

`system-resources-widget.tsx`:

```tsx
const snapshot = useSystemStatsStore((s) => s.snapshot);
const error = useSystemStatsStore((s) => s.error);

if (snapshot === null && error) {
  return (
    <WidgetError
      message={t("workbench.widget.systemResources.error")}
      onRetry={() => {
        void pollSystemStatsOnce();
      }}
      retryLabel={t("workbench.widget.retry")}
    />
  );
}
if (snapshot === null) {
  return <WidgetSkeleton />;
}
```

`workbench-widget-error-boundary.tsx`: add `fallbackMessage: string` prop; replace `"Widget error"` with `this.props.fallbackMessage`.

`workbench-widget-card.tsx`: pass `fallbackMessage={t("workbench.widget.errorFallback")}`.

Update existing ErrorBoundary component test if it asserts English `"Widget error"` substring — assert i18n fallback or generic failure UI via `data-slot="widget-error"` instead.

- [ ] **Step 5: Run tests**

```bash
pnpm exec vitest run tests/unit/renderer/system-stats.store.test.ts tests/component/workbench-panel.test.tsx -t "ErrorBoundary|system-stats|P0"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/renderer/stores/system-stats.store.ts \
  src/renderer/panel-kits/workbench/core-widgets/system-resources-widget.tsx \
  src/renderer/panel-kits/workbench/workbench-widget-error-boundary.tsx \
  src/renderer/panel-kits/workbench/workbench-widget-card.tsx \
  tests/unit/renderer/system-stats.store.test.ts \
  tests/component/workbench-panel.test.tsx
git commit -m "$(cat <<'EOF'
fix(workbench): surface system stats and widget render errors

EOF
)"
```

---

### Task 7: P0 verification gate

**Files:** none new — run full related suites + typecheck

- [ ] **Step 1: Run component + unit suites**

```bash
pnpm exec vitest run tests/component/workbench-panel.test.tsx tests/unit/renderer/system-stats.store.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run dialog governance if remove path is scanned**

```bash
pnpm exec vitest run tests/unit/renderer/app-dialog-governance.test.ts
```

Expected: PASS (confirm API still requires size/intent at call sites — our remove call already passes both).

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual checklist (record in PR / commit body)**

- [ ] Unlocked: toolbar visible; drag handle faintly visible without hover
- [ ] Add from toolbar opens library
- [ ] Arrange toasts once when layout changes
- [ ] Lock shows banner; add/arrange disabled; empty locked copy correct
- [ ] Remove prompts confirm; cancel keeps widget
- [ ] (If systemStats can fail in dev) error state shows retry

- [ ] **Step 5: Final commit only if Step 1–3 left dirty fixes; otherwise stop**

If verification required small fixes, commit them:

```bash
git commit -m "$(cat <<'EOF'
test(workbench): finish P0 professional UX verification

EOF
)"
```

---

## Spec Coverage Self-Review

| Spec item | Task |
| --- | --- |
| P0.1 锁定态可见 + 锁定空态文案 | Task 2 |
| P0.2 编辑 affordance 非全隐 | Task 3 |
| P0.3 常驻添加入口 | Task 2 toolbar Add |
| P0.4 全局动作非仅右键 | Task 2 toolbar |
| P0.5 移除 confirm | Task 4 |
| P0.6 整理反馈 | Task 5 |
| P0.7 system-resources error + error boundary i18n | Task 6 |
| 不改布局模型 / 不换 RGL | Global Constraints |
| P1/P2 不做 | Global Constraints |

**Out of scope (do not sneak in):** placeholder contrast (P1.1), add-slot preview (P1.2), derived-view badge (P1.3), full WidgetEmpty sweep (P1.4), tabular-nums/format sweep (P1.5), a11y beyond what toolbar already needs (P1.6), library mobile chips (P1.7), more widgets/templates (P2).

**Placeholder scan:** clean after fixing the store stub to match `font-store.test.ts`.
