import { ensurePierCanvasShellStyles } from "./ensure-pier-canvas-shell.ts";
import { pierHostRuntime } from "./host.ts";
import { pierCanvasExports } from "./pier-canvas-exports.ts";

declare global {
  // eslint-disable-next-line no-var
  var __PIER_LIVE_CANVAS__: typeof pierCanvasExports | undefined;
  // eslint-disable-next-line no-var
  var __PIER_LIVE_HOST__: typeof pierHostRuntime | undefined;
}

function bindLiveExport<T>(name: string, read: () => T): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get: read,
  });
}

/**
 * Install host runtime for Live Modules (`pier/canvas`, `pier/host`; relies on
 * `__PIER_PLUGIN_SHARED__` for React). Call after `installPluginSharedRuntime`.
 * Bindings are getters so HMR of canvas exports is not stuck on the first
 * install snapshot.
 *
 * Also installs framework-agnostic `pier-c-*` shell CSS for Vue/Solid/Svelte
 * canvases (React continues to use pier/canvas components).
 */
export function installLiveModuleRuntime(): void {
  bindLiveExport("__PIER_LIVE_CANVAS__", () => pierCanvasExports);
  bindLiveExport("__PIER_LIVE_HOST__", () => pierHostRuntime);
  ensurePierCanvasShellStyles();
}

if (import.meta.hot) {
  import.meta.hot.accept(
    ["./pier-canvas-exports.ts", "./host.ts"],
    ([canvasModule, hostModule]) => {
      // Inside an accept boundary the static imports above keep pointing at
      // the OLD module instances; fresh namespaces only arrive as callback
      // arguments. Rebind the getters to those, never to the stale imports.
      const nextCanvas = canvasModule?.pierCanvasExports as
        | typeof pierCanvasExports
        | undefined;
      if (nextCanvas) {
        bindLiveExport("__PIER_LIVE_CANVAS__", () => nextCanvas);
      }
      const nextHost = hostModule?.pierHostRuntime as
        | typeof pierHostRuntime
        | undefined;
      if (nextHost) {
        bindLiveExport("__PIER_LIVE_HOST__", () => nextHost);
      }
      ensurePierCanvasShellStyles();
    }
  );
}
