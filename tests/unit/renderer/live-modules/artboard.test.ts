import { describe, expect, it } from "vitest";
import {
  ARTBOARD_PRESETS,
  resolveArtboardSize,
  worldStageLayerBounds,
} from "../../../../src/renderer/lib/live-modules/pier-canvas-artboard.tsx";

describe("resolveArtboardSize", () => {
  it("uses desktop defaults without a preset", () => {
    expect(resolveArtboardSize({})).toEqual({ height: 800, width: 1280 });
  });

  it("applies a named preset", () => {
    expect(resolveArtboardSize({ preset: "phone" })).toEqual(
      ARTBOARD_PRESETS.phone
    );
    expect(resolveArtboardSize({ preset: "tablet" })).toEqual(
      ARTBOARD_PRESETS.tablet
    );
  });

  it("lets explicit width and height beat the preset", () => {
    expect(
      resolveArtboardSize({ height: 100, preset: "desktop", width: 200 })
    ).toEqual({ height: 100, width: 200 });
    expect(resolveArtboardSize({ preset: "laptop", width: 800 })).toEqual({
      height: ARTBOARD_PRESETS.laptop.height,
      width: 800,
    });
  });
});

describe("worldStageLayerBounds", () => {
  it("envelopes x/y plus optional w/h", () => {
    expect(
      worldStageLayerBounds([
        { h: 100, w: 200, x: 40, y: 24 },
        { x: 300, y: 10 },
      ])
    ).toEqual({ height: 124, width: 300 });
  });
});
