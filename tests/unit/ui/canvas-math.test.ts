// @vitest-environment jsdom
import {
  anchoredScrollAfterZoom,
  fitCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  measureWorldContentBounds,
  pinchZoom,
  screenToWorldPoint,
  softClampCamera,
  worldToScreenPoint,
  zoomCameraAt,
} from "@pier/ui/image-preview/canvas-math.ts";
import { describe, expect, it } from "vitest";

describe("anchoredScrollAfterZoom", () => {
  const base = {
    clientHeight: 400,
    clientWidth: 800,
    newZoom: 2,
    oldZoom: 1,
    scrollLeft: 100,
    scrollTop: 50,
  };

  it("defaults to the viewport center", () => {
    const next = anchoredScrollAfterZoom(base);
    expect(next.scrollLeft).toBe((100 + 400) * 2 - 400);
    expect(next.scrollTop).toBe((50 + 200) * 2 - 200);
  });

  it("keeps the pointer-anchored content point stable", () => {
    const next = anchoredScrollAfterZoom({ ...base, anchorX: 0, anchorY: 0 });
    // Content under the viewport origin stays put: scroll scales with zoom.
    expect(next.scrollLeft).toBe(200);
    expect(next.scrollTop).toBe(100);
  });

  it("never scrolls negative", () => {
    const next = anchoredScrollAfterZoom({
      ...base,
      newZoom: 0.5,
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(next.scrollLeft).toBe(0);
    expect(next.scrollTop).toBe(0);
  });
});

describe("pinchZoom", () => {
  it("is smooth and monotonic in deltaY", () => {
    expect(pinchZoom(1, -50)).toBeGreaterThan(1);
    expect(pinchZoom(1, 50)).toBeLessThan(1);
    expect(pinchZoom(1, -10)).toBeLessThan(pinchZoom(1, -50));
  });

  it("clamps to the zoom range", () => {
    expect(pinchZoom(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
    expect(pinchZoom(MIN_ZOOM, 1000)).toBe(MIN_ZOOM);
  });
});

describe("fitCamera", () => {
  it("contains and centers the content (no upscale)", () => {
    const camera = fitCamera(
      { height: 400, width: 800 },
      { height: 424, width: 424 },
      24
    );
    expect(camera.scale).toBe(0.5);
    expect(camera.x).toBe((424 - 800 * 0.5) / 2);
    expect(camera.y).toBe((424 - 400 * 0.5) / 2);
  });

  it("does not upscale small content", () => {
    const camera = fitCamera(
      { height: 100, width: 100 },
      { height: 1000, width: 1000 },
      24
    );
    expect(camera.scale).toBe(1);
    expect(camera.x).toBe(450);
  });

  it("compensates for origin offset so content is exactly centered", () => {
    const camera = fitCamera(
      { height: 200, width: 600, x: 32, y: 32 },
      { height: 600, width: 900 },
      24
    );
    expect(camera.scale).toBe(1);
    // (900 - 600)/2 - 32 = 150 - 32 = 118
    expect(camera.x).toBe(118);
    // (600 - 200)/2 - 32 = 200 - 32 = 168
    expect(camera.y).toBe(168);
  });
});

describe("zoomCameraAt", () => {
  it("keeps the world point under the cursor stable", () => {
    const camera = { scale: 1, x: 0, y: 0 };
    const point = { x: 100, y: 50 };
    const next = zoomCameraAt(camera, point, 2);
    // World point under the cursor before: (100, 50). After: same screen px.
    expect((point.x - next.x) / next.scale).toBeCloseTo(100);
    expect((point.y - next.y) / next.scale).toBeCloseTo(50);
  });

  it("clamps the scale", () => {
    const next = zoomCameraAt({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 100);
    expect(next.scale).toBe(MAX_ZOOM);
  });
});

describe("softClampCamera", () => {
  const content = { height: 400, width: 400 };
  const viewport = { height: 600, width: 800 };

  it("lets the camera roam but keeps 64px of content visible", () => {
    const flungLeft = softClampCamera(
      { scale: 1, x: -10_000, y: 0 },
      content,
      viewport
    );
    expect(flungLeft.x).toBe(64 - 400);
    const flungRight = softClampCamera(
      { scale: 1, x: 10_000, y: 0 },
      content,
      viewport
    );
    expect(flungRight.x).toBe(800 - 64);
  });

  it("does not touch a camera already in range", () => {
    const camera = { scale: 1, x: -100, y: 150 };
    expect(softClampCamera(camera, content, viewport)).toEqual(camera);
  });
});

describe("coordinate transforms", () => {
  const camera = { scale: 2, x: 100, y: 50 };

  it("converts screen points to world coordinates", () => {
    expect(screenToWorldPoint({ x: 200, y: 150 }, camera)).toEqual({
      x: 50,
      y: 50,
    });
  });

  it("converts world points to screen coordinates", () => {
    expect(worldToScreenPoint({ x: 50, y: 50 }, camera)).toEqual({
      x: 200,
      y: 150,
    });
  });
});

describe("measureWorldContentBounds", () => {
  it("envelopes children positions and sizes", () => {
    const root = document.createElement("div");
    const child1 = document.createElement("div");
    Object.defineProperty(child1, "offsetLeft", { value: 32 });
    Object.defineProperty(child1, "offsetTop", { value: 32 });
    Object.defineProperty(child1, "offsetWidth", { value: 600 });
    Object.defineProperty(child1, "offsetHeight", { value: 200 });

    const child2 = document.createElement("div");
    Object.defineProperty(child2, "offsetLeft", { value: 700 });
    Object.defineProperty(child2, "offsetTop", { value: 50 });
    Object.defineProperty(child2, "offsetWidth", { value: 200 });
    Object.defineProperty(child2, "offsetHeight", { value: 300 });

    root.appendChild(child1);
    root.appendChild(child2);

    const bounds = measureWorldContentBounds(root);
    expect(bounds).toEqual({
      height: 318, // maxY (350) - minY (32)
      width: 868, // maxX (900) - minX (32)
      x: 32,
      y: 32,
    });
  });
});
