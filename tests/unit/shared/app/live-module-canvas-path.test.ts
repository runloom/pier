import { describe, expect, it } from "vitest";
import { projectLiveRootId } from "../../../../src/shared/contracts/live-modules.ts";
import {
  canvasDirectoryFromProjectPath,
  canvasRelPathFromProjectPath,
  canvasScopedSiblingPath,
  canvasSiblingProjectPath,
  clearAllRuntimeLiveModuleContentDirectories,
  detectProjectCanvasFramework,
  isCanvasFileName,
  isProjectCanvasPath,
  liveModuleContentRootId,
  liveModuleProjectContentDirectories,
  normalizeContentDirectory,
  normalizeContentDirectoryList,
  parseLiveModulesProjectConfig,
  projectCanvasLocation,
  resolveLiveModuleContentDirectories,
  sanitizeLiveRootIdSegment,
  setRuntimeLiveModuleContentDirectories,
} from "../../../../src/shared/live-module-canvas-path.ts";
import {
  detectLiveModuleFrameworkFromFileName,
  isLiveModuleCanvasFileName,
} from "../../../../src/shared/live-module-framework.ts";

describe("live-module-canvas-path", () => {
  it("accepts multi-framework canvas entries under factory default roots", () => {
    clearAllRuntimeLiveModuleContentDirectories();
    expect(isProjectCanvasPath(".pier/canvases/hello.canvas.tsx")).toBe(true);
    expect(isProjectCanvasPath("docs/specs/a.canvas.tsx")).toBe(true);
    expect(isProjectCanvasPath("docs/nested/b.canvas.vue")).toBe(true);
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
    expect(canvasRelPathFromProjectPath("docs/overview.canvas.tsx")).toBe(
      "overview.canvas.tsx"
    );
  });

  it("picks the longest matching content root", () => {
    const location = projectCanvasLocation("docs/design/x.canvas.tsx", [
      "docs",
      "docs/design",
    ]);
    expect(location).toEqual({
      directory: "docs/design",
      relPath: "x.canvas.tsx",
    });
  });

  it("isolates runtime content directories per project root", () => {
    clearAllRuntimeLiveModuleContentDirectories();
    setRuntimeLiveModuleContentDirectories("/proj/a", ["designs"]);
    setRuntimeLiveModuleContentDirectories("/proj/b", ["docs-only"]);
    expect(liveModuleProjectContentDirectories("/proj/a")).toEqual(["designs"]);
    expect(liveModuleProjectContentDirectories("/proj/b")).toEqual([
      "docs-only",
    ]);
    expect(
      isProjectCanvasPath(
        "designs/a.canvas.tsx",
        liveModuleProjectContentDirectories("/proj/a")
      )
    ).toBe(true);
    expect(
      isProjectCanvasPath(
        "designs/a.canvas.tsx",
        liveModuleProjectContentDirectories("/proj/b")
      )
    ).toBe(false);
    expect(
      isProjectCanvasPath(
        "docs-only/x.canvas.tsx",
        liveModuleProjectContentDirectories("/proj/b")
      )
    ).toBe(true);
    // Without a project root, path helpers use factory defaults only.
    expect(isProjectCanvasPath("designs/a.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/a.canvas.tsx")).toBe(true);
    clearAllRuntimeLiveModuleContentDirectories();
  });

  it("uses an explicit full list without forcing factory defaults", () => {
    expect(isProjectCanvasPath("designs/a.canvas.tsx", ["designs"])).toBe(true);
    expect(isProjectCanvasPath("docs/a.canvas.tsx", ["designs"])).toBe(false);
    expect(
      isProjectCanvasPath(".pier/canvases/a.canvas.tsx", ["designs"])
    ).toBe(false);
  });

  it("resolves config: full list, legacy extras, or factory defaults", () => {
    expect(
      resolveLiveModuleContentDirectories({
        contentDirectories: ["designs", "docs"],
      })
    ).toEqual(["designs", "docs"]);
    expect(
      resolveLiveModuleContentDirectories({
        extraContentDirectories: ["designs"],
      })
    ).toEqual([".pier/canvases", "docs", "designs"]);
    expect(resolveLiveModuleContentDirectories({})).toEqual([
      ".pier/canvases",
      "docs",
    ]);
  });

  it("parses live-modules project config", () => {
    expect(
      parseLiveModulesProjectConfig(
        JSON.stringify({
          version: 1,
          contentDirectories: [".pier/canvases"],
        })
      )
    ).toEqual({
      contentDirectories: [".pier/canvases"],
      hasExplicitList: true,
    });
    expect(
      parseLiveModulesProjectConfig(
        JSON.stringify({
          version: 1,
          extraContentDirectories: ["designs"],
        })
      ).contentDirectories
    ).toEqual([".pier/canvases", "docs", "designs"]);
    expect(parseLiveModulesProjectConfig("{").hasExplicitList).toBe(false);
  });

  it("rejects canvases outside content roots", () => {
    clearAllRuntimeLiveModuleContentDirectories();
    expect(isProjectCanvasPath(".pier/plans/demo/plan.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath("src/foo.tsx")).toBe(false);
    expect(isProjectCanvasPath("elsewhere/hello.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/hello.tsx")).toBe(false);
    expect(isProjectCanvasPath("src/features/checkout.canvas.tsx")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/readme.md")).toBe(false);
    expect(isProjectCanvasPath(".pier/canvases/.canvas.tsx")).toBe(false);
    expect(
      canvasRelPathFromProjectPath(".pier/canvases/../secret.canvas.tsx")
    ).toBeNull();
  });

  it("resolves sibling files inside the canvas directory", () => {
    clearAllRuntimeLiveModuleContentDirectories();
    const canvas = ".pier/canvases/demo/hello.canvas.tsx";
    expect(canvasDirectoryFromProjectPath(canvas)).toBe(".pier/canvases/demo");
    expect(canvasSiblingProjectPath(canvas, "data.json")).toBe(
      ".pier/canvases/demo/data.json"
    );
    expect(canvasSiblingProjectPath("docs/a/x.canvas.tsx", "data.json")).toBe(
      "docs/a/data.json"
    );
    expect(
      canvasSiblingProjectPath(".pier/canvases/a.canvas.tsx", "b.json")
    ).toBe(".pier/canvases/b.json");
  });

  it("allows one nested folder next to the canvas", () => {
    const canvas = ".pier/canvases/demo/hello.canvas.tsx";
    expect(canvasSiblingProjectPath(canvas, "nested/data.json")).toBe(
      ".pier/canvases/demo/nested/data.json"
    );
    expect(canvasSiblingProjectPath(canvas, "state/positions.json")).toBe(
      ".pier/canvases/demo/state/positions.json"
    );
  });

  it("refuses sibling names that leave the canvas directory", () => {
    const canvas = ".pier/canvases/demo/hello.canvas.tsx";
    for (const name of [
      "",
      ".",
      "..",
      "../data.json",
      "a/b/c.json",
      "nested/",
      "nested/../x",
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

  it("needs the custom content list to treat a non-default canvas as in-project", () => {
    const canvas =
      "resources/system-skills/pier-canvas/templates/kanban.canvas.tsx";
    const roots = ["resources/system-skills/pier-canvas/templates"];
    expect(canvasSiblingProjectPath(canvas, "board.json")).toBeNull();
    expect(canvasSiblingProjectPath(canvas, "board.json", roots)).toBe(
      "resources/system-skills/pier-canvas/templates/board.json"
    );
  });

  it("joins a host-supplied canvas directory without re-checking content roots", () => {
    expect(
      canvasScopedSiblingPath(
        "resources/system-skills/pier-canvas/templates",
        "board.json"
      )
    ).toBe("resources/system-skills/pier-canvas/templates/board.json");
    expect(canvasScopedSiblingPath("", "data.json")).toBe("data.json");
    expect(canvasScopedSiblingPath(".pier/canvases/demo", "../x")).toBeNull();
  });

  it("normalizes directory lists", () => {
    expect(
      normalizeContentDirectoryList([
        ".pier/canvases/",
        "docs",
        "docs",
        "../evil",
      ])
    ).toEqual([".pier/canvases", "docs"]);
  });

  it("sanitizes content-directory segments for live root ids", () => {
    expect(sanitizeLiveRootIdSegment("Docs")).toBe("docs");
    expect(sanitizeLiveRootIdSegment("My Designs")).toBe("my-designs");
    expect(sanitizeLiveRootIdSegment("designs/ui")).toBe("designs-ui");
    expect(sanitizeLiveRootIdSegment("123start")).toBe("start");
    expect(sanitizeLiveRootIdSegment("***")).toBe("dir");
    const base = projectLiveRootId("/tmp/proj");
    expect(liveModuleContentRootId(base, ".pier/canvases")).toBe(base);
    const docsId = liveModuleContentRootId(base, "Docs");
    expect(docsId).toMatch(new RegExp(`^${base}\\.docs\\.[a-z0-9]+$`, "u"));
    expect(docsId).toMatch(/^[a-z][a-z0-9._-]*$/u);
    const spaced = liveModuleContentRootId(base, "My Designs");
    expect(spaced).toMatch(/^[a-z][a-z0-9._-]*$/u);
    expect(spaced).toContain("my-designs");
  });

  it("keeps live root ids unique when sanitized segments collide", () => {
    const base = projectLiveRootId("/tmp/proj");
    expect(liveModuleContentRootId(base, "foo/bar")).not.toBe(
      liveModuleContentRootId(base, "foo-bar")
    );
    expect(liveModuleContentRootId(base, "***")).not.toBe(
      liveModuleContentRootId(base, "!!!")
    );
    expect(liveModuleContentRootId(base, "My Designs")).not.toBe(
      liveModuleContentRootId(base, "my-designs")
    );
  });

  it("rejects '.' as a content directory", () => {
    expect(normalizeContentDirectory(".")).toBeNull();
    expect(normalizeContentDirectoryList([".", "docs"])).toEqual(["docs"]);
  });

  it("keeps canvas filename helpers stable", () => {
    expect(isCanvasFileName("a.canvas.tsx")).toBe(true);
    expect(isLiveModuleCanvasFileName("a.canvas.tsx")).toBe(true);
    expect(isLiveModuleCanvasFileName("x.canvas.solid.tsx")).toBe(true);
    expect(detectLiveModuleFrameworkFromFileName("a.canvas.vue")).toBe("vue");
    expect(detectLiveModuleFrameworkFromFileName("x.canvas.solid.tsx")).toBe(
      "solid"
    );
    expect(isCanvasFileName(".canvas.tsx")).toBe(false);
    expect(isCanvasFileName("hello.tsx")).toBe(false);
    expect(isCanvasFileName("hello.canvas.ts")).toBe(false);
  });
});
