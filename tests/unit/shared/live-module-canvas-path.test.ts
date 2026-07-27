import { describe, expect, it } from "vitest";
import {
  canvasDirectoryFromProjectPath,
  canvasRelPathFromProjectPath,
  canvasSiblingProjectPath,
  detectProjectCanvasFramework,
  isCanvasFileName,
  isProjectCanvasPath,
} from "../../../src/shared/live-module-canvas-path.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
} from "../../../src/shared/live-module-framework.ts";

describe("live-module-canvas-path", () => {
  it("accepts multi-framework canvas entries under .pier/canvases", () => {
    expect(isProjectCanvasPath(".pier/canvases/hello.canvas.tsx")).toBe(true);
    expect(
      detectProjectCanvasFramework(".pier/canvases/hello.canvas.tsx")
    ).toBe("react");
    expect(detectProjectCanvasFramework(".pier/canvases/a.canvas.vue")).toBe(
      "vue"
    );
    expect(detectProjectCanvasFramework(".pier/canvases/a.canvas.svelte")).toBe(
      "svelte"
    );
    expect(
      detectProjectCanvasFramework(".pier/canvases/a.canvas.solid.tsx")
    ).toBe("solid");
    expect(
      canvasRelPathFromProjectPath(".pier/canvases/nested/demo.canvas.tsx")
    ).toBe("nested/demo.canvas.tsx");
  });

  it("rejects canvases outside .pier/canvases", () => {
    expect(isProjectCanvasPath(".pier/plans/demo/plan.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath("src/foo.tsx")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/hello.tsx")).toBe(false);
    expect(isProjectCanvasPath("elsewhere/hello.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath("src/features/checkout.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/readme.md")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/.canvas.tsx")).toBe(false);
    expect(
      canvasRelPathFromProjectPath(".pier/canvases/../secret.canvas.tsx")
    ).toBeNull();
  });

  it("resolves sibling files inside the canvas directory", () => {
    const canvas = ".pier/canvases/demo/hello.canvas.tsx";
    expect(canvasDirectoryFromProjectPath(canvas)).toBe(".pier/canvases/demo");
    expect(canvasSiblingProjectPath(canvas, "data.json")).toBe(
      ".pier/canvases/demo/data.json"
    );
    expect(
      canvasSiblingProjectPath(".pier/canvases/a.canvas.tsx", "b.json")
    ).toBe(".pier/canvases/b.json");
  });

  it("refuses sibling names that leave the canvas directory", () => {
    const canvas = ".pier/canvases/demo/hello.canvas.tsx";
    for (const name of [
      "",
      ".",
      "..",
      "../data.json",
      "nested/data.json",
      "nested\\data.json",
      "/etc/passwd",
      "C:/secret.json",
      "plan\0.json",
      "x".repeat(256),
    ]) {
      expect(canvasSiblingProjectPath(canvas, name)).toBeNull();
    }
  });

  it("refuses sibling resolution for paths that are not project canvases", () => {
    expect(canvasSiblingProjectPath("src/app.tsx", "data.json")).toBeNull();
    expect(canvasDirectoryFromProjectPath("src/app.tsx")).toBeNull();
  });

  it("isCanvasFileName / framework detect compound suffixes", () => {
    expect(isCanvasFileName("hello.canvas.tsx")).toBe(true);
    expect(isLiveModuleCanvasFileName("x.canvas.vue")).toBe(true);
    expect(isLiveModuleCanvasFileName("x.canvas.solid.tsx")).toBe(true);
    expect(detectLiveModuleFrameworkFromFileName("x.canvas.solid.tsx")).toBe(
      "solid"
    );
    expect(isCanvasFileName(".canvas.tsx")).toBe(false);
    expect(isCanvasFileName("hello.tsx")).toBe(false);
    expect(isCanvasFileName("hello.canvas.ts")).toBe(false);
  });
});
