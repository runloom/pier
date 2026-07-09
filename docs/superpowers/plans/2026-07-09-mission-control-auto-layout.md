# Mission Control Auto Layout Implementation Plan

> Superseded: this plan's default-render integration has been replaced by
> `2026-07-09-mission-control-grid-interaction.md`. `deriveOptimalAutoLayout`
> must run only from the explicit "Arrange Layout" action; default 12-column
> rendering preserves the persisted user layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mission Control's local first-fit responsive layout with a pure auto-layout solver that optimizes utilization, stable reading order, low gaps, no ordinary orphan row, and priority-based width growth.

**Architecture:** Layout metadata lives in the shared Mission Control contract and widget declarations. `mission-control-grid-geometry.ts` owns the pure solver and scoring; `mission-control-panel.tsx` only consumes the derived display layout. Auto-derived `x/y/w/h` is never written back to persisted panel params.

**Tech Stack:** TypeScript, React 19, `react-grid-layout`, Zod contracts, Vitest.

---

### Task 1: Contract And Core Metadata

**Files:**
- Modify: `src/shared/contracts/mission-control.ts`
- Modify: `src/renderer/panel-kits/mission-control/core-mission-control-widgets.ts`
- Test: `tests/unit/shared/mission-control-contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that parse plugin widget declarations with:

```ts
layoutPriority: "primary",
layoutProfiles: [
  { h: 2, key: "compact", w: 3 },
  { h: 3, key: "normal", w: 4 },
  { h: 3, key: "wide", w: 6 },
]
```

Expected failure before implementation: unknown keys are stripped or rejected.

- [ ] **Step 2: Implement contract types**

Add `missionControlWidgetLayoutPrioritySchema`, `missionControlWidgetLayoutProfileSchema`, optional `layoutPriority`, and optional `layoutProfiles`.

- [ ] **Step 3: Add core widget metadata**

Give activity/system/custom widgets explicit profiles and priorities. Activity and system are `primary`; custom cards are `normal`.

### Task 2: Pure Auto Layout Solver

**Files:**
- Modify: `src/renderer/panel-kits/mission-control/mission-control-grid-geometry.ts`
- Test: `tests/unit/renderer/mission-control-grid-geometry.test.ts`

- [ ] **Step 1: Write failing solver tests**

Add tests for:
- `deriveOptimalAutoLayout` fills 12 columns for two primary widgets instead of leaving the right side empty.
- visual reading order equals input order.
- ordinary final orphan is avoided when an alternative row split exists.
- primary widgets receive extra width before normal widgets.
- derived layout is deterministic and does not mutate input.

- [ ] **Step 2: Implement profile normalization**

Build candidate sizes from `layoutProfiles` when present. Fall back to `minSize/defaultSize/maxSize` by creating compact/default/wide candidates.

- [ ] **Step 3: Implement row dynamic programming**

Enumerate contiguous row slices, choose candidate widths that fit `cols`, score gaps and orphan risk, then backtrack best rows into RGL `LayoutItem[]`.

### Task 3: Panel Integration

**Files:**
- Modify: `src/renderer/panel-kits/mission-control/mission-control-panel.tsx`
- Modify: `src/renderer/panel-kits/mission-control/use-mission-control-panel-state.ts`
- Test: `tests/component/mission-control-panel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add tests that opening a 12-column panel with two core widgets gives display sizes that use the full row, and that mount/resize does not call `updateParameters`.

- [ ] **Step 2: Wire solver into panel display layout**

Use `deriveOptimalAutoLayout(basisLayout, cols, { getSizeDeclaration })` for display layout. Continue passing derived layout to `handleLayoutChange` so persisted params are only updated for real user changes.

- [ ] **Step 3: Keep edit affordances consistent**

Do not reintroduce manual resize presets. Keep settings/refresh available according to widget capability, and keep destructive composition actions behind unlocked layout state.

### Task 4: Verification

**Files:**
- Test commands only.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm exec vitest run tests/unit/renderer/mission-control-grid-geometry.test.ts tests/component/mission-control-panel.test.tsx tests/unit/shared/mission-control-contracts.test.ts tests/unit/renderer/mission-control-library.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
pnpm exec ultracite check src/shared/contracts/mission-control.ts src/renderer/panel-kits/mission-control/core-mission-control-widgets.ts src/renderer/panel-kits/mission-control/mission-control-grid-geometry.ts src/renderer/panel-kits/mission-control/mission-control-panel.tsx src/renderer/panel-kits/mission-control/use-mission-control-panel-state.ts tests/unit/shared/mission-control-contracts.test.ts tests/unit/renderer/mission-control-grid-geometry.test.ts tests/component/mission-control-panel.test.tsx
pnpm typecheck
```

Expected: both commands exit 0.
