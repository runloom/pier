/**
 * Agent-readable public contract for the host-provided `pier/canvas` module.
 *
 * Read the focused declaration that covers the API you plan to use.
 * Runtime value exports (`export const …` in this `sdk/`) must stay equal to
 * `PIER_CANVAS_EXPORT_NAMES` — locked by
 * `tests/unit/main/bundled-pier-canvas-sdk-exports.test.ts`.
 */
export * from "./core.js";
export * from "./files.js";
export * from "./forms.js";
export * from "./primitives.js";
export * from "./visualizations.js";
