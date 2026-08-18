import pierreDark from "@pierre/theme/pierre-dark";
import pierreDarkSoft from "@pierre/theme/pierre-dark-soft";
import pierreLight from "@pierre/theme/pierre-light";
import pierreLightSoft from "@pierre/theme/pierre-light-soft";
import { describe, expect, it } from "vitest";
import {
  applyPierBrandOverlay,
  PIER_BRAND_PALETTE,
} from "@/lib/theme/pierre-brand-overlay.ts";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";

const PIERRE_CASES = [
  ["pierre", "light"],
  ["pierre", "dark"],
  ["pierre-soft", "light"],
  ["pierre-soft", "dark"],
] as const;
const MODES = ["light", "dark"] as const;
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
      "editor.selectionBackground": "#8549ff4d",
      "gitDecoration.modifiedResourceForeground": PIER_BRAND_PALETTE.highlight,
      "list.activeSelectionBackground": "#35225c",
      "list.inactiveSelectionBackground": "#251a3b",
      "notificationLink.foreground": PIER_BRAND_PALETTE.highlight,
      "selection.background": "#2c1e49",
      "textLink.activeForeground": PIER_BRAND_PALETTE.highlight,
      "textLink.foreground": PIER_BRAND_PALETTE.highlight,
    });
  });

  it("applies every light-mode VS Code color mapping", () => {
    const result = applyPierBrandOverlay(lightSource, "light");

    expect(result.colors).toMatchObject({
      ...commonExpectedColors,
      "editor.selectionBackground": "#8549ff2e",
      "gitDecoration.modifiedResourceForeground": PIER_BRAND_PALETTE.primary,
      "list.activeSelectionBackground": "#e9deff",
      "list.inactiveSelectionBackground": "#f3edff",
      "notificationLink.foreground": PIER_BRAND_PALETTE.primary,
      "selection.background": "#f0e9ff",
      "textLink.activeForeground": PIER_BRAND_PALETTE.primary,
      "textLink.foreground": PIER_BRAND_PALETTE.primary,
    });
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
    const githubBefore = MODES.map((mode) =>
      structuredClone(getShikiTheme("github", mode))
    );

    for (const [preset, mode] of PIERRE_CASES) {
      const theme = getShikiTheme(preset, mode);

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

    expect(MODES.map((mode) => getShikiTheme("github", mode))).toEqual(
      githubBefore
    );
  });
});
