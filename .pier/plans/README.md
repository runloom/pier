# `.pier/plans` — design-time workflow artifacts

L3 dogfood / product-design workflow (not a host task service).

| Path | Role |
|------|------|
| `lib/plan-model.ts` | **Portable** pure helpers (layout, readPlan). Relative import only — never Pier `src/shared`. |
| `<planId>/plan.json` | Source of truth: nodes, deps, status |
| `<planId>/plan.canvas.tsx` | **Single entry**: Tabs = 任务 / 依赖图 / 说明 |

Open `plan.canvas.tsx` in the files panel (Live Modules). One plan → one canvas.

User projects: copy `lib/` + a plan folder; paths stay under `.pier/plans/**` only.

Spec: `docs/superpowers/specs/2026-07-26-canvas-product-design-workflow-design.md`
