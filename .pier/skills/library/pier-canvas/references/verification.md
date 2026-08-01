# Pier Canvas Verification Checklist

## Automated verification

- `parsePierCanvasMeta` can parse the metadata.
- The React entry default-exports a component.
- Live Modules compilation has no error-level diagnostics.
- The entry mounts in `CanvasHost`.
- At least one interaction check exercises a primary button, tab, filter, or
  input.
- Data models and transformation logic have focused unit tests.

## Boundary verification

- Every output is under `.pier/canvases/**`.
- No `cursor/canvas`, Node.js, Electron, `window.pier`, or IPC is used.
- File access does not escape the project root or the Canvas directory.
- No global CSS is polluted.
- File writes handle `written`, `conflict`, and `failed`.

## Content verification

- The title directly states the purpose.
- The primary conclusion or action is easy to find without scrolling.
- Charts identify metrics, units, time ranges, and sources.
- Empty data does not produce fabricated results.
- Error messages tell the user what to do next.
- Core content remains usable in both narrow and wide layouts.

## Evidence language

- A passing test may be reported as verified.
- Reading code may be reported as implementation inspected, not runtime
  verified.
- Manual review may be reported as manually inspected, not as automated
  evidence.
- If the host cannot be started, explicitly list any mount or interaction checks
  that remain incomplete.
