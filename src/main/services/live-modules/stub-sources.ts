import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";

export const PIER_CANVAS_STUB_NAMESPACE = "pier-live-canvas-stub";
export const PIER_CANVAS_STUB_PATH = "pier:canvas-stub";
export const NODE_STUB_NAMESPACE = "pier-live-node-stub";

/**
 * No-op stub for `node:*` builtins referenced by non-React framework
 * internals (e.g. Svelte/Vue dev-mode or CJS-interop code paths that import
 * `createRequire` from `node:module`). These paths are dead in the browser
 * (guarded by environment checks); stubbing lets the bundle build without
 * resolving them. React canvases keep the strict compile-time deny.
 *
 * Only importers under node_modules may resolve to this stub — canvas source
 * that imports `node:*` must fail at compile time.
 */
export function nodeBuiltinStubSource(specifier: string): string {
  if (specifier === "node:module") {
    return [
      "function createRequire() {",
      "  // Return a callable require whose result is also a deep no-op,",
      "  // so chained access (require('fs').readFileSync) never throws in",
      "  // the dead browser code paths that reference node:module.",
      "  return () => new Proxy({}, { get: () => () => undefined });",
      "}",
      "function isBuiltin() { return false; }",
      "const _default = { createRequire, isBuiltin };",
      "export { createRequire, isBuiltin };",
      "export default _default;",
    ].join("\n");
  }
  // Other node: builtins: a Proxy default returns a no-op for any property,
  // covering both named and default import patterns frameworks may emit.
  return ["export default new Proxy({}, { get: () => () => undefined });"].join(
    "\n"
  );
}

/**
 * Stub module inlined into each canvas bundle. Named exports always exist;
 * implementations are read from `globalThis.__PIER_LIVE_CANVAS__` at render time.
 *
 * Components become `createElement` wrappers. Value exports (hooks) are called
 * through with their own arguments and return value — wrapping those in
 * `createElement` would drop both. The wrapper keeps the `useX` name so React's
 * hook rules still apply at the canvas call site.
 */
export function pierCanvasStubSource(): string {
  const lines = [
    'import { createElement } from "react";',
    "function getCanvas() {",
    "  const canvas = globalThis.__PIER_LIVE_CANVAS__;",
    "  if (!canvas) {",
    '    throw new Error("Live module pier/canvas runtime missing — call installLiveModuleRuntime()");',
    "  }",
    "  return canvas;",
    "}",
  ];
  for (const name of PIER_CANVAS_COMPONENT_EXPORT_NAMES) {
    lines.push(
      `export function ${name}(props) {`,
      `  const Comp = getCanvas().${name};`,
      "  if (Comp == null) {",
      `    throw new Error("pier/canvas export missing: ${name}");`,
      "  }",
      "  return createElement(Comp, props);",
      "}"
    );
  }
  for (const name of PIER_CANVAS_VALUE_EXPORT_NAMES) {
    lines.push(
      `export function ${name}(...args) {`,
      `  const fn = getCanvas().${name};`,
      '  if (typeof fn !== "function") {',
      `    throw new Error("pier/canvas export missing: ${name}");`,
      "  }",
      "  return fn(...args);",
      "}"
    );
  }
  return `${lines.join("\n")}\n`;
}
