import { describe, expect, it } from "vitest";
import { deriveAppStyleTokens } from "@/lib/theme/derive-tokens.ts";
import {
  getShikiTheme,
  getShikiThemePair,
  STYLE_PRESET_REGISTRY,
} from "@/lib/theme/preset-registry.ts";

describe("tokyo-night style preset", () => {
  it("is registered with Shiki night + Enkia light pair", () => {
    expect(STYLE_PRESET_REGISTRY["tokyo-night"]).toBeDefined();
    const dark = getShikiTheme("tokyo-night", "dark");
    const light = getShikiTheme("tokyo-night", "light");
    expect(dark.name).toBe("tokyo-night");
    expect(dark.type).toBe("dark");
    expect(dark.colors?.["editor.background"]?.toLowerCase()).toBe("#1a1b26");
    expect(light.name).toBe("tokyo-night-light");
    expect(light.type).toBe("light");
    expect(light.colors?.["editor.background"]?.toLowerCase()).toBe("#e6e7ed");
    expect(getShikiThemePair("tokyo-night")).toEqual({
      dark: "tokyo-night",
      light: "tokyo-night-light",
    });
  });

  it("derives UI tokens for both modes", () => {
    const darkTokens = deriveAppStyleTokens(
      getShikiTheme("tokyo-night", "dark"),
      "dark"
    );
    const lightTokens = deriveAppStyleTokens(
      getShikiTheme("tokyo-night", "light"),
      "light"
    );
    expect(darkTokens.background).toMatch(/^#|oklch/i);
    expect(lightTokens.background).toMatch(/^#|oklch/i);
    expect(darkTokens.foreground).toBeTruthy();
    expect(lightTokens.foreground).toBeTruthy();
  });
});
