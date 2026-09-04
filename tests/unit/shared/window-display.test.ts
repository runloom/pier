import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import {
  buildWindowDisplays,
  isDistinctQualifier,
  pathBasename,
  stableTabQualifierFromPanel,
  type WindowDisplayCopy,
  windowDisplayCopyForLocale,
} from "@shared/window-display/index.ts";
import { describe, expect, it } from "vitest";

const copy: WindowDisplayCopy = {
  emptyWindow: (index) => `Window ${index}`,
  emptyWindowDescription: "Empty window",
  sameNameIndex: (index) => ` · ${index}`,
};

function window(id: string, patch?: Partial<WindowInfo>): WindowInfo {
  return {
    focused: false,
    id,
    recordId: `record-${id}`,
    ...patch,
  };
}

function panel(
  patch: Partial<PanelSnapshot> & Pick<PanelSnapshot, "id" | "windowId">
): PanelSnapshot {
  return {
    kind: "web",
    ...patch,
  };
}

describe("pathBasename", () => {
  it("handles posix and trailing slash", () => {
    expect(pathBasename("/Users/me/pier")).toBe("pier");
    expect(pathBasename("/Users/me/pier/")).toBe("pier");
    expect(pathBasename("C:\\repo\\app")).toBe("app");
  });
});

describe("isDistinctQualifier", () => {
  it("treats slash vs dash as the same visual identity", () => {
    expect(isDistinctQualifier("feat/foo", "feat-foo")).toBe(false);
    expect(isDistinctQualifier("feat/bug-20260829", "feat-bug-20260823")).toBe(
      true
    );
  });

  it("keeps a namespaced branch distinct from a last-segment folder leaf", () => {
    expect(isDistinctQualifier("feat/foo", "foo")).toBe(true);
  });
});

describe("copy", () => {
  it("matches locale empty-window copy to product strings", () => {
    expect(windowDisplayCopyForLocale("zh-CN").emptyWindow(1)).toBe("窗口 1");
    expect(windowDisplayCopyForLocale("en").emptyWindow(2)).toBe("Window 2");
    expect(windowDisplayCopyForLocale("ja").emptyWindowDescription).toBe(
      "空のウインドウ"
    );
    expect(windowDisplayCopyForLocale("ko").sameNameIndex(2)).toBe(" · 2");
  });
});

describe("stableTabQualifierFromPanel", () => {
  it("uses file short names and ignores terminal OSC", () => {
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: { short: "src/relocate.ts" },
          id: "f",
          kind: "file",
          windowId: "w1",
        }),
        "pier"
      )
    ).toBe("relocate.ts");
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: { short: "Claude Code", terminalTitle: "Claude Code" },
          id: "t",
          kind: "terminal",
          windowId: "w1",
        }),
        "pier"
      )
    ).toBeUndefined();
  });

  it("uses a user-pinned tab title", () => {
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: { short: "Claude Code" },
          id: "t",
          kind: "terminal",
          tab: { title: "审查", titleSource: "user" },
          windowId: "w1",
        }),
        "pier"
      )
    ).toBe("审查");
  });

  it("accepts production file tabs that register as kind web with a path long title", () => {
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: {
            long: "/Users/me/pier/src/relocate.ts",
            short: "relocate.ts",
          },
          id: "f",
          kind: "web",
          windowId: "w1",
        }),
        "pier"
      )
    ).toBe("relocate.ts");
  });

  it("accepts untitled files plugin tabs via the file icon prefix", () => {
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: { long: "Untitled-1", short: "Untitled-1" },
          id: "u",
          tab: {
            icon: { id: "pier.file:Untitled-1" },
            title: "Untitled-1",
            tooltip: { title: "Untitled-1" },
          },
          windowId: "w1",
        }),
        "pier"
      )
    ).toBe("Untitled-1");
  });

  it("ignores Welcome and other product titles that are not files", () => {
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: { long: "Welcome", short: "Welcome" },
          id: "w",
          windowId: "w1",
        }),
        "pier"
      )
    ).toBeUndefined();
    expect(
      stableTabQualifierFromPanel(
        panel({
          display: {
            long: "Changes · pier · main",
            short: "pier · main",
          },
          id: "g",
          windowId: "w1",
        }),
        "pier"
      )
    ).toBeUndefined();
  });
});

describe("buildWindowDisplays", () => {
  it("uses folder leaf as label, distinct file as qualifier, path as detail", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            contextId: "c1",
            projectRootPath: "/Users/me/Xyz/pier",
            updatedAt: 1,
          },
          display: { short: "relocate.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays).toHaveLength(1);
    expect(displays[0]?.label).toBe("pier");
    expect(displays[0]?.menuLabel).toBe("pier");
    expect(displays[0]?.description).toBe("relocate.ts");
    expect(displays[0]?.detail).toBe("/Users/me/Xyz/pier");
    expect(displays[0]?.iconKind).toBe("folder");
  });

  it("omits the right column when the terminal title echoes the leaf", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            contextId: "c1",
            projectRootPath: "/Users/xyz/ABC/pier.worktree/feat-bug-20260823",
            updatedAt: 1,
          },
          display: { short: "feat-bug-20260823" },
          id: "p1",
          kind: "terminal",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-bug-20260823");
    expect(displays[0]?.description).toBeUndefined();
    expect(displays[0]?.detail).toBe(
      "/Users/xyz/ABC/pier.worktree/feat-bug-20260823"
    );
  });

  it("omits the right column when the title is the full identity path", () => {
    const path = "/Users/xyz/ABC/pier.worktree/feat-bug-20260823";
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            contextId: "c1",
            projectRootPath: path,
            updatedAt: 1,
          },
          display: { long: path, short: path },
          id: "p1",
          kind: "terminal",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-bug-20260823");
    expect(displays[0]?.description).toBeUndefined();
  });

  it("prefers a distinct git branch over the active file as qualifier", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            branch: "feat/bug-20260829",
            contextId: "c1",
            gitRoot: "/Users/xyz/ABC/pier.worktree/feat-bug-20260823",
            projectRootPath: "/Users/xyz/ABC/pier.worktree/feat-bug-20260823",
            updatedAt: 1,
            worktreeRoot: "/Users/xyz/ABC/pier.worktree/feat-bug-20260823",
          },
          display: { short: "relocate.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-bug-20260823");
    expect(displays[0]?.menuLabel).toBe("feat-bug-20260823");
    expect(displays[0]?.description).toBe("feat/bug-20260829");
    expect(displays[0]?.detail).toBe(
      "/Users/xyz/ABC/pier.worktree/feat-bug-20260823"
    );
    expect(displays[0]?.iconKind).toBe("git");
    expect(displays[0]?.searchTerms).toContain("feat/bug-20260829");
  });

  it("keeps feat/foo as qualifier when the worktree folder is only foo", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            branch: "feat/foo",
            contextId: "c1",
            gitRoot: "/repo/foo",
            projectRootPath: "/repo/foo",
            updatedAt: 1,
            worktreeRoot: "/repo/foo",
          },
          display: { short: "relocate.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("foo");
    expect(displays[0]?.description).toBe("feat/foo");
  });

  it("skips a slash-sanitized branch echo and falls back to the file title", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            branch: "feat/foo",
            contextId: "c1",
            gitRoot: "/repo/feat-foo",
            projectRootPath: "/repo/feat-foo",
            updatedAt: 1,
            worktreeRoot: "/repo/feat-foo",
          },
          display: { short: "relocate.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-foo");
    expect(displays[0]?.description).toBe("relocate.ts");
  });

  it("prefers worktreeRoot over projectRootPath for the leaf", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            contextId: "c1",
            gitRoot: "/Users/me/pier.worktree/feat-x",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
            worktreeRoot: "/Users/me/pier.worktree/feat-x",
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-x");
    expect(displays[0]?.detail).toBe("/Users/me/pier.worktree/feat-x");
  });

  it("falls back to a stable file tab name when no project root", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          display: { short: "Welcome" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("Welcome");
    expect(displays[0]?.description).toBeUndefined();
    expect(displays[0]?.detail).toBeUndefined();
  });

  it("does not use OSC as the empty-path window name", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          display: { short: "Claude Code", terminalTitle: "Claude Code" },
          id: "p1",
          kind: "terminal",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("Window 1");
    expect(displays[0]?.menuLabel).toBe("Window 1");
  });

  it("names a Welcome-only window as an empty window, not Welcome", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          display: { long: "Welcome", short: "Welcome" },
          id: "welcome",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.menuLabel).toBe("Window 1");
    expect(displays[0]?.menuLabel).not.toContain("Welcome");
  });

  it("falls back to Window N for empty windows", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [],
      copy
    );
    expect(displays.map((d) => d.label)).toEqual(["Window 1", "Window 2"]);
    expect(displays.map((d) => d.menuLabel)).toEqual(["Window 1", "Window 2"]);
    expect(displays[0]?.description).toBe("Empty window");
    expect(displays[0]?.iconKind).toBeUndefined();
  });

  it("disambiguates same project name with parent folder", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/Users/me/Xyz/pier",
            updatedAt: 1,
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "b",
            projectRootPath: "/Users/me/worktrees/pier",
            updatedAt: 1,
          },
          display: { short: "b.ts" },
          id: "p2",
          kind: "file",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.label).sort()).toEqual(
      ["pier · Xyz", "pier · worktrees"].sort()
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · Xyz", "pier · worktrees"].sort()
    );
  });

  it("disambiguates identical paths with file names, including the current window", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "b",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "b.ts" },
          id: "p2",
          kind: "file",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.label).sort()).toEqual(
      ["pier · a.ts", "pier · b.ts"].sort()
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · a.ts", "pier · b.ts"].sort()
    );
  });

  it("qualifies colliding files plugin tabs that register as kind web", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: {
            long: "/Users/me/pier/src/a.ts",
            short: "a.ts",
          },
          id: "p1",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "b",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: {
            long: "/Users/me/pier/src/b.ts",
            short: "b.ts",
          },
          id: "p2",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · a.ts", "pier · b.ts"].sort()
    );
  });

  it("qualifies colliding untitled files plugin tabs", () => {
    const untitled = (id: string, name: string, windowId: string) =>
      panel({
        active: true,
        context: {
          contextId: id,
          projectRootPath: "/Users/me/pier",
          updatedAt: 1,
        },
        display: { long: name, short: name },
        id,
        tab: {
          icon: { id: `pier.file:${name}` },
          title: name,
          tooltip: { title: name },
        },
        windowId,
      });
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [untitled("p1", "Untitled-1", "w1"), untitled("p2", "Untitled-2", "w2")],
      copy
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · Untitled-1", "pier · Untitled-2"].sort()
    );
  });

  it("does not put OSC into colliding terminal window names", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "Claude Code", terminalTitle: "Claude Code" },
          id: "p1",
          kind: "terminal",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "b",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "vim", terminalTitle: "vim" },
          id: "p2",
          kind: "terminal",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier", "pier · 2"].sort()
    );
    expect(displays.map((d) => d.menuLabel).join(" ")).not.toMatch(
      /Claude|vim/i
    );
  });

  it("qualifies colliding leaves with user-pinned tab titles", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "Claude Code" },
          id: "p1",
          kind: "terminal",
          tab: { title: "审查", titleSource: "user" },
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "b",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
          },
          display: { short: "zsh" },
          id: "p2",
          kind: "terminal",
          tab: { title: "日志", titleSource: "user" },
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · 审查", "pier · 日志"].sort()
    );
  });

  it("prefers active panel over inactive for the file qualifier", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: false,
          context: {
            contextId: "a",
            projectRootPath: "/repo/app",
            updatedAt: 1,
          },
          display: { short: "idle.ts" },
          id: "p-idle",
          kind: "file",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            contextId: "a",
            projectRootPath: "/repo/app",
            updatedAt: 1,
          },
          display: { short: "focus.ts" },
          id: "p-active",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("app");
    expect(displays[0]?.description).toBe("focus.ts");
  });

  it("keeps main as a short qualifier when repos share that branch", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            branch: "main",
            contextId: "a",
            gitRoot: "/Users/me/pier",
            projectRootPath: "/Users/me/pier",
            updatedAt: 1,
            worktreeRoot: "/Users/me/pier",
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            branch: "main",
            contextId: "b",
            gitRoot: "/Users/me/website",
            projectRootPath: "/Users/me/website",
            updatedAt: 1,
            worktreeRoot: "/Users/me/website",
          },
          display: { short: "b.ts" },
          id: "p2",
          kind: "file",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.label).sort()).toEqual(["pier", "website"]);
    expect(displays.map((d) => d.description)).toEqual(["main", "main"]);
    expect(displays.map((d) => d.menuLabel).sort()).toEqual([
      "pier",
      "website",
    ]);
  });
});

describe("window menuLabel", () => {
  it("keeps a unique leaf unqualified even when a branch exists", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          context: {
            branch: "feat/x",
            contextId: "c1",
            gitRoot: "/repo/pier",
            projectRootPath: "/repo/pier",
            updatedAt: 1,
            worktreeRoot: "/repo/pier",
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.menuLabel).toBe("pier");
  });

  it("qualifies colliding leaves with distinct branches before tab titles", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [
        panel({
          active: true,
          context: {
            branch: "main",
            contextId: "a",
            gitRoot: "/repo/pier",
            projectRootPath: "/repo/pier",
            updatedAt: 1,
            worktreeRoot: "/repo/pier",
          },
          display: { short: "a.ts" },
          id: "p1",
          kind: "file",
          windowId: "w1",
        }),
        panel({
          active: true,
          context: {
            branch: "feat/x",
            contextId: "b",
            gitRoot: "/repo/pier",
            projectRootPath: "/repo/pier",
            updatedAt: 1,
            worktreeRoot: "/repo/pier",
          },
          display: { short: "b.ts" },
          id: "p2",
          kind: "file",
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.menuLabel).sort()).toEqual(
      ["pier · feat/x", "pier · main"].sort()
    );
  });
});
