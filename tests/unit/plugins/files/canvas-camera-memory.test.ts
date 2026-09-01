import {
  canvasWorldCameraStorageKey,
  parseCanvasWorldCameraMemory,
  recallCanvasWorldCamera,
  rememberCanvasWorldCamera,
} from "@plugins/builtin/files/renderer/preview/canvas-camera-memory.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("canvas world camera memory", () => {
  beforeEach(() => localStorage.clear());

  it("recalls a free look-at for the same canvas", () => {
    const key = canvasWorldCameraStorageKey("/repo", "board.canvas.tsx");
    rememberCanvasWorldCamera(key, {
      mode: "free",
      scale: 1.25,
      v: 1,
      worldX: 40,
      worldY: -12,
    });
    expect(recallCanvasWorldCamera(key)).toEqual({
      mode: "free",
      scale: 1.25,
      v: 1,
      worldX: 40,
      worldY: -12,
    });
  });

  it("keeps fit as an explicit pose so a later visit does not restore an old pan", () => {
    const key = canvasWorldCameraStorageKey("/repo", "board.canvas.tsx");
    rememberCanvasWorldCamera(key, {
      mode: "free",
      scale: 2,
      v: 1,
      worldX: 10,
      worldY: 10,
    });
    rememberCanvasWorldCamera(key, { mode: "fit", v: 1 });
    expect(recallCanvasWorldCamera(key)).toEqual({ mode: "fit", v: 1 });
  });

  it("isolates canvases by root and path", () => {
    rememberCanvasWorldCamera(
      canvasWorldCameraStorageKey("/a", "board.canvas.tsx"),
      { mode: "free", scale: 1, v: 1, worldX: 1, worldY: 1 }
    );
    expect(
      recallCanvasWorldCamera(
        canvasWorldCameraStorageKey("/b", "board.canvas.tsx")
      )
    ).toBeNull();
  });

  it("drops invalid and unversioned payloads", () => {
    expect(
      parseCanvasWorldCameraMemory({
        mode: "free",
        scale: 0,
        v: 1,
        worldX: 1,
        worldY: 1,
      })
    ).toBeNull();
    expect(
      parseCanvasWorldCameraMemory({
        mode: "free",
        scale: 1,
        x: 10,
        y: 10,
      })
    ).toBeNull();
    expect(parseCanvasWorldCameraMemory({ mode: "fit" })).toBeNull();
    expect(parseCanvasWorldCameraMemory({ mode: "zoom", v: 1 })).toBeNull();
    expect(parseCanvasWorldCameraMemory(null)).toBeNull();
  });
});
