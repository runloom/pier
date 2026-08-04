import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import {
  buildWindowDisplays,
  pathBasename,
  type WindowDisplayCopy,
} from "@/components/workspace/transfer/window-display.ts";

const copy: WindowDisplayCopy = {
  emptyWindow: (index) => `Window ${index}`,
  emptyWindowDescription: "Empty window",
  sameNameIndex: (index) => ` · ${index}`,
  tabCount: (count) => `${count} tabs`,
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

describe("buildWindowDisplays", () => {
  it("uses project basename as label and active tab as description", () => {
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
  });

  it("falls back to Window N for empty windows", () => {
    const displays = buildWindowDisplays(
      [window("w1"), window("w2")],
      [],
      copy
    );
    expect(displays.map((d) => d.label)).toEqual(["Window 1", "Window 2"]);
    expect(displays[0]?.description).toBe("Empty window");
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

  it("prefers active panel over inactive for description", () => {
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
});
