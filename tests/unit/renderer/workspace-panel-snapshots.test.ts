import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import { buildWorkspacePanelSnapshots } from "@/components/workspace/workspace-panel-snapshots.ts";

function panel(id: string, component = "terminal") {
  return {
    id,
    title: "Terminal",
    view: { contentComponent: component },
  };
}

describe("buildWorkspacePanelSnapshots", () => {
  it("includes shared descriptor, context, and dockview group/tab position", () => {
    const terminalOne = panel("terminal-1");
    const terminalTwo = panel("terminal-2");
    const webPanel = panel("welcome-1", "welcome");
    const api = {
      activePanel: terminalTwo,
      groups: [{ panels: [terminalOne, webPanel] }, { panels: [terminalTwo] }],
      panels: [terminalOne, webPanel, terminalTwo],
    };

    const pierContext: PanelContext = {
      contextId: "ctx-pier",
      cwd: "/Users/xyz/ABC/pier",
      openedPath: "/Users/xyz/ABC/pier",
      projectRootPath: "/Users/xyz/ABC/pier",
      source: "panel",
      updatedAt: 1_772_000_000_000,
      worktreeKey: "/Users/xyz/ABC/pier",
    };
    const bayContext: PanelContext = {
      contextId: "ctx-bay",
      cwd: "/Users/xyz/ABC/bay",
      openedPath: "/Users/xyz/ABC/bay",
      projectRootPath: "/Users/xyz/ABC/bay",
      source: "panel",
      updatedAt: 1_772_000_000_001,
      worktreeKey: "/Users/xyz/ABC/bay",
    };

    expect(
      buildWorkspacePanelSnapshots(api, {
        "terminal-1": {
          context: pierContext,
          display: { short: "pier" },
          tab: {
            badge: { label: "package.json" },
            icon: { id: "pier.task" },
            title: "test",
          },
        },
        "terminal-2": {
          context: bayContext,
          display: {
            long: "Claude Code",
            short: "bay",
            terminalTitle: "Claude Code",
          },
        },
      })
    ).toEqual([
      {
        active: false,
        context: pierContext,
        display: { short: "pier" },
        groupIndex: 0,
        id: "terminal-1",
        kind: "terminal",
        tab: {
          badge: { label: "package.json" },
          icon: { id: "pier.task" },
          title: "test",
        },
        tabCount: 2,
        tabIndex: 0,
      },
      {
        active: false,
        display: { short: "Terminal" },
        groupIndex: 0,
        id: "welcome-1",
        kind: "web",
        tabCount: 2,
        tabIndex: 1,
      },
      {
        active: true,
        context: bayContext,
        display: {
          long: "Claude Code",
          short: "bay",
          terminalTitle: "Claude Code",
        },
        groupIndex: 1,
        id: "terminal-2",
        kind: "terminal",
        tabCount: 1,
        tabIndex: 0,
      },
    ]);
  });
});
