---
name: pier-canvas
description: >-
  Create or update a Pier Canvas under .pier/canvases using pier/canvas,
  pier/host, and project components. Default mode builds a product overview
  with content / presentation / ui packs. Use only when explicitly invoked
  from Pier.
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
| `presentation` | *resolved* | See **Pack selection**. Do not default every overview to five tabs. |
| `ui` | `pier-default` | UI pack id under `packs/ui/` |
| `recipe` | (none) | Freeform starter: `design`, `orchestration`, or `board` (see **Stage selection**). Ignored in methodology mode. |
| `slug` | derived from title | Directory name under `.pier/canvases/<slug>/` |
| `locale` | injected by Pier | BCP-47 UI language (`en`, `zh-CN`, …). Host adds this on send. |

**Pack selection** (presentation omitted → resolve from content; explicit id wins):

| content | resolved presentation | Use when |
| --- | --- | --- |
| `design-doc` (default) | `decision_nav_4` | Architecture / RFC / product decision. Four tabs: Overview → Problem → Design → Landing. **No Day-1 tab.** |
| `closed-loop` | `primary_nav_5` | Runtime / CLI control plane with a copyable Day-1 recipe. Five tabs: Overview → Problem → Design → **Day 1** → Landing. |
| either | `one_pager` (explicit) | Short single-scroll BLUF |

Unknown pack ids are hard failures. Do not invent a Day-1 tab for `design-doc` unless the user has a real ≤4-step recipe **and** they pass `presentation=primary_nav_5`.

## Audience language

Skill files and pack ids are English (agent protocol). **Every user-visible string in the Canvas and `data.json` must match the user.**

Resolve language in this order:

1. The `locale=` invocation arg (Pier injects the current UI language on send).
2. If `locale` is missing, the language of the current user request.
3. Never keep the template language just because the starter file used it.

Tab labels come from **one glossary**: `i18n/nav.json`.

```text
labels[<viewId>][<locale>] ?? labels[<viewId>].en ?? view.label
```

`en` is required. Other locales are optional — missing keys fall back to `en`. Adding a language means adding a column in `i18n/nav.json` only.

Apply that language to tab labels, titles, badges, body copy, table headers, `aria-label`s, and `canvas.title` / `canvas.description`. View **ids** stay English (`overview`, `problem`, `design`, `path`, `landing`).

Examples (skill calls, not shell):

```text
/pier-canvas
  Design-doc overview (decision_nav_4)

/pier-canvas content=closed-loop
  Runtime closed-loop (primary_nav_5, includes Day 1)

/pier-canvas content=design-doc presentation=one_pager
  One-page design overview for <topic>

/pier-canvas mode=freeform recipe=design
  Multi-device mockup on a world stage

/pier-canvas mode=freeform recipe=orchestration
  Live DAG viewer (FlowGraph + watch + declared command)

/pier-canvas mode=freeform recipe=board
  Full-bleed kanban (fill + Sortable / Droppable + sibling JSON)
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

- Before assembling, look at `.pier/canvases/canvas-kit/canvas-kit.canvas.tsx`
  and `sdk/*.d.ts`. Only import named exports that already exist in
  `pier/canvas`. Import commands, events, and snapshots from `pier/host`.
  The API tab is a capability catalog (`useCanvasFile` plus host domains).
  Do not invent APIs or import workbench widgets.
  Plugin data: `plugin.list` / `inspect` → `useHostSnapshot("plugin:<id>/<key>")`
  → declared `pluginAction.invoke` only. Add/remove/OAuth via `settings.open`.
  Compose with primitives (`Item`, `Table`, `Progress`); see
  `references/host-data.md`. Never ship `AccountsCard` / `canvasWidgets`.

- Write outputs only under `.pier/canvases/**` in the current project
  (product default). Preview roots are the full editable list in
  `.pier/live-modules.json` → `contentDirectories` (factory defaults:
  `.pier/canvases` + `docs`, also editable under Settings → Projects →
  General). Legacy `extraContentDirectories` is one-way migrated as
  defaults ∪ extras. `/pier-canvas` still creates under `.pier/canvases`
  unless the user explicitly asks otherwise.

- Import React Canvas UI from `pier/canvas`. Import commands from
  `pier/host`. Never use `cursor/canvas`.
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

## Stage selection (flow vs world vs fill)

The files preview is **one shell**. The canvas root chooses the geometry.
Do not set a meta flag or invent a third “app mode”.

Four root shells exist. **Pick the shell from the user's ask before writing
code — do not ask the user to choose a shell:**

| Root shell | Auto-select when the ask is… | Preview chrome it gets |
| --- | --- | --- |
| `Frame` (flow, default) | An article, decision overview, dashboard that scrolls | Reading measure (`max-w-5xl`); no zoom chrome |
| `DocsShell` (flow, docs) | A manual / multi-section docs site with sidebar nav | Inherits global reading size + document font passively; **no floating font-scale control** — the docs shell owns its chrome |
| `<Stack fill>` (`data-canvas-fill`) | A one-screen board or app shell that owns its own scroll | Full-bleed; the flow measure is dropped |
| `WorldStage` | Multi-device mockups, live DAG, whiteboard layout | Viewport zoom/pan; fit / 100% controls (world only) |

- Do not wrap a reading doc in `WorldStage`.
- Do not stack phone/desktop frames as a document inside `Frame` — use
  `WorldStage` + `Artboard` (`preset`) + `Layer`.
- Full-bleed kanban / app shells use **fill**, not world.
- `ArtboardStage` stays a **fit-all card in flow** (same as `Mermaid`). Inline
  zoom/pan is world only.
- Unknown `recipe` ids are hard failures. Known recipes:

| `recipe` | Pack | Stage | Start from |
| --- | --- | --- | --- |
| `design` | `packs/recipes/design/` | world | `templates/design-mockup.canvas.tsx` |
| `orchestration` | `packs/recipes/orchestration/` | world | `templates/dag-viewer.canvas.tsx` |
| `board` | `packs/recipes/board/` | fill | `templates/kanban.canvas.tsx` |

When `recipe=` is set, use **Workflow B** (freeform). Do not invent methodology
tabs for a mockup or a DAG viewer.

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

9. Templates: `templates/decision.canvas.tsx` for `decision_nav_4` (four tabs, no Day 1);
   `templates/overview.canvas.tsx` for `primary_nav_5` (five tabs including Day 1);
   single scrolling Frame for `one_pager`. Starters are English scaffolds —
   rewrite visible copy into the user's language.
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
     Body text uses the host **document font**; live component demos inside
     the article keep the **UI font**.
   - **`composition` / `kit`**: use the **UI font** only — never the host
     document font or a custom reading serif (design frames and component
     catalogs must look like product UI).
     - **`recipe=design`**: `WorldStage` root; `Artboard preset` + `Layer`;
       comments stay in host Design Mode (do not fake annotation chrome).
     - **`recipe=orchestration`**: `WorldStage` + `FlowGraph` with
       `presentation="plain"`; persist node positions with `useCanvasFile`
       (`state/positions.json`); declare commands in `instance.json` and call
       `file.invokeCommand(key)`. After `{ kind: "started" }`, pull
       `host.invoke({ type: "run.output", runId })` and
       `useHostSnapshot("pier://tasks:runs-changed")`. Poll a loopback
       service with `fetch("http://127.0.0.1:…")` — never `https:`. Status
       lives in the external system; this canvas is a viewer. Node `meta` /
       `badge`, `renderOverlay` (gates), and `onSelectNode` + a `Stack` beside
       the graph are the inspect surface. `renderNodeContent` is display
       chrome (`contentHeight` required); keep buttons beside the graph.
       Relayout with `layoutFlowGraph` or by writing empty positions.
     - **`recipe=board`**: root `<Stack fill>`; `Droppable` columns +
       `Sortable` cards; persist the board with `useCanvasFile` (`board.json`)
       and `watch` so other windows stay in sync. Cross-column moves land in
       the target `Sortable.onDropItem(itemId, index)` — one callback, one
       write (do not also mutate from the source `onReorder`). Not a host
       task ledger.
     - Multi-screen mockups without `recipe=`: still prefer `WorldStage`.
       `ArtboardStage` is only the flow fit-all card (no wheel capture).
     - Command inventories: one Accordion list; badge only unfinished items.
7. Export valid `canvas` metadata.
8. Do **not** require `instance.json` methodology fields.
9. Run verification requirements.

## Content requirements

- Write user-visible copy in the user's language (see **Audience language**).
- Establish a clear information hierarchy before decoration.
- Charts must identify metrics, units, time ranges, and sources.
- Do not render fabricated data or empty decorative cards.
- **Mermaid chrome:** flowchart / architecture use `nodes` / `edges`.
  Architecture / main-loop nodes set `kind`
  (`actor` | `agent` | `tool` | `artifact` | `external`). State-machine /
  error-exit nodes set `tone`. Sequence / state / `class` / ER / mindmap
  use native mermaid `source` (`sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`, `mindmap`) — do not invent a nodes/edges
  dialect for `sequence` or class diagrams. Do not paint `tone` as
  decoration, and do not invent a left color rail. The host writes mermaid
  flowchart text and paints Pier chrome on slotted nodes. **Live DAG /
  pipeline viewers use `FlowGraph`** (`recipe=orchestration`), not Mermaid.
  Put `presentation="plain"` on the world stage. Live-DAG display chrome
  belongs on FlowGraph (`renderNodeContent` + `contentHeight`, `renderOverlay`,
  node `meta` / `badge`). Mermaid `status` / `renderNodeContent` is leftover
  for static architecture diagrams that need a run glyph — do not teach it
  as a polling viewer.
  See [authoring](references/authoring.md) **Mermaid** and **FlowGraph**.
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
