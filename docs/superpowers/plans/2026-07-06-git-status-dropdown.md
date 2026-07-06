# Git Status Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved lightweight Git status dropdown on the terminal status item.

**Architecture:** Keep Git status data sourced from `useGitStatus`; add a pure renderer view model that maps `GitStatus + PanelContext` to dropdown copy and action availability. Add a compact `Popover` UI inside the built-in Git renderer plugin, and keep all Git write actions routed through existing `RendererPluginContext.git`, dialogs, and notifications.

**Tech Stack:** Electron renderer, React 19, TypeScript strict, Vitest, Testing Library, Tailwind v4, `@pier/ui` shadcn primitives.

---

## File Structure

- Create `src/plugins/builtin/git/renderer/git-status-dropdown-model.ts`
  - Pure model only: status kind, summary rows, action availability, tracked-change gate, active operation labels.
- Create `src/plugins/builtin/git/renderer/git-status-dropdown.tsx`
  - `Popover` content, shadcn primitive composition, action handlers, notification/dialog feedback.
- Modify `src/plugins/builtin/git/renderer/git-status-item.tsx`
  - Preserve status-bar body and `useGitStatus`; replace left-click quick pick with `GitStatusDropdown`.
- Create `tests/unit/renderer/git-status-dropdown-model.test.ts`
  - Fast unit coverage for decision rules.
- Create `tests/unit/renderer/git-status-dropdown.test.tsx`
  - Component coverage for visible states and action feedback.
- Modify `tests/unit/renderer/git-status-item-config.test.tsx`
  - Keep existing dirty indicator assertions green with the new popover wrapper.

## Task 1: Dropdown Model

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-status-dropdown-model.ts`
- Test: `tests/unit/renderer/git-status-dropdown-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Cover these exact cases:

```ts
it("models tracked dirty changes with review, switch, and stash actions", () => {
  const model = deriveGitStatusDropdownModel(cleanStatus({
    counts: { conflict: 0, modified: 4, staged: 2, untracked: 1 },
    delta: { deletions: 42, insertions: 128 },
    branch: { ahead: 2, behind: 1, branch: "feature/terminal-status" },
  }), panelContext);

  expect(model.variant).toBe("dirty");
  expect(model.primaryAction).toBe("openChanges");
  expect(model.actions.map((action) => action.id)).toEqual([
    "openChanges",
    "switchWorktree",
    "stash",
  ]);
  expect(model.summary).toContain("7 changed");
  expect(model.summary).toContain("+128 -42");
  expect(model.summary).toContain("↑2 ↓1");
});

it("does not offer stash for untracked-only changes", () => {
  const model = deriveGitStatusDropdownModel(cleanStatus({
    counts: { conflict: 0, modified: 0, staged: 0, untracked: 2 },
  }), panelContext);

  expect(model.actions.map((action) => action.id)).toEqual([
    "openChanges",
    "switchWorktree",
  ]);
});

it("models rebasing conflicts without switch worktree or stash", () => {
  const model = deriveGitStatusDropdownModel(cleanStatus({
    counts: { conflict: 3, modified: 0, staged: 0, untracked: 0 },
    repoState: { conflictCount: 3, current: 2, kind: "rebasing", total: 5 },
  }), panelContext);

  expect(model.variant).toBe("active");
  expect(model.actions.map((action) => action.id)).toEqual([
    "openChanges",
    "continueRebase",
    "abortRebase",
  ]);
});

it("models cherry-pick pause as review-only", () => {
  const model = deriveGitStatusDropdownModel(cleanStatus({
    counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
    repoState: { conflictCount: 2, kind: "cherry-picking" },
  }), panelContext);

  expect(model.actions.map((action) => action.id)).toEqual(["openChanges"]);
});

it("models clean merged upstream-gone branch without prune", () => {
  const model = deriveGitStatusDropdownModel(cleanStatus({
    branch: {
      branch: "feature/auth-flow",
      mergedIntoDefault: true,
      upstreamGone: true,
    },
  }), panelContext);

  expect(model.variant).toBe("completed");
  expect(model.primaryAction).toBe("switchWorktree");
  expect(model.actions.map((action) => action.id)).toEqual([
    "switchWorktree",
    "openChanges",
  ]);
});
```

- [ ] **Step 2: Run model tests and verify red**

Run: `pnpm test tests/unit/renderer/git-status-dropdown-model.test.ts`

Expected: fail because `git-status-dropdown-model.ts` does not exist.

- [ ] **Step 3: Implement the model**

Define exported types:

```ts
export type GitStatusDropdownActionId =
  | "abortMerge"
  | "abortRebase"
  | "continueRebase"
  | "openChanges"
  | "stash"
  | "switchWorktree";

export interface GitStatusDropdownModel {
  actions: Array<{ id: GitStatusDropdownActionId; variant: "default" | "destructive" | "ghost" | "outline" }>;
  branchLabel: string;
  contextLine: string;
  primaryAction: GitStatusDropdownActionId;
  statusLine: string;
  summary: string;
  variant: "active" | "clean" | "completed" | "dirty";
  worktreePath: string;
}
```

Rules:

- `repoState.kind !== "clean"` wins over dirty/clean/completed.
- `rebasing` actions: `openChanges`, `continueRebase`, `abortRebase`.
- `merging` actions: `openChanges`, `abortMerge`.
- `cherry-picking`, `reverting`, `bisecting` actions: `openChanges` only.
- Tracked changes are `staged + modified + conflict`; untracked does not enable plain stash.
- Clean completed branch means `mergedIntoDefault === true || upstreamGone === true`, actions `switchWorktree`, `openChanges`.
- `Switch Worktree` is hidden for active operations.

- [ ] **Step 4: Run model tests and verify green**

Run: `pnpm test tests/unit/renderer/git-status-dropdown-model.test.ts`

Expected: all tests pass.

## Task 2: Dropdown Component And Git Actions

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-status-dropdown.tsx`
- Test: `tests/unit/renderer/git-status-dropdown.test.tsx`

- [ ] **Step 1: Write failing component tests**

Cover these exact behaviors:

```ts
it("opens Git Changes from the dirty dropdown", async () => {
  render(<GitStatusDropdown context={context} model={dirtyModel} pluginContext={pluginContext}>trigger</GitStatusDropdown>);
  await user.click(screen.getByRole("button", { name: /trigger/i }));
  await user.click(screen.getByRole("button", { name: "Open Git Changes" }));
  expect(pluginContext.panels.open).toHaveBeenCalledWith("pier.git.changes", { context });
});

it("opens worktree quick pick from clean completed dropdown", async () => {
  render(<GitStatusDropdown context={context} model={completedModel} pluginContext={pluginContext}>trigger</GitStatusDropdown>);
  await user.click(screen.getByRole("button", { name: /trigger/i }));
  await user.click(screen.getByRole("button", { name: "Switch Worktree" }));
  expect(pluginContext.commandPalette.openQuickPick).toHaveBeenCalled();
});

it("confirms before aborting rebase and skips API call when cancelled", async () => {
  pluginContext.dialogs.confirm.mockResolvedValueOnce(false);
  render(<GitStatusDropdown context={context} model={rebaseModel} pluginContext={pluginContext}>trigger</GitStatusDropdown>);
  await user.click(screen.getByRole("button", { name: /trigger/i }));
  await user.click(screen.getByRole("button", { name: "Abort" }));
  expect(pluginContext.git.abortRebase).not.toHaveBeenCalled();
});

it("routes continue rebase conflict to Git Changes review prompt", async () => {
  pluginContext.git.continueRebase.mockResolvedValueOnce({ kind: "conflict", message: "still conflicted" });
  pluginContext.dialogs.confirm.mockResolvedValueOnce(true);
  render(<GitStatusDropdown context={context} model={rebaseModel} pluginContext={pluginContext}>trigger</GitStatusDropdown>);
  await user.click(screen.getByRole("button", { name: /trigger/i }));
  await user.click(screen.getByRole("button", { name: "Continue Rebase" }));
  expect(pluginContext.panels.open).toHaveBeenCalledWith("pier.git.changes", { context });
});
```

- [ ] **Step 2: Run component tests and verify red**

Run: `pnpm test tests/unit/renderer/git-status-dropdown.test.tsx`

Expected: fail because component does not exist.

- [ ] **Step 3: Implement component**

Use:

- `Popover`, `PopoverTrigger`, `PopoverContent` from `@pier/ui/popover.tsx`.
- `Button` from `@pier/ui/button.tsx`.
- `Badge` from `@pier/ui/badge.tsx`.
- `Separator` from `@pier/ui/separator.tsx`.
- lucide icons with `data-icon`.

Implementation constraints:

- `PopoverContent side="top" align="end" className="w-80 gap-3 rounded-2xl p-3"`.
- No `Card`, no raw colors, no `space-y-*`, no manual `z-index`.
- `Open Git Changes`: `pluginContext.panels.open("pier.git.changes", { context })`.
- `Switch Worktree`: call existing `openWorktreeListQuickPick(pluginContext, model.worktreePath)`.
- `Stash`: `context.git.stash(context.gitRoot, { includeUntracked: false })`; success notification includes `Git: Pop Stash...` / `Git: Apply Stash...`; `nothing_to_stash` shows info; `unavailable` and thrown errors use dialog/alert feedback.
- `Abort Rebase` / `Abort Merge`: call `dialogs.confirm` first; if false, return without Git API call.
- `Continue Rebase`: `conflict` asks to open review and opens `Git Changes` on confirm.

- [ ] **Step 4: Run component tests and verify green**

Run: `pnpm test tests/unit/renderer/git-status-dropdown.test.tsx`

Expected: all tests pass.

## Task 3: Wire Status Item

**Files:**
- Modify: `src/plugins/builtin/git/renderer/git-status-item.tsx`
- Modify: `tests/unit/renderer/git-status-item-config.test.tsx`

- [ ] **Step 1: Write failing integration assertion**

Extend `git-status-item-config.test.tsx`:

```ts
it("left click opens the Git status dropdown instead of direct worktree quick pick", async () => {
  await renderItem(true);
  fireEvent.click(screen.getByTestId("worktree-status-trigger"));
  expect(await screen.findByText("Open Git Changes")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the status item test and verify red**

Run: `pnpm test tests/unit/renderer/git-status-item-config.test.tsx`

Expected: fail because left-click still opens the quick pick and no dropdown exists.

- [ ] **Step 3: Wire `GitStatusDropdown`**

In `WorktreeStatusItem`:

- Keep `StatusBody` unchanged.
- Compute `const dropdownModel = deriveGitStatusDropdownModel(status, context, { fallbackWorktreeName: worktreeName, worktreePath })`.
- Wrap the status `Button` with `GitStatusDropdown`.
- Update tooltip and aria label to say Git status instead of only worktree switching.
- Keep `data-testid="worktree-status-trigger"` on the visible trigger.

- [ ] **Step 4: Run status item tests and verify green**

Run: `pnpm test tests/unit/renderer/git-status-item-config.test.tsx`

Expected: all tests pass.

## Task 4: Focused Verification

**Files:**
- All files touched above.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm test tests/unit/renderer/git-status-dropdown-model.test.ts tests/unit/renderer/git-status-dropdown.test.tsx tests/unit/renderer/git-status-item-config.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: pass.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Expected: pass.

- [ ] **Step 4: Inspect git diff**

Run: `git diff -- src/plugins/builtin/git/renderer tests/unit/renderer docs/superpowers`

Expected: only the dropdown implementation, tests, design doc, and this plan changed.

## Self-Review

- Spec coverage: covered information layering, worktree switch, Git Changes entry, no Sync Changes, no Prune Worktree, active operation behavior, destructive action confirmation, stash recovery feedback, and shadcn Popover constraints.
- Placeholder scan: no `TODO` / `TBD` / incomplete follow-up steps.
- Type consistency: model action IDs match component action handlers and test names.
