---
name: pier-canvas
description: >-
  Create or update a Pier Canvas under .pier/canvases using pier/canvas and
  project components. Use only when explicitly invoked from Pier.
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

## Hard boundaries

- Write outputs only under `.pier/canvases/**` in the current project.
- Import React Canvas APIs from `pier/canvas`. Never use `cursor/canvas`.
- Never write to product-private caches such as
  `~/.cursor/projects/**/canvases`.
- Do not access `window.pier`, Electron, Node.js, IPC, `eval`, or dynamic
  imports.
- Do not copy Pier host component source. Compose `pier/canvas` primitives and
  existing project components.
- A Canvas runs as trusted project code in the host renderer realm. It is not a
  security sandbox.

## Workflow

1. Check `.pier/canvases/**` for a matching Canvas. Update it in place when it
   already exists.
2. Read only the project code, design system, and existing Canvases directly
   relevant to the task.
3. Read `sdk/index.d.ts`, then the focused declaration for every
   `pier/canvas` API you plan to use. Do not guess component props.
4. Choose one kind:
   - `composition`: architecture, flows, data analysis, option comparisons, or
     interactive prototypes.
   - `docs`: concepts, guides, and component or module documentation.
   - `kit`: components, states, variants, and design tokens.
5. Create this structure by default:

   ```text
   .pier/canvases/<slug>/<slug>.canvas.tsx
   ```

   Put editable or shared data in an adjacent `data.json` and access it through
   `useCanvasFile`.
6. Start from the closest thin template in this skill's `templates/` directory.
   Keep only what the task needs.
7. Export valid metadata:

   ```ts
   export const canvas = {
     kind: "composition" as const,
     title: "A clear, specific title",
     description: "What this Canvas helps the user accomplish",
   };
   ```

8. Run the verification requirements after implementation and fix any failures
   before delivery.

## Content requirements

- Establish a clear information hierarchy before adding interaction or visual
  decoration.
- Charts must identify metrics, units, time ranges, and data sources. Explain
  any transformations.
- Do not render fabricated data, empty charts, or meaningless placeholder cards
  when valid data is unavailable.
- Prefer direct layout over unnecessary card stacking.
- Every user action needs a recognizable UI change or error response.
- Add `schemaVersion` to adjacent `data.json` files. Data-focused Canvases
  should also record their source and generation time.

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

See the [verification checklist](references/verification.md) and
[authoring guide](references/authoring.md) for details.

## Delivery

The final response must include:

- The project-relative Canvas path.
- Whether the Canvas was created or updated, and the selected `kind`.
- The compilation, mount, and interaction checks actually completed.
- Any checks not completed. Do not present manual inspection as automated
  evidence.
