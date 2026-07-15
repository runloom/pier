# Host Content Dialog Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the host own all product modal stacks (including complex add-account / switch-confirm content dialogs) so Codex and Grok stop mounting nested plugin `Dialog` shells.

**Architecture:** Add a host content-dialog store + host renderer next to `AppDialogHost`. Extend `context.dialogs` with `open/update/close`. Migrate Codex and Grok add-account and switch-confirm flows to content components. Then delete `@pier/ui` nested-dialog transition hacks and lock governance.

**Tech Stack:** Electron renderer React 19, Zustand 5, `@pier/ui` Dialog primitives (host only), `@pier/plugin-api` renderer context, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-15-host-content-dialog-architecture-design.md`

## Global Constraints

- Host owns every product modal shell; plugins supply content only.
- Plugins MUST NOT mount product `Dialog` / `AlertDialog` after Phase 3.
- Codex and Grok migrate together in this plan.
- Do not dynamically flip Settings `modal` to work around nesting.
- Keep existing Grok add-account UX: two tabs; account footer Cancel / device / browser; API key footer Cancel / Add; waiting non-dismissible.
- Keep Codex single OAuth path + waiting controls.
- Simple alert/confirm remains `AppDialogHost`; do not merge stores.
- Content dialog ids for external plugins are namespaced `${pluginId}:${id}`.
- Prefer TDD: failing test → implement → pass → commit per task.
- Git: stage explicit paths only; Conventional Commits; no `git add .`, amend, force-push.

## File Map

| File | Responsibility |
|---|---|
| `src/renderer/stores/app-content-dialog.store.ts` | Content dialog stack state + open/update/close API |
| `src/renderer/components/common/app-content-dialog-host.tsx` | Renders host Dialog shells for stack layers |
| `src/renderer/components/common/app-shell.tsx` / `main.tsx` | Mount content dialog host beside `AppDialogHost` |
| `packages/plugin-api/src/renderer.ts` | External plugin dialogs types (`open/update/close`) |
| `src/renderer/lib/plugins/external-plugin-context.ts` | Wire external plugin dialogs to host store |
| `src/renderer/lib/plugins/host-context.ts` | Wire builtin/host dialogs if needed for parity |
| `packages/plugin-grok/src/renderer/add-account-dialog.tsx` | Become content + trigger only |
| `packages/plugin-grok/src/renderer/switch-confirm-dialog.tsx` | Become content opened via host |
| `packages/plugin-codex/src/renderer/add-account-dialog.tsx` | Same as Grok pattern |
| `packages/plugin-codex/src/renderer/switch-confirm-dialog.tsx` | Same as Grok pattern |
| `packages/ui/src/dialog.tsx` | Remove nested transition hacks after migration |
| `AGENTS.md` | Document host content dialog rules |
| `tests/unit/renderer/app-content-dialog*.test.ts(x)` | Store/host tests |
| `tests/unit/renderer/app-dialog-governance.test.ts` | Extend governance |
| Existing Codex/Grok settings/widget tests | Update callers |

---

### Task 1: Content dialog store (TDD)

**Files:**
- Create: `src/renderer/stores/app-content-dialog.store.ts`
- Test: `tests/unit/renderer/app-content-dialog.store.test.ts`

**Interfaces:**
- Produces:
  - `openAppContentDialog<T>(request): AppContentDialogHandle<T>`
  - `updateAppContentDialog(id, patch): void`
  - `closeAppContentDialog(id, result?: unknown): void`
  - `useAppContentDialogStore` with `{ stack: AppContentDialogLayer[] }`
  - Types: `AppContentDialogOpenRequest`, `AppContentDialogRenderProps`, `AppContentDialogHandle`, `AppContentDialogSize`

- [ ] **Step 1: Write failing store tests**

```ts
// tests/unit/renderer/app-content-dialog.store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  updateAppContentDialog,
  useAppContentDialogStore,
} from "@/stores/app-content-dialog.store.ts";

function Dummy() {
  return null;
}

describe("app content dialog store", () => {
  beforeEach(() => {
    resetAppContentDialogForTests();
  });

  it("pushes a layer and resolves null on dismiss close", async () => {
    const handle = openAppContentDialog({
      id: "test.a",
      title: "A",
      content: Dummy,
    });
    expect(useAppContentDialogStore.getState().stack).toHaveLength(1);
    expect(useAppContentDialogStore.getState().stack[0]?.id).toBe("test.a");

    closeAppContentDialog("test.a");
    await expect(handle.result).resolves.toBeNull();
    expect(useAppContentDialogStore.getState().stack).toHaveLength(0);
  });

  it("namespaces and replaces same id", () => {
    openAppContentDialog({
      id: "accounts.add",
      title: "One",
      content: Dummy,
      namespace: "pier.grok",
    });
    openAppContentDialog({
      id: "accounts.add",
      title: "Two",
      content: Dummy,
      namespace: "pier.grok",
    });
    const stack = useAppContentDialogStore.getState().stack;
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe("pier.grok:accounts.add");
    expect(stack[0]?.title).toBe("Two");
  });

  it("supports stacked layers and close by id", async () => {
    const a = openAppContentDialog({ id: "a", title: "A", content: Dummy });
    const b = openAppContentDialog({ id: "b", title: "B", content: Dummy });
    expect(useAppContentDialogStore.getState().stack.map((l) => l.id)).toEqual([
      "a",
      "b",
    ]);
    closeAppContentDialog("b", { ok: true });
    await expect(b.result).resolves.toEqual({ ok: true });
    expect(useAppContentDialogStore.getState().stack.map((l) => l.id)).toEqual([
      "a",
    ]);
    closeAppContentDialog("a");
    await expect(a.result).resolves.toBeNull();
  });

  it("update patches dismissible/title", () => {
    openAppContentDialog({
      id: "w",
      title: "Wait",
      content: Dummy,
      dismissible: true,
    });
    updateAppContentDialog("w", { dismissible: false, title: "Waiting" });
    const layer = useAppContentDialogStore.getState().stack[0];
    expect(layer?.dismissible).toBe(false);
    expect(layer?.title).toBe("Waiting");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/renderer/app-content-dialog.store.test.ts`

Expected: FAIL module not found / exports missing.

- [ ] **Step 3: Implement store**

```ts
// src/renderer/stores/app-content-dialog.store.ts
import type { ComponentType } from "react";
import { create } from "zustand";

export type AppContentDialogSize = "sm" | "default" | "lg";

export interface AppContentDialogRenderProps<TResult = unknown> {
  id: string;
  close: (result?: TResult | null) => void;
  setDismissible: (dismissible: boolean) => void;
  setTitle: (title: string) => void;
  setDescription: (description?: string) => void;
}

export interface AppContentDialogOpenRequest<TResult = unknown> {
  id: string;
  title: string;
  description?: string;
  size?: AppContentDialogSize;
  dismissible?: boolean;
  closeOnOverlayClick?: boolean;
  namespace?: string;
  content: ComponentType<AppContentDialogRenderProps<TResult>>;
}

export interface AppContentDialogHandle<TResult = unknown> {
  id: string;
  result: Promise<TResult | null>;
  update(patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }): void;
  close(result?: TResult | null): void;
}

export interface AppContentDialogLayer {
  id: string;
  title: string;
  description?: string;
  size: AppContentDialogSize;
  dismissible: boolean;
  closeOnOverlayClick: boolean;
  content: ComponentType<AppContentDialogRenderProps<unknown>>;
  resolve: (result: unknown) => void;
}

interface State {
  stack: AppContentDialogLayer[];
}

export const useAppContentDialogStore = create<State>(() => ({ stack: [] }));

function qualifyId(id: string, namespace?: string): string {
  return namespace ? `${namespace}:${id}` : id;
}

export function openAppContentDialog<TResult = unknown>(
  request: AppContentDialogOpenRequest<TResult>
): AppContentDialogHandle<TResult> {
  const id = qualifyId(request.id, request.namespace);
  let resolve!: (result: TResult | null) => void;
  const result = new Promise<TResult | null>((res) => {
    resolve = res;
  });

  const layer: AppContentDialogLayer = {
    id,
    title: request.title,
    description: request.description,
    size: request.size ?? "default",
    dismissible: request.dismissible ?? true,
    closeOnOverlayClick: request.closeOnOverlayClick ?? false,
    content: request.content as ComponentType<
      AppContentDialogRenderProps<unknown>
    >,
    resolve: (value) => resolve((value as TResult | null) ?? null),
  };

  useAppContentDialogStore.setState((state) => {
    const without = state.stack.filter((item) => item.id !== id);
    // Replacing same id re-resolves previous waiter as null.
    const previous = state.stack.find((item) => item.id === id);
    previous?.resolve(null);
    return { stack: [...without, layer] };
  });

  return {
    id,
    result,
    update: (patch) => updateAppContentDialog(id, patch),
    close: (value) => closeAppContentDialog(id, value),
  };
}

export function updateAppContentDialog(
  id: string,
  patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }
): void {
  useAppContentDialogStore.setState((state) => ({
    stack: state.stack.map((layer) =>
      layer.id === id
        ? {
            ...layer,
            ...("title" in patch && patch.title !== undefined
              ? { title: patch.title }
              : {}),
            ...("description" in patch
              ? { description: patch.description }
              : {}),
            ...("dismissible" in patch && patch.dismissible !== undefined
              ? { dismissible: patch.dismissible }
              : {}),
            ...("closeOnOverlayClick" in patch &&
            patch.closeOnOverlayClick !== undefined
              ? { closeOnOverlayClick: patch.closeOnOverlayClick }
              : {}),
          }
        : layer
    ),
  }));
}

export function closeAppContentDialog(id: string, result?: unknown): void {
  const layer = useAppContentDialogStore
    .getState()
    .stack.find((item) => item.id === id);
  if (!layer) return;
  useAppContentDialogStore.setState((state) => ({
    stack: state.stack.filter((item) => item.id !== id),
  }));
  layer.resolve(result ?? null);
}

export function resetAppContentDialogForTests(): void {
  for (const layer of useAppContentDialogStore.getState().stack) {
    layer.resolve(null);
  }
  useAppContentDialogStore.setState({ stack: [] });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run tests/unit/renderer/app-content-dialog.store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/app-content-dialog.store.ts tests/unit/renderer/app-content-dialog.store.test.ts
git commit -m "$(cat <<'EOF'
feat(renderer): add host content dialog store

Introduce a host-owned stack for custom content dialogs so plugins can
open complex modal flows without mounting their own Dialog shells.
EOF
)"
```

---

### Task 2: Content dialog host UI + mount

**Files:**
- Create: `src/renderer/components/common/app-content-dialog-host.tsx`
- Modify: `src/renderer/components/common/app-shell.tsx`
- Modify: `src/renderer/main.tsx` (if it mounts `AppDialogHost` outside app-shell paths)
- Test: `tests/unit/renderer/app-content-dialog-host.test.tsx`

**Interfaces:**
- Consumes: `useAppContentDialogStore`, `closeAppContentDialog`, `updateAppContentDialog`
- Produces: `AppContentDialogHost` React component

- [ ] **Step 1: Write failing host test**

```tsx
// tests/unit/renderer/app-content-dialog-host.test.tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import {
  openAppContentDialog,
  resetAppContentDialogForTests,
  type AppContentDialogRenderProps,
} from "@/stores/app-content-dialog.store.ts";

function Body(props: AppContentDialogRenderProps<{ v: number }>) {
  return (
    <button type="button" onClick={() => props.close({ v: 1 })}>
      Finish
    </button>
  );
}

describe("AppContentDialogHost", () => {
  afterEach(() => {
    cleanup();
    resetAppContentDialogForTests();
  });

  it("renders top content and resolves on content close", async () => {
    render(<AppContentDialogHost />);
    let settled: unknown;
    await act(async () => {
      const handle = openAppContentDialog<{ v: number }>({
        id: "demo",
        title: "Demo title",
        content: Body,
      });
      void handle.result.then((value) => {
        settled = value;
      });
    });
    expect(screen.getByText("Demo title")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    });
    expect(settled).toEqual({ v: 1 });
  });

  it("blocks ESC when not dismissible", async () => {
    render(<AppContentDialogHost />);
    await act(async () => {
      openAppContentDialog({
        id: "locked",
        title: "Locked",
        dismissible: false,
        content: Body,
      });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByText("Locked")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `pnpm exec vitest run tests/unit/renderer/app-content-dialog-host.test.tsx`

Expected: FAIL host module missing.

- [ ] **Step 3: Implement host**

Implement `AppContentDialogHost` that:

- reads `stack` from store
- for each layer, renders host `@pier/ui/dialog` shell
- only topmost layer is interactive; lower layers `aria-hidden` + inert
- wires `onEscapeKeyDown`: if `!dismissible` preventDefault; else `closeAppContentDialog(id)`
- `onOpenChange(false)` only closes when dismissible
- passes render props into `layer.content`
- size class mapping: `sm` → default dialog width, `lg` → wider (`sm:max-w-lg` / `sm:max-w-2xl` as needed)

Mount:

```tsx
// app-shell.tsx / main.tsx next to <AppDialogHost />
<AppDialogHost />
<AppContentDialogHost />
```

- [ ] **Step 4: Run host + store tests**

Run:

```bash
pnpm exec vitest run tests/unit/renderer/app-content-dialog.store.test.ts tests/unit/renderer/app-content-dialog-host.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/common/app-content-dialog-host.tsx src/renderer/components/common/app-shell.tsx src/renderer/main.tsx tests/unit/renderer/app-content-dialog-host.test.tsx
git commit -m "$(cat <<'EOF'
feat(renderer): mount host content dialog host

Render host-owned Dialog shells for the content dialog stack so custom
modal flows share one focus/ESC owner.
EOF
)"
```

---

### Task 3: Plugin API + context wiring

**Files:**
- Modify: `packages/plugin-api/src/renderer.ts`
- Modify: `src/renderer/lib/plugins/external-plugin-context.ts`
- Modify: `src/renderer/lib/plugins/host-context.ts` (if builtin plugins need parity)
- Test: `tests/unit/renderer/external-plugin-content-dialog.test.ts` (or extend existing plugin context tests)

**Interfaces:**
- Produces external API:

```ts
dialogs: {
  alert(...): Promise<void>;
  confirm(...): Promise<boolean>;
  open<TResult>(request: {
    id: string;
    title: string;
    description?: string;
    size?: "sm" | "default" | "lg";
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
    content: ComponentType<ContentDialogRenderProps<TResult>>;
  }): {
    id: string;
    result: Promise<TResult | null>;
    update(patch: {...}): void;
    close(result?: TResult | null): void;
  };
  update(id: string, patch: {...}): void;
  close(id: string, result?: unknown): void;
}
```

- [ ] **Step 1: Write failing API/wiring test**

Assert external context `dialogs.open` namespaces id with plugin id and pushes store layer.

- [ ] **Step 2: Run test to verify fail**

- [ ] **Step 3: Implement types + wiring**

In `external-plugin-context.ts`:

```ts
open: (options) =>
  openAppContentDialog({
    ...options,
    namespace: pluginId,
  }),
update: (id, patch) =>
  updateAppContentDialog(`${pluginId}:${id}`, patch),
close: (id, result) =>
  closeAppContentDialog(`${pluginId}:${id}`, result),
```

Note: if caller already uses handle.id (namespaced), `update/close` on handle should use absolute ids. Prefer:

- `dialogs.open` returns handle with absolute id
- `dialogs.update/close` accept absolute ids returned by open, **or** relative ids auto-namespaced

Pick one and keep consistent in tests: **relative ids auto-namespaced for dialogs.update/close**, handle methods use absolute id.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(plugin-api): expose host content dialog open API

Allow official plugins to open host-owned content dialogs without
mounting nested Dialog shells.
EOF
)"
```

---

### Task 4: Migrate Grok add-account to content dialog

**Files:**
- Modify: `packages/plugin-grok/src/renderer/add-account-dialog.tsx`
- Modify: `packages/plugin-grok/src/renderer/accounts-settings-page.tsx` (only if trigger wiring changes)
- Test: `tests/unit/renderer/grok-accounts-settings-page.test.tsx`

**Interfaces:**
- Consumes: `context.dialogs.open`
- Produces: `AddAccountDialog` trigger button + `AddAccountContent` component

- [ ] **Step 1: Update failing/adjust tests for host dialog title presence**

Keep behavioral assertions:

- Add account button opens UI titled “Add Grok account”
- API key tab submit invokes `accounts.add`
- Continue in browser / device code invoke OIDC modes

Because content dialog portals at host root, tests that only render `AccountsSettingsPage` must either:

1. also render `<AppContentDialogHost />`, or
2. mock `context.dialogs.open` and render content directly in unit tests.

**Preferred:** render page + `AppContentDialogHost` together in tests.

- [ ] **Step 2: Run tests expecting current nested dialog or inline mismatch**

- [ ] **Step 3: Refactor implementation**

Pattern:

```tsx
export function AddAccountDialog({ context, login, onError, t }) {
  // auto-open when login pending via effect using dialogs.open / update
  return (
    <Button
      type="button"
      onClick={() => {
        context.dialogs.open({
          id: "accounts.add",
          title: t("...addDialogTitle", "Add Grok account"),
          description: t("..."),
          size: "default",
          content: (props) => (
            <AddAccountContent
              {...props}
              context={context}
              login={login}
              onError={onError}
              t={t}
            />
          ),
        });
      }}
    >
      ...
    </Button>
  );
}
```

`AddAccountContent` contains tabs/fields/footers; uses `props.setDismissible(false)` when waiting; `props.close()` on success/cancel.

No imports from `@pier/ui/dialog.tsx` in this file after migration.

- [ ] **Step 4: Run Grok settings tests + rebuild plugin**

```bash
pnpm exec vitest run tests/unit/renderer/grok-accounts-settings-page.test.tsx
pnpm --filter @pier/plugin-grok build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(grok): open add-account via host content dialog

Move Grok add-account UI into a host-owned content dialog so nested
plugin Dialog focus/ESC issues no longer apply.
EOF
)"
```

---

### Task 5: Migrate Grok switch/sync confirm

**Files:**
- Modify: `packages/plugin-grok/src/renderer/switch-confirm-dialog.tsx`
- Modify: `packages/plugin-grok/src/renderer/account-picker.tsx`
- Modify: `packages/plugin-grok/src/renderer/accounts-settings-page.tsx`
- Test: settings/widget tests covering switch/sync

- [ ] **Step 1: Write/adjust tests**

Switch flow opens host dialog title “Switch Grok account?” and confirm invokes `accounts.select` with syncTargets.

- [ ] **Step 2: Run fail/red on old Dialog assumptions if needed**

- [ ] **Step 3: Implement**

Replace local `<SwitchConfirmDialog open />` state machine with:

```ts
const handle = context.dialogs.open<SwitchConfirmResult>({
  id: "accounts.switch-confirm",
  title: ...,
  content: (props) => <SwitchConfirmContent mode={mode} t={t} {...props} />,
});
const result = await handle.result;
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(grok): host content dialog for peer switch/sync confirm

Route Grok switch and sync confirmation through the host content dialog
stack instead of a nested plugin Dialog.
EOF
)"
```

---

### Task 6: Migrate Codex add-account + switch/sync

**Files:**
- Modify: `packages/plugin-codex/src/renderer/add-account-dialog.tsx`
- Modify: `packages/plugin-codex/src/renderer/switch-confirm-dialog.tsx`
- Modify: `packages/plugin-codex/src/renderer/account-picker.tsx`
- Modify: `packages/plugin-codex/src/renderer/accounts-settings-page.tsx`
- Test: `tests/unit/renderer/codex-accounts-settings-page.test.tsx`, widget tests

Mirror Task 4–5 patterns for Codex single OAuth path.

- [ ] **Step 1: Adjust Codex tests to include `AppContentDialogHost`**
- [ ] **Step 2: Run red**
- [ ] **Step 3: Implement content-dialog migrations**
- [ ] **Step 4: Run Codex tests + build**

```bash
pnpm exec vitest run tests/unit/renderer/codex-accounts-settings-page.test.tsx tests/unit/renderer/codex-accounts-widget.test.tsx
pnpm --filter @pier/plugin-codex build
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(codex): migrate account dialogs to host content dialog

Align Codex add-account and switch/sync confirm with the host-owned
content dialog architecture used by Grok.
EOF
)"
```

---

### Task 7: Governance + docs + delete nested Dialog hacks

**Files:**
- Modify: `tests/unit/renderer/app-dialog-governance.test.ts`
- Create or extend: `tests/unit/renderer/plugin-product-dialog-governance.test.ts`
- Modify: `AGENTS.md` host dialog section
- Modify: `packages/ui/src/dialog.tsx` (remove nesting context / nested portal / nested modal default)
- Modify/remove: any now-unused helpers solely for nested plugin dialogs
- Keep: topmost ESC if still needed for host multi-layer content dialogs

- [ ] **Step 1: Write failing governance test**

```ts
// Forbid product Dialog imports in plugin renderer sources
const PLUGIN_RENDERER_ROOTS = [
  join(ROOT, "packages", "plugin-codex", "src", "renderer"),
  join(ROOT, "packages", "plugin-grok", "src", "renderer"),
];
// offenders: files importing "@pier/ui/dialog" or "@pier/ui/alert-dialog"
expect(offenders).toEqual([]);
```

Also assert AGENTS.md documents content dialog host rules.

- [ ] **Step 2: Run governance test (should fail if plugin dialogs remain)**

- [ ] **Step 3: Ensure plugin migrations left no product Dialog imports; update AGENTS.md**

Add under 宿主弹窗使用规范:

- complex content dialogs use host content dialog API / `context.dialogs.open`
- plugins must not mount `@pier/ui/dialog` product shells
- nested plugin dialogs are forbidden

- [ ] **Step 4: Remove `@pier/ui` nested transition code**

Delete from `packages/ui/src/dialog.tsx`:

- `DialogNestingContext`
- nested portal container logic
- nested default `modal={false}` based on nesting

Keep host content dialogs working (they are not nested plugin dialogs; they are sequential host shells).

- [ ] **Step 5: Run broad targeted suite**

```bash
pnpm exec vitest run \
  tests/unit/renderer/app-content-dialog.store.test.ts \
  tests/unit/renderer/app-content-dialog-host.test.tsx \
  tests/unit/renderer/app-dialog-governance.test.ts \
  tests/unit/renderer/plugin-product-dialog-governance.test.ts \
  tests/unit/renderer/overlay-dialog-governance.test.tsx \
  tests/unit/renderer/use-deferred-dialog-open.test.tsx \
  tests/unit/renderer/settings-dialog-escape-scoping.test.tsx \
  tests/unit/renderer/grok-accounts-settings-page.test.tsx \
  tests/unit/renderer/codex-accounts-settings-page.test.tsx \
  tests/unit/renderer/grok-accounts-widget.test.tsx \
  tests/unit/renderer/codex-accounts-widget.test.tsx

pnpm exec tsc -p packages/ui/tsconfig.json --noEmit
pnpm --filter @pier/plugin-grok build
pnpm --filter @pier/plugin-codex build
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(ui): remove nested plugin dialog hacks

Enforce host-owned content dialogs for plugin product modals and delete
transitional nested Dialog workarounds from @pier/ui.
EOF
)"
```

---

### Task 8: Final verification checklist

- [ ] **Step 1: Manual smoke (dev app)**

1. Open Settings → Grok Accounts → Add account  
   - second dialog opens  
   - Settings does not remount  
   - API key typing works  
   - ESC closes add only  
2. Start OAuth waiting: ESC does nothing; Cancel login works  
3. Switch/sync peer dialog works  
4. Repeat for Codex  

- [ ] **Step 2: Confirm no plugin product Dialog imports**

```bash
rg -n "@pier/ui/dialog|@pier/ui/alert-dialog" packages/plugin-codex/src/renderer packages/plugin-grok/src/renderer
```

Expected: no matches

- [ ] **Step 3: Rebuild packages**

```bash
pnpm --filter @pier/plugin-grok build:package
pnpm --filter @pier/plugin-codex build:package
```

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| Host content dialog store/stack | Task 1 |
| Host content dialog renderer | Task 2 |
| Plugin API open/update/close | Task 3 |
| Grok add-account migration | Task 4 |
| Grok switch/sync migration | Task 5 |
| Codex migrations | Task 6 |
| Governance + delete nesting hacks | Task 7 |
| ESC/focus/waiting acceptance | Tasks 2,4,5,6,8 |
| Codex+Grok together | Tasks 4–6 |
| No Settings modal demotion | Task 7 removal + constraints |

## Placeholder scan

No TBD/TODO/“implement later” steps remain. Commands and primary code shapes are explicit; host classnames may match existing Dialog density utilities already used by Settings.
