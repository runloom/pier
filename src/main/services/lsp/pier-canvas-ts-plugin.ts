import { existsSync } from "node:fs";
import { join } from "node:path";
import { isDevRuntime } from "../../runtime-mode.ts";

export const PIER_CANVAS_TS_PLUGIN_NAME = "pier-canvas-modules";

/** extraResources `to: lsp-plugins` in production; repo `resources/` in dev. */
export function resourcesRootForLspPlugins(): string {
  if (isDevRuntime()) {
    return join(process.cwd(), "resources");
  }
  return process.resourcesPath;
}

/**
 * tsserver global plugins resolve from `<location>/node_modules/<name>`.
 * Pass the package directory (same as Vue): walk-up still hits
 * `resources/lsp-plugins/node_modules/pier-canvas-modules`.
 */
export function resolvePierCanvasTsPlugin(): {
  location: string;
  name: string;
} | null {
  const location = join(
    resourcesRootForLspPlugins(),
    "lsp-plugins/node_modules",
    PIER_CANVAS_TS_PLUGIN_NAME
  );
  if (!existsSync(join(location, "package.json"))) {
    return null;
  }
  if (!existsSync(join(location, "index.cjs"))) {
    return null;
  }
  return { location, name: PIER_CANVAS_TS_PLUGIN_NAME };
}
