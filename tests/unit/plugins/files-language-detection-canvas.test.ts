import { languageForPath } from "@plugins/builtin/files/renderer/files-language-detection.ts";
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
    expect(languageForPath("docs/hello.canvas.tsx")).toBe("typescript");
    expect(languageForPath(".pier/plans/demo/plan.canvas.tsx")).toBe(
      "typescript"
    );
    // Bare name under canvases without compound suffix.
    expect(languageForPath(".pier/canvases/helper.tsx")).toBe("typescript");
  });
});
