import {
  computeWorldDotGridStyle,
  worldGridScreenSpacing,
} from "@pier/ui/image-preview/world-grid.ts";
import { describe, expect, it } from "vitest";

describe("worldGridScreenSpacing", () => {
  it("keeps the base pitch near 100% zoom", () => {
    expect(worldGridScreenSpacing(1)).toBe(20);
  });

  it("doubles world pitch when zoomed out so screen density stays in range", () => {
    // 20 * 0.5 = 10px < 12 → world 40, screen 20.
    expect(worldGridScreenSpacing(0.5)).toBe(20);
  });

  it("halves world pitch when zoomed in so dots do not blow up", () => {
    // 20 * 2 = 40px > 28 → world 10, screen 20.
    expect(worldGridScreenSpacing(2)).toBe(20);
  });
});

describe("computeWorldDotGridStyle", () => {
  it("locks dots to the camera translate (world origin stays on the lattice)", () => {
    const style = computeWorldDotGridStyle({ scale: 1, x: 30, y: 10 });
    expect(style.backgroundSize).toBe("20px 20px");
    expect(style.backgroundPosition).toBe("10px 10px");
  });

  it("keeps the world origin on a dot after LOD zoom", () => {
    const camera = { scale: 2, x: 30, y: 10 };
    const style = computeWorldDotGridStyle(camera);
    expect(style.backgroundSize).toBe("20px 20px");
    const spacing = 20;
    const originScreenX = camera.x;
    const originScreenY = camera.y;
    const posX = Number(
      String(style.backgroundPosition).split(" ")[0]?.replace("px", "")
    );
    const posY = Number(
      String(style.backgroundPosition).split(" ")[1]?.replace("px", "")
    );
    expect((originScreenX - posX) % spacing).toBe(0);
    expect((originScreenY - posY) % spacing).toBe(0);
  });
});
