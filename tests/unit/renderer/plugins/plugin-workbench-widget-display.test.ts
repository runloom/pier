import type { PluginManifest } from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import { resolvePluginWorkbenchWidgetDisplay } from "@/lib/plugins/display.ts";

const baseManifest = pluginManifestSchema.parse({
  apiVersion: 1,
  workbenchWidgets: [
    {
      description: "Fallback desc",
      id: "test.widget",
      title: "Fallback Title",
    },
  ],
  engines: { pier: ">=0.1.0" },
  id: "test.plugin",
  locales: {
    en: {
      workbenchWidgets: {
        "test.widget": {
          description: "Localized desc",
          title: "Localized Title",
        },
      },
    },
    "zh-CN": {
      workbenchWidgets: {
        "test.widget": {
          title: "本地化标题",
        },
      },
    },
  },
  name: "Test",
  source: { kind: "builtin" },
  version: "1.0.0",
}) as PluginManifest;

describe("resolvePluginWorkbenchWidgetDisplay", () => {
  const widget = baseManifest.workbenchWidgets[0]!;

  it("resolves localized title and description for matching locale", () => {
    const display = resolvePluginWorkbenchWidgetDisplay(
      baseManifest,
      widget,
      "en"
    );
    expect(display.title).toBe("Localized Title");
    expect(display.description).toBe("Localized desc");
  });

  it("falls back to manifest title when locale has no workbenchWidgets entry", () => {
    const display = resolvePluginWorkbenchWidgetDisplay(
      baseManifest,
      widget,
      "fr"
    );
    expect(display.title).toBe("Fallback Title");
    expect(display.description).toBe("Fallback desc");
  });

  it("resolves zh-CN locale with partial fields", () => {
    const display = resolvePluginWorkbenchWidgetDisplay(
      baseManifest,
      widget,
      "zh-CN"
    );
    expect(display.title).toBe("本地化标题");
    // zh-CN 无 description，回退到 manifest
    expect(display.description).toBe("Fallback desc");
  });

  it("omits description when neither locale nor manifest provides one", () => {
    const noDescManifest = pluginManifestSchema.parse({
      apiVersion: 1,
      workbenchWidgets: [{ id: "test.nodesc", title: "No Desc" }],
      engines: { pier: ">=0.1.0" },
      id: "test.nodesc",
      name: "NoDesc",
      source: { kind: "builtin" },
      version: "1.0.0",
    }) as PluginManifest;

    const display = resolvePluginWorkbenchWidgetDisplay(
      noDescManifest,
      noDescManifest.workbenchWidgets[0]!,
      "en"
    );
    expect(display.title).toBe("No Desc");
    expect(display.description).toBeUndefined();
  });
});
