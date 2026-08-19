import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stylePresetIdSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";
import { STYLE_PRESET_OPTIONS } from "@/pages/settings/data/style-presets.ts";

const ROOT = process.cwd();

describe("style preset option labels", () => {
  it("covers every style preset with a single official name", () => {
    expect(
      STYLE_PRESET_OPTIONS.map((option) => option.value).toSorted()
    ).toEqual([...stylePresetIdSchema.options].toSorted());
    expect(
      new Set(STYLE_PRESET_OPTIONS.map((option) => option.label)).size
    ).toBe(STYLE_PRESET_OPTIONS.length);
  });

  it("does not localize theme names", () => {
    for (const option of STYLE_PRESET_OPTIONS) {
      expect(option.label, option.value).toMatch(/^[\x20-\x7E]+$/u);
      expect(option.label, option.value).not.toMatch(/settings\.stylePreset/u);
    }
    expect(
      STYLE_PRESET_OPTIONS.find(
        (option) => option.value === "github-high-contrast"
      )?.label
    ).toBe("GitHub High Contrast");
  });

  it("renders the canonical label in settings and the command palette", () => {
    const styleRow = readFileSync(
      join(ROOT, "src/renderer/pages/settings/components/rows/style-row.tsx"),
      "utf8"
    );
    const configActions = readFileSync(
      join(ROOT, "src/renderer/lib/actions/config-actions.ts"),
      "utf8"
    );

    expect(styleRow).toContain("label: o.label");
    expect(styleRow).not.toContain("t(o.labelKey)");
    const stylePick = configActions.match(
      /function openStylePresetQuickPick\([\s\S]*?\n\}/u
    )?.[0];
    expect(stylePick).toContain("label: opt.label");
    expect(stylePick).not.toMatch(/label:\s*i18next\.t\(/u);
  });
});
