# Project Live Modules (`.pier/canvases`)

Dogfood + verification layout for Pier Live Modules. Entries must live under this
directory with a canvas suffix (`.canvas.tsx` / `.vue` / `.svelte` / `.canvas.solid.tsx`).

## Layout

```text
.pier/canvases/
  README.md
  smoke/                         pipeline smoke only
    hello.canvas.tsx             React
    hello.canvas.vue             Vue
    hello.canvas.solid.tsx       Solid
    hello.canvas.svelte          Svelte
  templates/                     product-shaped examples (React + pier/canvas)
  stress/                        multi-file + hooks quality stress
    workbench-proposal.canvas.tsx
    components/  lib/
  shared/                        helpers shared across entries (not canvas entries)
    demo-chip.tsx
```

| Folder | Role |
|--------|------|
| **smoke/** | Prove compile → protocol → mount (all frameworks, flat) |
| **templates/** | Product form (kit / composition / docs) |
| **stress/** | Multi-file graph + interactive hooks |
| **shared/** | Local non-entry helpers |

## Conventions

1. **Entries** only: `*.canvas.*` (and framework suffixes). Helpers are plain modules under `shared/` or a feature folder’s `components/` / `lib/`.
2. **React** uses `pier/canvas`. **Vue / Solid / Svelte** use host `pier-c-*` shell classes or project components.
3. Prefer relative imports within this tree for dogfood.

## Quick open

```text
smoke/hello.canvas.tsx
smoke/hello.canvas.vue
templates/kit.canvas.tsx
stress/workbench-proposal.canvas.tsx
```
