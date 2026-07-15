import { describe, expect, it } from "vitest";
import { deriveAppStyleTokens } from "@/lib/theme/derive-tokens.ts";
import { chromaOf, contrast, oklabLightness } from "@/lib/theme/oklch.ts";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";

const HEX6_RE = /^#[0-9a-f]{6}$/;

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
    ];

    expect(Object.keys(tokens).sort()).toEqual(expected.sort());
    for (const [key, value] of Object.entries(tokens)) {
      if (key === "radius") {
        expect(value).toBe("0.625rem");
      } else {
        expect(value).toMatch(HEX6_RE);
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
});
