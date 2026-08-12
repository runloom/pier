import { languageForPath } from "@plugins/builtin/files/renderer/editor/language-detection.ts";
import { describe, expect, it } from "vitest";

describe("languageForPath vue/svelte", () => {
  it("maps ordinary .vue and .svelte to their language ids", () => {
    expect(languageForPath("src/components/App.vue")).toBe("vue");
    expect(languageForPath("src/lib/Widget.svelte")).toBe("svelte");
  });

  it("keeps live-module canvas compounds as canvas, not vue/svelte", () => {
    expect(languageForPath(".pier/canvases/a.canvas.vue")).toBe("canvas");
    expect(languageForPath(".pier/canvases/a.canvas.svelte")).toBe("canvas");
  });
});

describe("languageForPath svg", () => {
  it("maps .svg to svg (not plain text)", () => {
    expect(languageForPath("assets/logo.svg")).toBe("svg");
    expect(languageForPath("icons/mark.SVG")).toBe("svg");
  });
});

describe("languageForPath csharp", () => {
  it("maps .cs to csharp, not cpp", () => {
    expect(languageForPath("src/Program.cs")).toBe("csharp");
    expect(languageForPath("src/main.cpp")).toBe("cpp");
  });
});

describe("languageForPath objective-c", () => {
  it("maps .m and .mm onto the cpp highlight track", () => {
    expect(languageForPath("native/src/addon.mm")).toBe("cpp");
    expect(languageForPath("AppDelegate.m")).toBe("cpp");
    expect(languageForPath("native/src/addon.MM")).toBe("cpp");
  });
});

describe("languageForPath P0–P2 extensions", () => {
  it("maps new language extensions and Dockerfile basenames", () => {
    expect(languageForPath("src/main.php")).toBe("php");
    expect(languageForPath("lib/app.dart")).toBe("dart");
    expect(languageForPath("script.lua")).toBe("lua");
    expect(languageForPath("analysis.R")).toBe("r");
    expect(languageForPath("Main.scala")).toBe("scala");
    expect(languageForPath("lib/mix.ex")).toBe("elixir");
    expect(languageForPath("lib/mix.exs")).toBe("elixir");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("Dockerfile.dev")).toBe("dockerfile");
    expect(languageForPath("app.dockerfile")).toBe("dockerfile");
    expect(languageForPath("src/main.zig")).toBe("zig");
    expect(languageForPath("build.zig.zon")).toBe("zig");
    expect(languageForPath("pkg.gemspec")).toBe("ruby");
    expect(languageForPath("include/header.hh")).toBe("cpp");
  });
});

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
