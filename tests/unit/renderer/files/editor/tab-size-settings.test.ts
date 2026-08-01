import { FILES_PLUGIN_LOCALES } from "@plugins/builtin/files/locales/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { FILES_EDITOR_TAB_SIZE_SETTING_KEY } from "@plugins/builtin/files/settings.ts";
import { validateConfigurationValue } from "@shared/plugin-settings.ts";
import { describe, expect, it } from "vitest";

describe("files editor tab size setting", () => {
  const property =
    FILES_PLUGIN_MANIFEST.configuration?.properties[
      FILES_EDITOR_TAB_SIZE_SETTING_KEY
    ];

  it("persists only the supported tab sizes through an enum", () => {
    expect(property).toMatchObject({
      default: "2",
      enum: ["2", "4", "8"],
      order: 17,
      type: "string",
    });

    expect(property).toBeDefined();
    if (!property) return;

    for (const value of ["2", "4", "8"]) {
      expect(validateConfigurationValue(property, value)).toEqual({ ok: true });
    }
    for (const value of [0, 2.5, 3, 100, "0", "2.5", "3", "100"]) {
      expect(validateConfigurationValue(property, value).ok).toBe(false);
    }
  });

  it("provides complete localized enum descriptions", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const entry =
        FILES_PLUGIN_LOCALES[locale].settings?.[
          FILES_EDITOR_TAB_SIZE_SETTING_KEY
        ];
      expect(entry?.enumDescriptions).toHaveLength(3);
      for (const description of entry?.enumDescriptions ?? []) {
        expect(description.length).toBeGreaterThan(0);
      }
    }
  });
});
