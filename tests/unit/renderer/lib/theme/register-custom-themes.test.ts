import {
  getResolvedOrResolveTheme,
  type ThemeRegistrationResolved,
} from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { PIER_BRAND_PALETTE } from "@/lib/theme/pierre-brand-overlay.ts";
import {
  getShikiTheme,
  getShikiThemePair,
} from "@/lib/theme/preset-registry.ts";
import { ensureCustomShikiThemesRegistered } from "@/lib/theme/register-custom-themes.ts";

function decoratorForeground(theme: ThemeRegistrationResolved): string {
  const rule = theme.settings.find((candidate) => {
    const scopes =
      typeof candidate.scope === "string"
        ? [candidate.scope]
        : (candidate.scope ?? []);
    return scopes.includes("punctuation.definition.decorator");
  });
  const foreground = rule?.settings.foreground;
  if (typeof foreground !== "string") {
    throw new Error("missing decorator foreground");
  }
  return foreground;
}

describe("custom Shiki theme registration", () => {
  it("resolves branded Pierre aliases with matching overlaid registrations", async () => {
    ensureCustomShikiThemesRegistered();

    for (const preset of ["pierre", "pierre-soft"] as const) {
      const aliases = getShikiThemePair(preset);
      for (const mode of ["light", "dark"] as const) {
        const alias = aliases[mode];
        const source = getShikiTheme(preset, mode);
        const resolved = await getResolvedOrResolveTheme(alias);

        expect(alias).not.toBe(source.name);
        expect(resolved.name).toBe(alias);
        expect(decoratorForeground(resolved).toLowerCase()).toBe(
          mode === "dark"
            ? PIER_BRAND_PALETTE.highlight
            : PIER_BRAND_PALETTE.primary
        );
      }
    }
  });

  it("keeps non-Pierre theme name pairs unchanged", () => {
    expect(getShikiThemePair("github")).toEqual({
      dark: "github-dark",
      light: "github-light",
    });
    expect(getShikiThemePair("tokyo-night")).toEqual({
      dark: "tokyo-night",
      light: "tokyo-night-light",
    });
  });
});
