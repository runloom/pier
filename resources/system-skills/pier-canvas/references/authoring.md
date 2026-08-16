# Pier Canvas Authoring Guide

## API discovery

Read `../sdk/index.d.ts` before implementation. Then read the focused
declaration for each API you plan to use:

- `core.d.ts` for `Frame`, `Artboard`, `ArtboardStage`, `Stack`, `Row`, and `Text`.
- `visualizations.d.ts` for charts, graphs, and Mermaid diagrams.
- `files.d.ts` for adjacent-file reads and conflict-safe writes.
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
  `ArtboardStage` is the **same card as `MermaidDiagram`**: fit-all overview
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

## Data and state

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
