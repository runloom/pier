import { parseSourceState } from "@plugins/builtin/files/renderer/panel/source.ts";
import { filesPanelTabChrome } from "@plugins/builtin/files/renderer/panel/tab.ts";
import { describe, expect, it } from "vitest";

const projectContext = {
  contextId: "ctx:1",
  projectRootPath: "/Users/a/feat-canvas-20260815",
  updatedAt: 1,
};

const t = (key: string, fallback?: string) => fallback ?? key;

describe("Files panel tab chrome", () => {
  it("derives disk file icons and full-path tooltips from the source", () => {
    expect(
      filesPanelTabChrome({
        source: { kind: "disk", path: "src/file.ts", root: "/repo" },
      })
    ).toEqual({
      icon: { id: "pier.file:file.ts" },
      title: "file.ts",
      tooltip: { title: "/repo/src/file.ts" },
    });
  });

  it("keeps disk and untitled editor tabs on file icons when context is present", () => {
    expect(
      filesPanelTabChrome({
        context: projectContext,
        source: { kind: "disk", path: "src/file.ts", root: "/repo" },
      })?.icon
    ).toEqual({ id: "pier.file:file.ts" });
    expect(
      filesPanelTabChrome({
        context: projectContext,
        source: { id: "draft-1", kind: "untitled", name: "Untitled.md" },
      })?.icon
    ).toEqual({ id: "pier.file:Untitled.md" });
  });

  it("derives untitled icons and name tooltips from the document name", () => {
    expect(
      filesPanelTabChrome({
        source: { id: "draft-1", kind: "untitled", name: "Untitled.md" },
      })
    ).toEqual({
      icon: { id: "pier.file:Untitled.md" },
      title: "Untitled.md",
      tooltip: { title: "Untitled.md" },
    });
  });

  it("uses the project folder icon for tree-only panels", () => {
    expect(filesPanelTabChrome({})).toEqual({
      icon: { id: "pier.files.project" },
    });
    expect(
      filesPanelTabChrome({
        context: projectContext,
      })
    ).toEqual({
      icon: { id: "pier.files.project" },
      title: "feat-canvas-20260815",
      tooltip: { title: "/Users/a/feat-canvas-20260815" },
    });
    expect(parseSourceState({ context: projectContext }, t).kind).toBe("empty");
  });

  it("keeps malformed document panels on the registration icon", () => {
    expect(filesPanelTabChrome({ source: { kind: "disk" } })).toBeUndefined();
    expect(
      filesPanelTabChrome({ context: projectContext, source: null })
    ).toBeUndefined();
    expect(
      filesPanelTabChrome({ context: projectContext, source: undefined })
    ).toBeUndefined();
    expect(parseSourceState({ source: null }, t).kind).toBe("invalid");
    expect(parseSourceState({ source: undefined }, t).kind).toBe("invalid");
    expect(parseSourceState({ source: { kind: "disk" } }, t).kind).toBe(
      "invalid"
    );
  });
});
