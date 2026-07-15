import type { StylePresetId } from "@shared/contracts/preferences.ts";
import { describe, expect, it } from "vitest";
import { deriveAppStyleTokens } from "@/lib/theme/derive-tokens.ts";
import { chromaOf, contrast } from "@/lib/theme/oklch.ts";
import {
  getShikiTheme,
  STYLE_PRESET_REGISTRY,
} from "@/lib/theme/preset-registry.ts";

describe("primary cleanliness", () => {
  it("avoids grayish filled primaries across style presets", () => {
    const ids = Object.keys(STYLE_PRESET_REGISTRY) as StylePresetId[];
    const dirty: string[] = [];
    for (const id of ids) {
      for (const mode of ["light", "dark"] as const) {
        const t = deriveAppStyleTokens(getShikiTheme(id, mode), mode);
        if (chromaOf(t.primary) < 0.22) {
          dirty.push(
            `${id}/${mode} ${t.primary} c=${chromaOf(t.primary).toFixed(3)}`
          );
        }
        const minBg = contrast(t.primary, "#ffffff") >= 4 ? 2.6 : 3;
        expect(contrast(t.background, t.primary)).toBeGreaterThanOrEqual(minBg);
        expect(
          contrast(t.primary, t["primary-foreground"])
        ).toBeGreaterThanOrEqual(4);
      }
    }
    expect(dirty).toEqual([]);
  });
});
