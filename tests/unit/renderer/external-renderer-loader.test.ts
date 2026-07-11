import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { describe, expect, it, vi } from "vitest";
import { createExternalRendererModuleLoader } from "@/lib/plugins/external-renderer-loader.ts";

const context = {} as ExternalRendererPluginContext;

describe("external renderer module loader", () => {
  it("loads and validates a plugin module without activating it", async () => {
    const activate = vi.fn(() => () => undefined);
    const loader = createExternalRendererModuleLoader(
      vi.fn(async () => ({
        plugin: { activate, id: "pier.external" },
      }))
    );

    const plugin = await loader({
      expectedPluginId: "pier.external",
      rendererEntryUrl: "pier-plugin://pier.external/renderer.js",
    });

    expect(plugin.id).toBe("pier.external");
    expect(activate).not.toHaveBeenCalled();
    plugin.activate(context);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("rejects malformed exports and plugin id mismatches", async () => {
    const malformed = createExternalRendererModuleLoader(
      vi.fn(async () => ({ nope: true }))
    );
    await expect(
      malformed({
        expectedPluginId: "pier.external",
        rendererEntryUrl: "pier-plugin://pier.external/renderer.js",
      })
    ).rejects.toThrow("missing `plugin` export");

    const mismatched = createExternalRendererModuleLoader(
      vi.fn(async () => ({
        plugin: { activate: () => () => undefined, id: "pier.other" },
      }))
    );
    await expect(
      mismatched({
        expectedPluginId: "pier.external",
        rendererEntryUrl: "pier-plugin://pier.external/renderer.js",
      })
    ).rejects.toThrow("plugin id mismatch");
  });
});
