import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import {
  buildWindowDisplays,
  isDistinctQualifier,
  pathBasename,
  type WindowDisplayCopy,
} from "@/components/workspace/transfer/window-display.ts";

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
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays).toHaveLength(1);
    expect(displays[0]?.label).toBe("pier");
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
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-bug-20260823");
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
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("feat-x");
    expect(displays[0]?.detail).toBe("/Users/me/pier.worktree/feat-x");
  });

  it("falls back to tab title when no project root", () => {
    const displays = buildWindowDisplays(
      [window("w1")],
      [
        panel({
          active: true,
          display: { short: "Welcome" },
          id: "p1",
          windowId: "w1",
        }),
      ],
      copy
    );
    expect(displays[0]?.label).toBe("Welcome");
    expect(displays[0]?.description).toBeUndefined();
    expect(displays[0]?.detail).toBeUndefined();
  });

  it("falls back to Window N for empty windows", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [],
      copy
    );
    expect(displays.map((d) => d.label)).toEqual(["Window 1", "Window 2"]);
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
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.label).sort()).toEqual(
      ["pier · Xyz", "pier · worktrees"].sort()
    );
  });

  it("disambiguates identical paths with index suffix", () => {
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
          windowId: "w2",
        }),
      ],
      copy
    );
    const labels = displays.map((d) => d.label);
    expect(labels).toContain("pier");
    expect(labels).toContain("pier · 2");
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
          windowId: "w2",
        }),
      ],
      copy
    );
    expect(displays.map((d) => d.label).sort()).toEqual(["pier", "website"]);
    expect(displays.map((d) => d.description)).toEqual(["main", "main"]);
  });
});
