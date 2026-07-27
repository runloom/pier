# Project Live Modules (`.pier/canvases`)

Engineering samples for Pier Live Modules — the framework acceptance path for
compile → protocol → mount. Product canvases generated later by `/canvas`
should land here too.

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

## Conventions

1. Entries only: `*.canvas.*` (and framework suffixes).
2. React uses `pier/canvas`. Vue / Solid / Svelte use host `pier-c-*` shell classes.
3. Do not import Pier monorepo `src/**` from canvases — user projects will not have that path.
4. Prefer system materials (`pier/canvas`) plus project-relative / tsconfig-path components.

## Quick open

```text
smoke/hello.canvas.tsx
templates/blank.canvas.tsx
```
