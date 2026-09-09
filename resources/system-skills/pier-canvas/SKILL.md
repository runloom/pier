---
name: pier-canvas
description: >-
  Create or update a Pier Canvas under .pier/canvases using pier/canvas,
  pier/host, and project components. When mode / recipe / content are omitted,
  you infer the preview shell from intent (world mockup, fill board, docs, or
  methodology overview). Use only when explicitly invoked from Pier.
compatibility: Requires Pier with the pier/canvas React runtime.
disable-model-invocation: true
---

# Create a Pier Canvas

Canonical id: `pier-canvas`. In Pier, type `/canvas` and select it. Codex:
`$pier-canvas`. Cursor / Claude Code: `/pier-canvas`.
`disable-model-invocation` is a Cursor hint; Pier still sends the explicit
invocation. If Cursor's `canvas` skill is present, follow this file.

Canvas is a product-core overview, not a CLI side effect. Parameters are
**skill invocation args**, not shell flags.

| File | Owns |
| --- | --- |
| [authoring.md](references/authoring.md) | APIs, fonts, geometry, Mermaid, WorkflowDiagram |
| [methodology.md](references/methodology.md) | Axes, expression, tab IA |
| [verification.md](references/verification.md) | Delivery checks |
| [host-data.md](references/host-data.md) | Plugin snapshots, applets, `settings.open` |
| `packs/*/pack.json` | Fields, gates, anti-patterns, `template` |

## Invocation parameters

Parse from the user message. **You infer omitted route args** (see
**Auto-resolve**). The host only injects `locale=`. Unknown pack ids are hard
failures. Explicit `mode=` / `recipe=` / `content=` / `presentation=` always
win.

| Param | Default | Meaning |
| --- | --- | --- |
| `mode` | *you infer* | `methodology` or `freeform`. Fallback after infer: `methodology`. |
| `content` | *you infer* | `packs/content/` id. Methodology only. Fallback: `design-doc`. |
| `presentation` | *resolved* | **Pack selection** below. Do not default every overview to five tabs. |
| `ui` | `pier-default` | `packs/ui/` id |
| `recipe` | *you infer* | `design`, `workflow`, `task-list`, or `task-dag`. Ignored in methodology. Daily tracking is the plugin panel (⌘N), not a canvas kanban. |
| `slug` | from title | `.pier/canvases/<slug>/` |
| `locale` | injected | BCP-47 (`en`, `zh-CN`, …). |

**Pack selection** (omitted presentation → from content; explicit id wins):

| content | presentation | Use when |
| --- | --- | --- |
| `design-doc` | `decision_nav_4` | RFC / architecture. Overview → Problem → Design → Landing. No Day-1 tab. |
| `closed-loop` | `primary_nav_5` | Runtime with a copyable Day-1 recipe. Overview → Problem → Design → **Day 1** → Landing. |
| either | `one_pager` (explicit) | Single-scroll BLUF |

Do not invent a Day-1 tab for `design-doc` unless the user has a real ≤4-step
recipe **and** passes `presentation=primary_nav_5`. Project override:
`.pier/canvas-packs/{content,presentation,ui}/<id>/pack.json`.

## Audience language

Skill files and pack ids are English. **Every user-visible string must match
the user.**

1. `locale=` (Pier injects UI language).
2. Else the language of the current request.
3. Never keep template English because the starter used it.

Tab labels: `i18n/nav.json` →
`labels[<viewId>][<locale>] ?? labels[<viewId>].en ?? view.label`.
View ids stay English (`overview`, `problem`, `design`, `path`, `landing`).

## Auto-resolve (do this first)

**You choose the preview shell.** The host does not infer the shell and does
not rewrite the invoke. Do not start Workflow A just because `/pier-canvas`
was typed. Do not ask which shell to use.

| Intended artifact | Infer | Root | Pack / start from |
| --- | --- | --- | --- |
| Product **screens** | `mode=freeform recipe=design` | `WorldStage` | `packs/recipes/design/` · `templates/design-mockup.canvas.tsx` |
| Approval / recover flowchart | `mode=freeform recipe=workflow` | `WorkflowDiagram` | `packs/recipes/workflow/` · `templates/workflow.canvas.tsx` |
| One-screen board that owns scroll | `mode=freeform` | `<Stack fill>` | compose; no starter |
| Named task list island | `mode=freeform recipe=task-list` | `Frame` | `packs/recipes/task-list/` · `templates/task-list.canvas.tsx` |
| Named task DAG island | `mode=freeform recipe=task-dag` | `Frame` | `packs/recipes/task-dag/` · `templates/task-dag.canvas.tsx` |
| Manual / handbook | `mode=freeform` | `DocsShell` | `templates/docs.canvas.tsx` |
| Component catalog | `mode=freeform` | `Frame` | `.pier/canvases/canvas-kit/` (no skill starter) |
| Control plane with Day-1 recipe | `mode=methodology content=closed-loop` | `Frame` | `templates/closed-loop.canvas.tsx` |
| Decision / RFC, or a bare invoke | `mode=methodology content=design-doc` | `Frame` | `templates/decision.canvas.tsx` |
| Short single-scroll BLUF | `presentation=one_pager` | `Frame` | `templates/one-pager.canvas.tsx` |

Mixed intent → pick the **primary** artifact. Architecture “design” is a
document. App-screen “design” is a world mockup.

- A mockup is **not** a design-doc with Artboards inside a Design tab.
- Do not wrap a reading doc in `WorldStage`.
- Do not stack phone/desktop frames as a document inside `Frame`.
- Explicit args win. Omitted `mode` is **not** a synonym for methodology.
- Do **not** scaffold a tracker-board canvas. Daily tracking is ⌘N → Task
  tracker.

Unknown `recipe` ids are hard failures. When `recipe=` is set, use
**Workflow B**.

## Stage selection (flow vs world vs fill)

The files preview is **one shell**. **Pick the shell from the user's ask** —
do not ask the user. Geometry: [authoring.md](references/authoring.md).

| Root shell | When | Preview chrome |
| --- | --- | --- |
| `Frame` (flow) | Article, decision overview, scrolling dashboard | Reading measure (`max-w-5xl` comfortable / full-bleed wide); no zoom |
| `DocsShell` (flow) | Manual with sidebar | Document font + reading size; **no floating font-scale control** |
| `<Stack fill>` | One-screen board that owns scroll | Full-bleed; measure dropped |
| `WorldStage` | Multi-device mockups, whiteboard | Viewport zoom/pan; fit / 100% |

- Full-bleed boards use **fill**, not world.
- `ArtboardStage` is a **fit-all card in flow** (same as `Mermaid`). Wheel
  zoom is world only.

## Hard boundaries

- Look at `.pier/canvases/canvas-kit/canvas-kit.canvas.tsx` and `sdk/*.d.ts`.
  **Only import named exports** from `pier/canvas`. Commands from
  `pier/host`. Plugin data: `plugin.list` / `inspect` →
  `useHostSnapshot("plugin:<id>/<key>")` → declared `pluginAction.invoke`.
  CRUD/OAuth via `settings.open`. See [host-data.md](references/host-data.md).
  Never ship `AccountsCard` / `canvasWidgets`.
- Write under `.pier/canvases/**` unless the user asks otherwise.
- Never `cursor/canvas`, `window.pier`, Electron, Node, IPC, `eval`, dynamic
  import, or host component source.
- Do not register extra system skills per pack.

## Workflow A — methodology

Use when you inferred an overview or `mode=methodology`. Not for a UI mockup.

1. Resolve packs (project then built-in). Hard fail if missing.
2. `kind: "composition"` unless the user needs `docs` or `kit`.
3. Write `.pier/canvases/<slug>/{instance.json,data.json,<slug>.canvas.tsx}`.
4. Content pack → `data.json` from `required` / `gates` / `agentPrompt`. No
   layout.
5. Run gates; stop on failure.
6. Presentation pack → `views` / `antiPatterns` / `template`. BLUF first; one
   `primary`; ≤5 tabs. **static product design** (methodology
   **Expression selection**). No Play/Step unless a mechanism explainer.
7. UI pack `rules` / `forbidden` (default `pier-default`).
8. `instance.json`: `content`, `presentation`, `ui`, `status: "draft"`,
   `role: "overview"`.
9. Read `sdk/index.d.ts`. Run [verification.md](references/verification.md).

Restyle: keep `data.json`, change packs, regenerate the Canvas.

## Workflow B — freeform

Use when `mode=freeform`, `recipe=` is set, or you inferred a freeform shell.

1. Update in place when a matching Canvas exists.
2. Read relevant project code and `sdk/index.d.ts`.
3. Kind: `composition` | `docs` | `kit`. File:
   `.pier/canvases/<slug>/<slug>.canvas.tsx`.
4. Start from the Auto-resolve template (or canvas-kit for `kit`). Pack
   `agentPrompt` + [authoring.md](references/authoring.md) own details. Do
   not copy applet source. Do not import
   `@pier-applet/pier.tasks/tracker-board`.
5. Export `canvas` metadata. No methodology `instance.json`.
6. Run [verification.md](references/verification.md).

## Content requirements

- User-visible copy in the user's language.
- Hierarchy before decoration. No fabricated data or empty decorative cards.
- Charts: metrics, units, time ranges, sources.
- **Mermaid chrome:** flowchart / architecture use `nodes` / `edges` with
  `kind` (`actor` | `agent` | `tool` | `artifact` | `external`). Status uses
  `tone`. Sequence (`sequence` / `sequenceDiagram`), state, `class`, ER,
  mindmap use native mermaid `source`. No left color rail. Mermaid is
  **static**. Details: [authoring.md](references/authoring.md) **Mermaid**.
- Approval / recover: `WorkflowDiagram`, not Mermaid. Details:
  [authoring.md](references/authoring.md) **Workflow diagrams**.
- Every user action needs a recognizable UI change or error.

## Delivery

- Project-relative path; created vs updated; `kind`.
- Methodology: `content`, `presentation`, `ui` used.
- Compilation, mount, interaction checks actually completed — and any that
  were not.
