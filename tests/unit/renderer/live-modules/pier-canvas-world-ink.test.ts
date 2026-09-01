import { describe, expect, it } from "vitest";
import {
  parseCssRgb,
  relativeLuminance,
  WORLD_CAPTION_FG,
  WORLD_CAPTION_MUTED,
  worldStageCaptionVars,
} from "@/lib/live-modules/pier-canvas-world-ink.ts";

describe("worldStageCaptionVars", () => {
  it("paints dark ink on a light floor", () => {
    expect(parseCssRgb("#d8cfc0")).toEqual({ b: 192, g: 207, r: 216 });
    expect(relativeLuminance("#d8cfc0")).toBeGreaterThan(0.4);
    expect(worldStageCaptionVars("#d8cfc0")).toEqual({
      [WORLD_CAPTION_FG]: "#171717",
      [WORLD_CAPTION_MUTED]: "#525252",
    });
  });

  it("paints light ink on a dark floor", () => {
    expect(worldStageCaptionVars("#111111")).toEqual({
      [WORLD_CAPTION_FG]: "#f5f5f5",
      [WORLD_CAPTION_MUTED]: "#a3a3a3",
    });
  });

  it("leaves host tokens when the floor is unset or not a solid color", () => {
    expect(worldStageCaptionVars(undefined)).toBeNull();
    expect(worldStageCaptionVars("transparent")).toBeNull();
    expect(worldStageCaptionVars("linear-gradient(#000, #fff)")).toBeNull();
  });

  it("reads rgb() floors", () => {
    expect(
      worldStageCaptionVars("rgb(216, 207, 192)")?.[WORLD_CAPTION_FG]
    ).toBe("#171717");
  });
});
