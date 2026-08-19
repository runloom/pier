# Pier Canvas Authoring Guide

## API discovery

Look at `.pier/canvases/canvas-kit/canvas-kit.canvas.tsx` in Pier for the
live catalog. Compose only `pier/canvas` exports that appear there, plus the
API tab — a capability catalog (`useCanvasFile` first, then host domains
such as `file` and `git`). `host.invoke` / `useHostSnapshot` /
`host.subscribe` / `host.inspect` are listed once in the primer; command
names are `host.invoke` variants, not separate APIs. Then
read `../sdk/index.d.ts` and `../sdk/host.d.ts`. Then read the focused
declaration for each API you plan to use:

- `core.d.ts` for `Frame`, `Artboard`, `ArtboardStage`, `Stack`, `Row`, and `Text`.
- API (canvas-kit → API, plus `sdk/host.d.ts` and `sdk/files.d.ts`) for
  `import { host, useHostSnapshot } from "pier/host"` and
  `import { useCanvasFile } from "pier/canvas"`. Bind
  `host.invoke` / `host.subscribe` / `host.snapshot` on the canvas; do
  not wrap those capabilities as product hooks. Adjacent files are
  `useCanvasFile`; global `file.*` is the host `file` domain.
- `visualizations.d.ts` for `DataChart` and `Mermaid`. Canvas diagrams
  use the `Mermaid` component (`nodes` / `edges`, or `source` for
  sequence / class / state). Markdown preview keeps a separate mermaid
  fence path.
- `forms.d.ts` for controls, selection, and toggle composition.
- `primitives.d.ts` for the complete standard UI primitive inventory.

The declarations are the public contract. Do not infer props from component
names or copy host source.

## Choose the output kind

| Kind | Suitable for | Not suitable for |
|---|---|---|
| `composition` | Architecture, flows, data exploration, option comparisons, interactive prototypes | Complete component catalogs |
| `docs` | Concepts, guides, module documentation | Open-ended workbenches |
| `kit` | Components, states, variants, design tokens | A single business workflow |

Declare one primary kind per Canvas. Do not combine all three kinds in one page
just to demonstrate capabilities.

## Font roles (host Appearance — do not mix)

Pier exposes three font roles. Canvases must pick the right one:

| Role | CSS | When |
|---|---|---|
| **UI font** | default / `var(--pier-ui-font-family)` | `composition`, `kit`, chrome, controls, live component demos |
| **Document font** | `var(--pier-document-font-family)` | **only** `kind: "docs"` reading body (via **`DocsShell`** header/main) |
| **Monospace** | `var(--pier-mono-font-family)` | code, paths, keyboard samples |

Rules:

- Prefer **`DocsShell`** for docs — it applies the document font to the article
  surface. Do not hand-set serif stacks on composition/kit pages.
- Live examples of real components (Button, Input, …) always keep the **UI**
  font so demos match the product.
- Do not set `font-family` on `:root` / `body`, and do not force document font
  onto kit catalogs or design frames.

## File structure

Use one file for a simple Canvas:

```text
.pier/canvases/<slug>/<slug>.canvas.tsx
```

Split files only after shared data or distinct modules emerge:

```text
.pier/canvases/<slug>/
  <slug>.canvas.tsx
  data.json
  model.ts
  sections.tsx
```

Keep the entry file thin: metadata, page composition, and small local state can
stay there. Put complex calculations in pure adjacent modules.

## Components and styling

- Import host-provided components and `useCanvasFile` from `pier/canvas`.
  Import `host` / `useHostSnapshot` from `pier/host`.
- You may import adjacent Canvas modules, project-relative paths, and project
  `tsconfig` path aliases.
- Reuse the project's design system first. Use basic layout primitives only
  when no suitable component exists.
- Scope local styles to the Canvas root. Do not modify `:root`, `html`, or
  `body`.
- Do not guess component APIs. Consult existing project Canvases, type
  diagnostics, and the templates.

### Layout and CSS (common failure mode)

- Host Tailwind scans `packages/ui`, plugins, and `.pier/canvases` (see
  `src/renderer/app/globals.css` `@source`). Prefer utilities that already
  exist in the product; for **docs two-pane layout**, always use **`DocsShell`**
  (inline flex columns) instead of inventing arbitrary `grid-cols-[…]` shells.
- `Frame` is a **reading column** (max-width + padding), not a full-height app
  chrome. Do not nest dual `ScrollArea` + `70vh` fake viewports inside it.
- Product UI mockups (settings, panels, chrome) go on **`Artboard`** inside
  **`ArtboardStage`**. Each artboard is a Figma frame: fixed pixel width
  (default 1280×800), **clip** overflow — no nested scrollbar. Inline
  `ArtboardStage` is the **same card as `Mermaid`**: fit-all overview
  in the reading `Frame`, no wheel capture. Zoom/pan (same chrome as image
  preview) is **fullscreen preview only**. Do not break the host reading
  column out to full width. Do not stack screens as a document inside
  `Frame`.
- Multi-line `AccordionTrigger` content must not rely on underline hover chrome;
  the host Accordion uses a light background hover.

### Docs and inventories

- Multi-chapter user manuals: `DocsShell` + ≤ ~7 sidebar leaves; put tasks /
  domains / FAQ inside the article (Accordion / Select), not 20+ nav leaves.
- Command / API inventories: **one** expandable list. Trigger shows name +
  short description; expand for synopsis / examples / output. **Do not** show
  a summary table and then the same commands again in an Accordion.
- Badge only **unfinished** or **blocked** commands. Shipped items stay plain.

## Mermaid

One component: `Mermaid`. The host paints with mermaid.js (parse + layout +
paint). There is no second layout engine.

**Flowchart / architecture / live DAG** — pass `nodes` and `edges`. The host
writes mermaid `flowchart` text and hydrates Pier cards into mermaid's own
htmlLabels when a node has `kind`, `tone`, `status`, or `renderNodeContent`.
Set `shape` (`round` / `diamond` / `rect` / `circle`) for notation
silhouettes. Omit `shape` (or set `kind` / `tone` / `status`) for Pier cards.

**Sequence, state, class, ER, mindmap** — pass native mermaid `source`. Do
not compile those families from `nodes` / `edges`. mermaid.js classifies the
diagram; there is no `type` prop and Pier does not sniff the source header.

| Family | `source` starts with |
|---|---|
| `sequence` | `sequenceDiagram` |
| `state` | `stateDiagram-v2` |
| `class` | `classDiagram` |
| `er` | `erDiagram` |
| `mindmap` | `mindmap` |
| flowchart | omit `source`; use `nodes` / `edges` |

| Field | When | Values |
|---|---|---|
| `kind` | Layered / main-loop / architecture (flowchart from `nodes`) | `actor` human · `agent` coordinating or worker agent · `tool` CLI or local tools · `artifact` screen, facts, documents, product surfaces · `external` optional / out of product |
| `tone` | State machine, error exit, delivery status | `info` `success` `warning` `danger` `done` `muted` |
| neither | Only if the graph has no roles and no status | Default `bg-card` |

| `kind` | Chrome (status hue, not `--primary` / `--muted`) |
|---|---|
| `actor` | info blue · User |
| `agent` | done purple · Bot |
| `tool` | success green · Terminal |
| `artifact` | info blue, **dashed** · AppWindow |
| `external` | warning amber, **dashed** · ExternalLink |

Rules:

- Architecture and main-loop graphs **must** set `kind` on every node.
  Look at `.pier/canvases/multi-agent-orchestration-gold/data.json`
  `mainLoop.diagram` / `architecture.diagram`.
- Status graphs **must** set `tone` (success path, warning attention,
  danger misuse). Templates keep `tone: "danger"` on Error / Misuse /
  Stop nodes.
- Set **one** field per node. If both are set, fill follows `tone`;
  `kind` still shows the role glyph.
- Chrome is the soft status pairing: pale tint + same-hue hairline
  border + a title-row glyph. Kind glyphs use foreground (readable at
  20px); hue lives in the card surface. Run-status marks stay chromatic.
  **No left color rail.** **No one-color-per-node rainbow.**
- Do not use `bg-muted` / `bg-primary/10` for roles: light `--muted` is
  near `--card`, light `--primary` is near-black.
- One-shot / out-of-product nodes are `external` (example: 原生 agent CLI).
  Their edges dash too.
- Short predicates on edges; long copy belongs on node `meta` or a caption.
- Do not infer `kind` from the title string.
- **Live DAG / pipeline graphs:** set `status` per node
  (`queued` | `running` | `success` | `failed` | `skipped`) for the trailing
  run glyph (spinner / check / cross). For richer per-node chrome (progress,
  timing, cost) pass `renderNodeContent={(node) => …}` and reserve space with
  `contentHeight` on the nodes that render it. Content is display chrome —
  in-node actions use compact `Button size="xs" variant="outline"` in the
  footer, not filled accent. Keep graph selection on `onSelectNode`.

## Data and state

- Host snapshots are `pier/host`, not widgets. The API tab is a
  capability catalog: `useCanvasFile` plus one row per host domain
  (`file`, `git`, `worktree`, …). The primer states `host.invoke` /
  `useHostSnapshot` / `host.subscribe` / `host.inspect` once. Domain
  detail lists command payload fields from `host.inspect()`. Do not
  expect a live readout or a composed UI on that page. Call those
  functions on the canvas and bind keys to `Item`, `Table`, or
  `DataChart` yourself.
- Use local React state for state that only affects the current viewing session.
- Use an adjacent `data.json` for data that belongs in Git, is shared by the
  team, or must persist across sessions.
- `useCanvasFile` may only read and write files adjacent to the Canvas. Read the
  revision before writing.
- On `conflict`, reload and let the user decide. Never overwrite silently.
- Never store tokens, cookies, authorization headers, passwords, or other
  secrets in a Canvas.

Recommended data envelope:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-28T00:00:00.000Z",
  "source": "Where the data came from",
  "data": {}
}
```

## Coexistence with Cursor Canvas

`pier-canvas` and Cursor's built-in `canvas` are separate protocols:

| Pier Canvas | Cursor Canvas |
|---|---|
| `.pier/canvases/**` | Cursor-managed user cache |
| `pier/canvas` | `cursor/canvas` |
| Project files that may enter Git | Product-private persistence |

For a Pier task, follow this skill's path and import rules. Never mix files or
SDKs from the two protocols.
