import { FILES_PLUGIN_LOCALES } from "@plugins/builtin/files/locales/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { FILES_EDITOR_MINIMAP_SETTING_KEY } from "@plugins/builtin/files/settings.ts";
import { describe, expect, it } from "vitest";

describe("files editor minimap setting", () => {
  it("declares boolean minimap defaulting to on after autoSave", () => {
    const properties = FILES_PLUGIN_MANIFEST.configuration?.properties;
    expect(properties?.[FILES_EDITOR_MINIMAP_SETTING_KEY]).toMatchObject({
      default: true,
      order: 15,
      type: "boolean",
    });
  });

  it("provides complete English and Chinese setting labels", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const entry =
        FILES_PLUGIN_LOCALES[locale].settings?.[
          FILES_EDITOR_MINIMAP_SETTING_KEY
        ];
      expect(entry?.label).toEqual(expect.any(String));
      expect(entry?.description).toEqual(expect.any(String));
      expect(entry?.label.length).toBeGreaterThan(0);
      expect(entry?.description.length).toBeGreaterThan(0);
    }
  });
});
