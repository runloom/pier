import { ensurePierCanvasShellStyles } from "./ensure-pier-canvas-shell.ts";
import { pierCanvasExports } from "./pier-canvas-exports.ts";
import { pierVisualizationsRuntime } from "./pier-visualizations-runtime.tsx";

declare global {
  // eslint-disable-next-line no-var
  var __PIER_LIVE_CANVAS__: typeof pierCanvasExports | undefined;
  // eslint-disable-next-line no-var
  var __PIER_LIVE_VISUALIZATIONS__:
    | typeof pierVisualizationsRuntime
    | undefined;
}

/**
 * Install host runtime for Live Modules (`pier/canvas` + relies on
 * `__PIER_PLUGIN_SHARED__` for React). Call after `installPluginSharedRuntime`.
 * Always refresh exports so HMR / whitelist growth is not stuck on the first
 * install.
 *
 * Also installs framework-agnostic `pier-c-*` shell CSS for Vue/Solid/Svelte
 * canvases (React continues to use pier/canvas components).
 */
export function installLiveModuleRuntime(): void {
  globalThis.__PIER_LIVE_CANVAS__ = pierCanvasExports;
  globalThis.__PIER_LIVE_VISUALIZATIONS__ = pierVisualizationsRuntime;
  ensurePierCanvasShellStyles();
}
