import { describe, expect, it } from "vitest";
import { windowDisplayDraftFromDescriptors } from "@/lib/window-display-draft.ts";

describe("windowDisplayDraftFromDescriptors", () => {
  it("reports a file short name as a stable qualifier", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        context: {
          contextId: "c1",
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: { short: "relocate.ts" },
        kind: "file",
      },
    });
    expect(patch.baseLabel).toBe("pier");
    expect(patch.stableTabQualifier).toBe("relocate.ts");
  });

  it("does not treat terminal OSC as a stable qualifier", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        context: {
          contextId: "c1",
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: { short: "Claude Code", terminalTitle: "Claude Code" },
        kind: "terminal",
      },
    });
    expect(patch.baseLabel).toBe("pier");
    expect(patch.stableTabQualifier).toBeUndefined();
  });

  it("reports an untitled files-plugin tab as a stable qualifier", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        context: {
          contextId: "c1",
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: { long: "Untitled-1", short: "Untitled-1" },
        kind: "web",
        tab: {
          icon: { id: "pier.file:Untitled-1" },
          title: "Untitled-1",
          tooltip: { title: "Untitled-1" },
        },
      },
    });
    expect(patch.baseLabel).toBe("pier");
    expect(patch.stableTabQualifier).toBe("Untitled-1");
  });

  it("reports a stable tab name as baseLabel when there is no project path", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        display: { long: "Untitled-1", short: "Untitled-1" },
        kind: "web",
        tab: {
          icon: { id: "pier.file:Untitled-1" },
          title: "Untitled-1",
          tooltip: { title: "Untitled-1" },
        },
      },
    });
    expect(patch.baseLabel).toBe("Untitled-1");
    expect(patch.projectPath).toBeUndefined();
  });

  it("does not report Welcome as a window identity", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        display: { long: "Welcome", short: "Welcome" },
        kind: "web",
      },
    });
    expect(patch.baseLabel).toBeUndefined();
    expect(patch.stableTabQualifier).toBeUndefined();
  });

  it("reports a files-plugin web tab whose long title is the disk path", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        context: {
          contextId: "c1",
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: {
          long: "/Users/me/pier/src/relocate.ts",
          short: "relocate.ts",
        },
        kind: "web",
      },
    });
    expect(patch.baseLabel).toBe("pier");
    expect(patch.stableTabQualifier).toBe("relocate.ts");
  });

  it("uses a user-pinned terminal title", () => {
    const patch = windowDisplayDraftFromDescriptors("p1", {
      p1: {
        context: {
          contextId: "c1",
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: { short: "审查" },
        kind: "terminal",
        tab: { title: "审查", titleSource: "user" },
      },
    });
    expect(patch.stableTabQualifier).toBe("审查");
  });
});
