import pierreDark from "@pierre/theme/pierre-dark";
import pierreDarkSoft from "@pierre/theme/pierre-dark-soft";
import pierreLight from "@pierre/theme/pierre-light";
import pierreLightSoft from "@pierre/theme/pierre-light-soft";
import { stylePresetIdSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";
import {
  applyPierBrandOverlay,
  PIER_BRAND_PALETTE,
} from "@/lib/theme/pierre-brand-overlay.ts";
import * as presetRegistry from "@/lib/theme/preset-registry.ts";

const PIERRE_CASES = [
  ["pierre", "light"],
  ["pierre", "dark"],
  ["pierre-soft", "light"],
  ["pierre-soft", "dark"],
] as const;
const PIERRE_SOURCES = {
  pierre: { light: pierreLight, dark: pierreDark },
  "pierre-soft": { light: pierreLightSoft, dark: pierreDarkSoft },
} as const;

const source = {
  name: "fixture",
  type: "dark",
  colors: {
    "editor.background": "#101010",
    "editor.foreground": "#f5f5f5",
    "button.background": "#009fff",
    "statusBar.background": "#181818",
  },
  tokenColors: [
    {
      scope: ["meta.decorator", "entity.name.function.decorator"],
      settings: { fontStyle: "italic", foreground: "#69b1ff" },
    },
    {
      scope: "punctuation.definition.decorator",
      settings: { foreground: "#69b1ff" },
    },
    { scope: "keyword", settings: { foreground: "#ff0000" } },
  ],
  semanticTokenColors: {
    decorator: "#69b1ff",
    function: "#00ff00",
  },
} as const;

const lightSource = {
  ...source,
  type: "light",
  colors: { ...source.colors, "editor.background": "#ffffff" },
} as const;

const commonExpectedColors = {
  "activityBar.activeBorder": PIER_BRAND_PALETTE.primary,
  "activityBarBadge.background": PIER_BRAND_PALETTE.primary,
  "activityBarBadge.foreground": "#ffffff",
  "button.background": PIER_BRAND_PALETTE.primary,
  "button.foreground": "#ffffff",
  "button.hoverBackground": PIER_BRAND_PALETTE.deep,
  "charts.blue": PIER_BRAND_PALETTE.primary,
  "editorCursor.foreground": PIER_BRAND_PALETTE.highlight,
  focusBorder: PIER_BRAND_PALETTE.highlight,
  "list.focusOutline": PIER_BRAND_PALETTE.highlight,
  "panelTitle.activeBorder": PIER_BRAND_PALETTE.primary,
  "tab.activeBorderTop": PIER_BRAND_PALETTE.primary,
  "terminal.ansiBlue": PIER_BRAND_PALETTE.primary,
  "terminal.ansiBrightBlue": PIER_BRAND_PALETTE.highlight,
} as const;

describe("renderer/lib/theme/pierre-brand-overlay", () => {
  it("exports the immutable Pierre palette", () => {
    expect(PIER_BRAND_PALETTE).toEqual({
      highlight: "#b66cff",
      primary: "#8549ff",
      deep: "#542ee5",
    });
  });

  it("applies every dark-mode VS Code color mapping", () => {
    const result = applyPierBrandOverlay(source, "dark");

    expect(result.colors).toMatchObject({
      ...commonExpectedColors,
      "gitDecoration.modifiedResourceForeground": PIER_BRAND_PALETTE.highlight,
      "list.activeSelectionBackground": "#35225c",
      "list.inactiveSelectionBackground": "#251a3b",
      "notificationLink.foreground": PIER_BRAND_PALETTE.highlight,
      "textLink.activeForeground": PIER_BRAND_PALETTE.highlight,
      "textLink.foreground": PIER_BRAND_PALETTE.highlight,
    });
  });

  it("applies every light-mode VS Code color mapping", () => {
    const result = applyPierBrandOverlay(lightSource, "light");

    expect(result.colors).toMatchObject({
      ...commonExpectedColors,
      "gitDecoration.modifiedResourceForeground": PIER_BRAND_PALETTE.primary,
      "list.activeSelectionBackground": "#e9deff",
      "list.inactiveSelectionBackground": "#f3edff",
      "notificationLink.foreground": PIER_BRAND_PALETTE.primary,
      "textLink.activeForeground": PIER_BRAND_PALETTE.primary,
      "textLink.foreground": PIER_BRAND_PALETTE.primary,
    });
  });

  it("does not recolor editor or global text selection", () => {
    const result = applyPierBrandOverlay(
      {
        ...source,
        colors: {
          ...source.colors,
          "editor.selectionBackground": "#009fff4d",
          "selection.background": "#19283c",
        },
      },
      "dark"
    );

    expect(result.colors?.["editor.selectionBackground"]).toBe("#009fff4d");
    expect(result.colors?.["selection.background"]).toBe("#19283c");
    const unmapped = applyPierBrandOverlay(source, "dark").colors ?? {};
    expect(Object.hasOwn(unmapped, "editor.selectionBackground")).toBe(false);
    expect(Object.hasOwn(unmapped, "selection.background")).toBe(false);

    for (const [preset, mode] of PIERRE_CASES) {
      const original = PIERRE_SOURCES[preset][mode];
      const theme = presetRegistry.getShikiTheme(preset, mode);
      expect(theme.colors?.["editor.selectionBackground"]).toBe(
        original.colors?.["editor.selectionBackground"]
      );
      expect(theme.colors?.["selection.background"]).toBe(
        original.colors?.["selection.background"]
      );
    }
  });

  it("uses mode-aware accents for decorator TextMate and semantic tokens", () => {
    const dark = applyPierBrandOverlay(source, "dark");
    const light = applyPierBrandOverlay(lightSource, "light");

    for (const [result, accent] of [
      [dark, PIER_BRAND_PALETTE.highlight],
      [light, PIER_BRAND_PALETTE.primary],
    ] as const) {
      expect(result.tokenColors?.[0]).toEqual({
        scope: ["meta.decorator", "entity.name.function.decorator"],
        settings: { fontStyle: "italic", foreground: accent },
      });
      expect(result.tokenColors?.[1]).toEqual({
        scope: "punctuation.definition.decorator",
        settings: { foreground: accent },
      });
      expect(result.semanticTokenColors).toMatchObject({
        decorator: accent,
        function: "#00ff00",
      });
    }
  });

  it("preserves unrelated theme data and does not mutate the source", () => {
    const sourceSnapshot = structuredClone(source);
    const decoratorSettings = source.tokenColors[0].settings;
    const punctuationSettings = source.tokenColors[1].settings;
    const keywordRule = source.tokenColors[2];
    const keywordSettings = keywordRule.settings;
    const result = applyPierBrandOverlay(source, "dark");

    expect(source).toEqual(sourceSnapshot);
    expect(result).not.toBe(source);
    expect(result.colors).not.toBe(source.colors);
    expect(result.tokenColors).not.toBe(source.tokenColors);
    expect(result.semanticTokenColors).not.toBe(source.semanticTokenColors);
    expect(result.tokenColors?.[0]).not.toBe(source.tokenColors[0]);
    expect(result.tokenColors?.[0].settings).not.toBe(decoratorSettings);
    expect(result.tokenColors?.[1]).not.toBe(source.tokenColors[1]);
    expect(result.tokenColors?.[1].settings).not.toBe(punctuationSettings);
    expect(result.tokenColors?.[2]).toBe(keywordRule);
    expect(result.tokenColors?.[2].settings).toBe(keywordSettings);
    expect(result.name).toBe(source.name);
    expect(result.type).toBe(source.type);
    expect(result.colors?.["editor.background"]).toBe(
      source.colors["editor.background"]
    );
    expect(result.colors?.["editor.foreground"]).toBe(
      source.colors["editor.foreground"]
    );
    expect(result.colors?.["statusBar.background"]).toBe(
      source.colors["statusBar.background"]
    );
  });

  it("overlays only the Pierre registry themes while preserving their identity and surfaces", () => {
    for (const [preset, mode] of PIERRE_CASES) {
      const theme = presetRegistry.getShikiTheme(preset, mode);

      expect(theme.colors?.["button.background"]).toBe("#8549ff");
      expect(theme.colors?.["button.hoverBackground"]).toBe("#542ee5");
      expect(theme.colors?.focusBorder).toBe("#b66cff");
      expect(theme.colors?.["terminal.ansiBlue"]).toBe("#8549ff");
      expect(theme.colors?.["terminal.ansiBrightBlue"]).toBe("#b66cff");
      expect(theme.colors?.["charts.blue"]).toBe("#8549ff");
      expect(theme.colors?.["editor.background"]).toBe(
        PIERRE_SOURCES[preset][mode].colors?.["editor.background"]
      );
      expect(theme.colors?.["editor.foreground"]).toBe(
        PIERRE_SOURCES[preset][mode].colors?.["editor.foreground"]
      );
      expect(theme.name).toBe(PIERRE_SOURCES[preset][mode].name);
    }
  });

  it("preserves source object identity for every non-Pierre preset", () => {
    const sourceRegistry = (
      presetRegistry as typeof presetRegistry & {
        STYLE_PRESET_SOURCE_REGISTRY?: typeof presetRegistry.STYLE_PRESET_REGISTRY;
      }
    ).STYLE_PRESET_SOURCE_REGISTRY;
    expect(sourceRegistry).toBeDefined();
    if (!sourceRegistry) throw new Error("missing source preset registry");

    const nonPierrePresets = stylePresetIdSchema.options.filter(
      (preset) => preset !== "pierre" && preset !== "pierre-soft"
    );
    for (const preset of nonPierrePresets) {
      expect(presetRegistry.STYLE_PRESET_REGISTRY[preset]).toBe(
        sourceRegistry[preset]
      );
      expect(presetRegistry.getShikiTheme(preset, "light")).toBe(
        sourceRegistry[preset].light
      );
      expect(presetRegistry.getShikiTheme(preset, "dark")).toBe(
        sourceRegistry[preset].dark
      );
    }
  });
});
