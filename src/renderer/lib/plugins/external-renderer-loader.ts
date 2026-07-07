import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";

/**
 * Loads an external renderer plugin from a `pier-plugin://` URL, calls
 * `activate(context)`, and returns the disposer + activation result.
 * If activation throws, the caller renders the "Plugin panel unavailable"
 * fallback (plan Task 6 step 5).
 */

export interface LoadExternalRendererPluginOptions {
  context: ExternalRendererPluginContext;
  expectedPluginId: string;
  rendererEntryUrl: string;
}

export interface LoadExternalRendererPluginResult {
  disposer: () => void;
  error?: string;
  ok: boolean;
}

export async function loadExternalRendererPlugin(
  options: LoadExternalRendererPluginOptions
): Promise<LoadExternalRendererPluginResult> {
  try {
    // Dynamic import from pier-plugin:// URL — path is runtime-selected.
    const mod: unknown = await import(
      /* @vite-ignore */ options.rendererEntryUrl
    );
    if (!mod || typeof mod !== "object" || !("plugin" in mod)) {
      throw new Error("renderer module missing `plugin` export");
    }
    const pluginExport: unknown = mod.plugin;
    if (
      !pluginExport ||
      typeof pluginExport !== "object" ||
      !("id" in pluginExport) ||
      !("activate" in pluginExport) ||
      typeof pluginExport.id !== "string" ||
      typeof pluginExport.activate !== "function"
    ) {
      throw new Error("renderer plugin export invalid");
    }
    if (pluginExport.id !== options.expectedPluginId) {
      throw new Error(
        `renderer plugin id mismatch: expected ${options.expectedPluginId}, got ${pluginExport.id}`
      );
    }
    const plugin = pluginExport as ExternalRendererPluginModule;
    const disposer = plugin.activate(options.context);
    return { disposer, ok: true };
  } catch (err) {
    return {
      disposer: () => {},
      error: (err as Error).message,
      ok: false,
    };
  }
}
