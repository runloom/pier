# Project Live Modules (`.pier/canvases`)

Engineering samples for Pier Live Modules. **Not** the product design-time plan
store — that lives in [`.pier/plans/`](../plans/README.md).

## Layout

```text
.pier/canvases/
  smoke/                 pipeline smoke (all frameworks) — keep
    hello.canvas.tsx     React
    hello.canvas.vue     Vue
    hello.canvas.solid.tsx
    hello.canvas.svelte
  templates/
    blank.canvas.tsx     minimal React composition scaffold
```

| Folder | Role |
|--------|------|
| **smoke/** | Compile → protocol → mount (four frameworks) |
| **templates/** | Thin AI/human start scaffolds only |

Design workflow dogfood (DAG / todo / plan.json): **`.pier/plans/`**.

## Conventions

1. Entries only: `*.canvas.*` (and framework suffixes).
2. React uses `pier/canvas`. Vue / Solid / Svelte use host `pier-c-*` shell classes.
3. Do not import Pier monorepo `src/**` from canvases — user projects will not have that path.

## Quick open

```text
smoke/hello.canvas.tsx
templates/blank.canvas.tsx
../plans/canvas-capabilities-v1/plan.canvas.tsx
```
