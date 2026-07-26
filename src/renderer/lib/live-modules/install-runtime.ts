import { ensurePierCanvasShellStyles } from "./ensure-pier-canvas-shell.ts";
import { pierCanvasExports } from "./pier-canvas-exports.ts";

declare global {
  // eslint-disable-next-line no-var
  var __PIER_LIVE_CANVAS__: typeof pierCanvasExports | undefined;
}

/**
 * Install host runtime for Live Modules (`pier/canvas` + relies on
 * `__PIER_PLUGIN_SHARED__` for React). Call after `installPluginSharedRuntime`.
 * Always refresh exports so HMR / whitelist growth is not stuck on the first
 * install (e.g. missing `Frame` after expanding pier/canvas).
 *
 * Also installs framework-agnostic `pier-c-*` shell CSS for Vue/Solid/Svelte
 * canvases (React continues to use pier/canvas components).
 */
export function installLiveModuleRuntime(): void {
  globalThis.__PIER_LIVE_CANVAS__ = pierCanvasExports;
  ensurePierCanvasShellStyles();
}
