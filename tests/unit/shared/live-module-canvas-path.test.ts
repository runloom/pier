import { describe, expect, it } from "vitest";
import {
  canvasRelPathFromProjectPath,
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

  it("rejects non-canvas names and out-of-root paths", () => {
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
