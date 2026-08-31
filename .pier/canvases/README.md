# Project Live Modules (`.pier/canvases`)

In-repo canvases for Pier Live Modules. Only three folders live here on
purpose — demos and per-recipe golds were removed (2026-08-28 cleanup); agents
start from `resources/system-skills/pier-canvas/templates/` instead.

## Layout

```text
.pier/canvases/
  smoke/                 pipeline test fixtures (all frameworks) — keep
    hello.canvas.tsx     React
    hello.canvas.vue     Vue
    hello.canvas.solid.tsx
    hello.canvas.svelte
    scoped-style.canvas.vue
  canvas-kit/            materials catalog（物料）— canvas discovery surface
  pier-cli-user-manual/  CLI user manual; data.json is the CLI docs source
                         of truth (tests/unit/cli locks coverage)
```

| Folder | Role |
|--------|------|
| **smoke/** | Compile → protocol → mount fixtures (four frameworks); live-modules unit tests read and write here |
| **canvas-kit/** | Primitive catalog referenced by SKILL + settings 物料 page |
| **pier-cli-user-manual/** | End-user CLI manual rendered as a canvas. GitHub README is four-locale (`README.md` zh-CN source, plus `README.en.md` / `README.ja.md` / `README.ko.md`). `data.json` stays the command SSOT (Chinese); do not copy it per locale. |

## Conventions

1. Entries only: `*.canvas.*` (and framework suffixes).
2. React uses `pier/canvas`. Vue / Solid / Svelte use host `pier-c-*` shell classes.
3. Do not import Pier monorepo `src/**` from canvases — user projects will not have that path.
4. Prefer system materials (`pier/canvas`) plus project-relative / tsconfig-path components.
5. New product canvases are generated per project by the `pier-canvas` skill;
   do not land new demos here without a test or catalog consumer.
