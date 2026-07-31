# Pier Canvas Authoring Guide

## API discovery

Read `../sdk/index.d.ts` before implementation. Then read the focused
declaration for each API you plan to use:

- `core.d.ts` for `Frame`, `Stack`, `Row`, and `Text`.
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
