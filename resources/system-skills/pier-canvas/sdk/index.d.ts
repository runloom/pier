/**
 * Agent-readable public contract for the host-provided `pier/canvas` module.
 *
 * Read the focused declaration that covers the API you plan to use.
 * Runtime value exports (`export const …` in this `sdk/` except `host.d.ts`)
 * must stay equal to `PIER_CANVAS_EXPORT_NAMES` — locked by
 * `tests/unit/main/bundled-pier-canvas-sdk-exports.test.ts`.
 * Host commands live in `host.d.ts` and are imported from `pier/host`.
 */
export * from "./core.js";
export * from "./data.js";
export * from "./files.js";
export * from "./format.js";
export * from "./forms.js";
export * from "./primitives.js";
export * from "./visualizations.js";
