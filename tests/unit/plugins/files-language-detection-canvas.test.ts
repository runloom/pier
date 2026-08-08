import { languageForPath } from "@plugins/builtin/files/renderer/editor/language-detection.ts";
import { describe, expect, it } from "vitest";

describe("languageForPath canvas", () => {
  it("treats multi-framework entries under .pier/canvases as canvas", () => {
    expect(languageForPath(".pier/canvases/smoke/hello.canvas.tsx")).toBe(
      "canvas"
    );
    expect(languageForPath(".pier/canvases/a.canvas.vue")).toBe("canvas");
    expect(languageForPath(".pier/canvases/a.canvas.svelte")).toBe("canvas");
    expect(languageForPath(".pier/canvases/a.canvas.solid.tsx")).toBe("canvas");
    expect(languageForPath(".pier/canvases/templates/blank.canvas.tsx")).toBe(
      "canvas"
    );
  });

  it("does not mis-label other tsx or misplaced *.canvas.tsx", () => {
    expect(languageForPath("src/app.tsx")).toBe("typescript");
    expect(languageForPath("src/ui/Button.tsx")).toBe("typescript");
    // Same compound suffix, wrong directory → ordinary TypeScript.
    expect(languageForPath("src/features/checkout.canvas.tsx")).toBe(
      "typescript"
    );
    // Factory default content roots include docs.
    expect(languageForPath("docs/hello.canvas.tsx")).toBe("canvas");
    expect(languageForPath(".pier/plans/demo/plan.canvas.tsx")).toBe(
      "typescript"
    );
    // Bare name under canvases without compound suffix.
    expect(languageForPath(".pier/canvases/helper.tsx")).toBe("typescript");
  });

  it("uses project content directories when a root is provided", () => {
    // Without custom runtime, factory defaults apply.
    expect(languageForPath("designs/a.canvas.tsx", "/proj")).toBe("typescript");
  });

  it("detects canvas under runtime custom content directories", async () => {
    const { setRuntimeLiveModuleContentDirectories } = await import(
      "../../../src/shared/live-module-canvas-path.ts"
    );
    setRuntimeLiveModuleContentDirectories("/proj", ["designs"]);
    expect(languageForPath("designs/a.canvas.tsx", "/proj")).toBe("canvas");
    expect(languageForPath("docs/a.canvas.tsx", "/proj")).toBe("typescript");
    setRuntimeLiveModuleContentDirectories("/proj", null);
  });
});
