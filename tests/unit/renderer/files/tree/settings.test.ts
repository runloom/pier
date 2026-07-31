import { FILES_PLUGIN_LOCALES } from "@plugins/builtin/files/locales/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import { describe, expect, it } from "vitest";

describe("files tree settings", () => {
  it("declares positive visibility controls and editable exclusions", () => {
    const properties = FILES_PLUGIN_MANIFEST.configuration?.properties;

    expect(properties?.[FILES_TREE_SHOW_EXCLUDED_SETTING_KEY]).toMatchObject({
      default: false,
      order: 20,
      type: "boolean",
    });
    expect(properties?.[FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY]).toMatchObject(
      {
        default: FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
        multiline: true,
        order: 21,
        type: "string",
      }
    );
    expect(properties?.[FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY]).toMatchObject(
      { default: true, order: 30, type: "boolean" }
    );
  });

  it("provides complete English and Chinese setting labels", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const settings = FILES_PLUGIN_LOCALES[locale].settings;
      for (const key of [
        FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
        FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
        FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
      ] as const) {
        expect(settings?.[key]?.label).toEqual(expect.any(String));
        expect(settings?.[key]?.description).toEqual(expect.any(String));
      }
    }
  });
});
