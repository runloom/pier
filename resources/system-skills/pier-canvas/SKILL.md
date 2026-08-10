---
name: pier-canvas
description: >-
  Create or update a Pier Canvas under .pier/canvases using pier/canvas and
  project components. Default mode builds a product overview with content /
  presentation / ui packs. Use only when explicitly invoked from Pier.
compatibility: Requires Pier with the pier/canvas React runtime.
disable-model-invocation: true
---

# Create a Pier Canvas

This skill only creates or updates Pier Canvases. Its canonical identifier is
`pier-canvas`:

- In Pier, type `/canvas` and select `pier-canvas` from the suggestions.
- Codex receives `$pier-canvas`; Cursor, Claude Code, and compatible agents
  receive `/pier-canvas`.
- `disable-model-invocation` is a Cursor compatibility hint. Pier still sends
  the canonical explicit invocation because this field is not portable across
  every Agent Skills client.
- If Cursor's built-in `canvas` skill is also present, follow this file for the
  current task. The two skills use different protocols.

**Canvas is a product-core overview surface**, not a CLI side effect. Parameters
below are **skill invocation args**, not shell flags.

## Invocation parameters

Parse these from the user message when present. Missing values use defaults.
Unknown pack ids are hard failures (do not guess).

| Param | Default | Meaning |
| --- | --- | --- |
| `mode` | `methodology` | `methodology` = overview packs; `freeform` = classic free authoring |
| `content` | `design-doc` | Content pack id under `packs/content/` |
| `presentation` | `primary_nav_5` | Presentation pack id under `packs/presentation/` |
| `ui` | `pier-default` | UI pack id under `packs/ui/` |
| `slug` | derived from title | Directory name under `.pier/canvases/<slug>/` |

Examples (skill calls, not shell):

```text
/pier-canvas content=closed-loop presentation=primary_nav_5
  Build an overview for the multi-agent CLI gold scheme

/pier-canvas content=design-doc presentation=one_pager
  One-page design overview for <topic>

/pier-canvas mode=freeform
  Freeform canvas without methodology packs
```

Recommended combo for runtime/control-plane schemes:

```text
content=closed-loop presentation=primary_nav_5 ui=pier-default
```

Project pack override (when present, wins over built-in):

```text
.pier/canvas-packs/{content,presentation,ui}/<id>/pack.json
```

## Hard boundaries

- Write outputs only under `.pier/canvases/**` in the current project
  (product default). Preview roots are the full editable list in
  `.pier/live-modules.json` → `contentDirectories` (factory defaults:
  `.pier/canvases` + `docs`, also editable under Settings → Projects →
  General). Legacy `extraContentDirectories` is one-way migrated as
  defaults ∪ extras. `/pier-canvas` still creates under `.pier/canvases`
  unless the user explicitly asks otherwise.

- Import React Canvas APIs from `pier/canvas`. Never use `cursor/canvas`.
- Never write to product-private caches such as
  `~/.cursor/projects/**/canvases`.
- Do not access `window.pier`, Electron, Node.js, IPC, `eval`, or dynamic
  imports.
- Do not copy Pier host component source. Compose `pier/canvas` primitives and
  existing project components.
- A Canvas runs as trusted project code in the host renderer realm. It is not a
  security sandbox.
- Do not register extra system skills for each methodology pack. Packs live
  under this skill's `packs/` directory.

## Workflow A — methodology (default)

Use when `mode` is omitted or `mode=methodology`.

1. Resolve packs: project `.pier/canvas-packs/...` then this skill's `packs/`.
   Read each `pack.json`. Hard fail if any id is missing.
2. Choose `kind: "composition"` for product overviews unless the user
   explicitly needs `docs` or `kit`.
3. Create or update:

   ```text
   .pier/canvases/<slug>/
     instance.json
     data.json
     <slug>.canvas.tsx
   ```

4. **Content pack**: fill or update `data.json` only. Follow `required`,
   `gates`, and `agentPrompt` in the pack. Do not invent layout here.
5. Run content gates. If any fail, stop and list missing fields.
6. **Presentation pack**: implement the overview Canvas from `views` and
   `antiPatterns`. Overview obligations:
   - First screen: BLUF/conclusion + goals or constraints + ≤1 main diagram
   - Ordered nav with exactly one `primary` view; ≤5 top-level tabs
   - Plan DAGs, competitor essays, and review archives are not the default tab
   - **Expression**: default **static** product design (see methodology
     «Expression selection»). Do not add Play/Step demo chrome unless the user
     explicitly needs a mechanism explainer with per-frame insight.
7. **UI pack**: apply `rules` / `forbidden` (default `pier-default`).
8. Write `instance.json`:

   ```json
   {
     "schemaVersion": 1,
     "content": "<content id>",
     "presentation": "<presentation id>",
     "ui": "<ui id>",
     "status": "draft",
     "role": "overview"
   }
   ```

9. Prefer `templates/overview.canvas.tsx` as the solid starting point for
   `primary_nav_5` (五段：速览 → 问题 → 设计 → 日路径 → 落地). Prefer a single
   scrolling Frame for `one_pager`. Dogfood:
   `.pier/canvases/multi-agent-orchestration-gold/`.
10. Read `sdk/index.d.ts` and focused declarations before using APIs.
11. Run verification requirements before delivery.

Restyle (same content, new presentation/ui): keep `data.json`, change
presentation/ui packs, regenerate the Canvas and update `instance.json`.

## Workflow B — freeform

Use when `mode=freeform` (or the user clearly asks for an unconstrained canvas).

1. Check `.pier/canvases/**` for a matching Canvas. Update in place when it
   exists.
2. Read only relevant project code, design system, and existing Canvases.
3. Read `sdk/index.d.ts`, then focused declarations for every API used.
4. Choose one kind: `composition` | `docs` | `kit`.
5. Default structure:

   ```text
   .pier/canvases/<slug>/<slug>.canvas.tsx
   ```

   Optional adjacent `data.json` via `useCanvasFile`.
6. Start from the closest thin template in `templates/`.
   - **`docs`**: start from `templates/docs.canvas.tsx` and use **`DocsShell`**
     for left nav + right article (do not hand-roll dual ScrollArea shells).
   - Command inventories: one Accordion list; badge only unfinished items.
7. Export valid `canvas` metadata.
8. Do **not** require `instance.json` methodology fields.
9. Run verification requirements.

## Content requirements

- Establish a clear information hierarchy before decoration.
- Charts must identify metrics, units, time ranges, and sources.
- Do not render fabricated data or empty decorative cards.
- Prefer direct layout over unnecessary card stacking.
- Every user action needs a recognizable UI change or error response.
- Add `schemaVersion` to adjacent `data.json` files. Data-focused Canvases
  should also record `source` and `generatedAt`.

## Verification requirements

Before delivery, confirm at least:

1. Files are under `.pier/canvases/**`, the entry default-exports a mountable
   component, and the `canvas` metadata is valid.
2. Compilation has no error-level diagnostics.
3. The Canvas mounts in practice; type checking alone is not runtime evidence.
4. Exercise at least one primary interaction. For a read-only Canvas, inspect
   the main reading path and responsive layout.
5. `useCanvasFile` writes only adjacent files and handles `conflict` and
   `failed` results.
6. No `cursor/canvas`, product-private cache path, or host-private API is used.
7. **Methodology mode only**: `instance.json` pins the three pack ids;
   overview has a BLUF-level conclusion; tab count ≤5 when using tabbed
   presentation packs.

See [verification](references/verification.md),
[authoring](references/authoring.md), and
[methodology](references/methodology.md).

## Delivery

The final response must include:

- The project-relative Canvas path.
- Whether the Canvas was created or updated, and the selected `kind`.
- For methodology mode: `content`, `presentation`, `ui` actually used.
- The compilation, mount, and interaction checks actually completed.
- Any checks not completed. Do not present manual inspection as automated
  evidence.
