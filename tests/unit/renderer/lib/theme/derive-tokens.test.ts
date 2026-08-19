import { describe, expect, it } from "vitest";
import { deriveAppStyleTokens } from "@/lib/theme/derive-tokens.ts";
import { chromaOf, contrast, oklabLightness } from "@/lib/theme/oklch.ts";
import { PIER_BRAND_PALETTE } from "@/lib/theme/pierre-brand-overlay.ts";
import {
  getShikiTheme,
  STYLE_PRESET_SOURCE_REGISTRY,
} from "@/lib/theme/preset-registry.ts";

const HEX6_RE = /^#[0-9a-f]{6}$/;
const HEX8_RE = /^#[0-9a-f]{8}$/;
const EDITOR_DECORATION_KEYS = [
  "editor-active-line-bg",
  "editor-search-match-active-bg",
  "editor-search-match-active-border",
  "editor-search-match-bg",
  "editor-search-match-border",
  "editor-selection-bg",
  "editor-selection-match-bg",
  "editor-selection-match-main-bg",
] as const;
const PIERRE_CASES = [
  ["pierre", "light"],
  ["pierre", "dark"],
  ["pierre-soft", "light"],
  ["pierre-soft", "dark"],
] as const;

describe("renderer/lib/theme/derive-tokens", () => {
  it("returns theme-owned UI tokens without overriding product status colors", () => {
    const theme = getShikiTheme("pierre", "dark");
    const tokens = deriveAppStyleTokens(theme, "dark");
    const expected = [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "border",
      "input",
      "ring",
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-5",
      "radius",
      ...EDITOR_DECORATION_KEYS,
    ];

    expect(Object.keys(tokens).sort()).toEqual(expected.sort());
    for (const [key, value] of Object.entries(tokens)) {
      if (key === "radius") {
        expect(value).toBe("0.625rem");
      } else if (key.startsWith("editor-")) {
        // Translucent decoration washes (#RRGGBBAA).
        expect(value).toMatch(HEX8_RE);
      } else {
        expect(value).toMatch(HEX6_RE);
      }
    }
  });

  it("keeps editor decoration washes translucent across light and dark", () => {
    for (const mode of ["light", "dark"] as const) {
      const tokens = deriveAppStyleTokens(getShikiTheme("github", mode), mode);
      for (const key of EDITOR_DECORATION_KEYS) {
        const value = tokens[key];
        expect(value).toMatch(HEX8_RE);
        const alpha = Number.parseInt(value.slice(7, 9), 16) / 255;
        // Must not hide syntax (VS Code: decoration backgrounds non-opaque).
        expect(alpha, `${mode} ${key}`).toBeLessThan(0.92);
        expect(alpha, `${mode} ${key}`).toBeGreaterThanOrEqual(0.05);
      }
    }
  });

  it("keeps foreground direction correct in light and dark modes", () => {
    const lightTokens = deriveAppStyleTokens(
      getShikiTheme("github", "light"),
      "light"
    );
    const darkTokens = deriveAppStyleTokens(
      getShikiTheme("github", "dark"),
      "dark"
    );

    expect(
      contrast(lightTokens.background, lightTokens.foreground)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(darkTokens.background, darkTokens.foreground)
    ).toBeGreaterThanOrEqual(4.5);
    expect(lightTokens.foreground).not.toBe(darkTokens.foreground);
  });

  it("uses saturated primary while keeping structural chrome neutral", () => {
    const tokens = deriveAppStyleTokens(
      getShikiTheme("pierre", "light"),
      "light"
    );

    for (const key of [
      "secondary",
      "muted",
      "accent",
      "border",
      "ring",
    ] as const) {
      expect(chromaOf(tokens[key])).toBeLessThan(0.02);
    }

    expect(contrast(tokens.background, tokens.primary)).toBeGreaterThanOrEqual(
      3
    );
    expect(chromaOf(tokens.primary)).toBeGreaterThanOrEqual(0.1);
    expect(
      contrast(tokens.primary, tokens["primary-foreground"])
    ).toBeGreaterThanOrEqual(4);
    expect(contrast(tokens.background, tokens.muted)).toBeGreaterThanOrEqual(
      1.05
    );
    expect(tokens.popover).toBe(tokens.background);
    expect(contrast(tokens.muted, tokens.secondary)).toBeGreaterThan(1);
    expect(tokens).not.toHaveProperty("info");
    expect(tokens).not.toHaveProperty("success");
    expect(tokens).not.toHaveProperty("warning");
    expect(tokens).not.toHaveProperty("destructive");
  });

  it("derives muted foreground as readable secondary text", () => {
    const lightTokens = deriveAppStyleTokens(
      getShikiTheme("pierre", "light"),
      "light"
    );
    const darkTokens = deriveAppStyleTokens(
      getShikiTheme("pierre", "dark"),
      "dark"
    );

    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens["muted-foreground"]).not.toBe(tokens.foreground);
      expect(["#000000", "#ffffff"]).not.toContain(tokens["muted-foreground"]);
      expect(
        contrast(tokens.background, tokens["muted-foreground"])
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens.muted, tokens["muted-foreground"])
      ).toBeGreaterThanOrEqual(4.3);
      expect(chromaOf(tokens["muted-foreground"])).toBeLessThan(0.02);
    }
  });

  it("keeps primary foreground as an on-color pole", () => {
    const tokens = deriveAppStyleTokens(
      getShikiTheme("pierre", "dark"),
      "dark"
    );

    expect(["#000000", "#ffffff"]).toContain(tokens["primary-foreground"]);
    expect(
      contrast(tokens.primary, tokens["primary-foreground"])
    ).toBeGreaterThanOrEqual(4);
  });

  it("uses white labels on dark-theme blue CTAs", () => {
    const tokens = deriveAppStyleTokens(
      getShikiTheme("pierre", "dark"),
      "dark"
    );

    expect(tokens["primary-foreground"]).toBe("#ffffff");
    expect(contrast(tokens.primary, "#ffffff")).toBeGreaterThanOrEqual(4);
    expect(contrast(tokens.background, tokens.primary)).toBeGreaterThanOrEqual(
      3
    );
    // Keep brand blues vivid; do not crush under ~0.55 L just for 4.5:1.
    expect(oklabLightness(tokens.primary)).toBeGreaterThan(0.55);
  });

  it("derives the Pier purple for every registered Pierre theme", () => {
    for (const [preset, mode] of PIERRE_CASES) {
      const tokens = deriveAppStyleTokens(getShikiTheme(preset, mode), mode);

      expect(tokens.primary).toBe("#8549ff");
      expect(tokens["primary-foreground"]).toBe("#ffffff");
      expect(tokens["chart-1"]).toBe("#8549ff");
      expect(
        contrast(tokens.primary, tokens["primary-foreground"])
      ).toBeGreaterThanOrEqual(4);
      expect(
        contrast(tokens.background, tokens.primary)
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps Pierre editor selection on the source theme, not the brand primary", () => {
    for (const [preset, mode] of PIERRE_CASES) {
      const source = STYLE_PRESET_SOURCE_REGISTRY[preset][mode];
      const tokens = deriveAppStyleTokens(getShikiTheme(preset, mode), mode);
      const pigment = tokens["editor-selection-bg"].slice(0, 7).toLowerCase();
      const sourcePigment = (
        source.colors?.["editor.selectionBackground"] ?? ""
      )
        .slice(0, 7)
        .toLowerCase();

      expect(sourcePigment).toMatch(/^#[0-9a-f]{6}$/u);
      expect(pigment).toBe(sourcePigment);
      expect(pigment).not.toBe(PIER_BRAND_PALETTE.primary);
    }
  });
});
