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
  it("includes descriptor cwd/title and dockview group/tab position", () => {
    const terminalOne = panel("terminal-1");
    const terminalTwo = panel("terminal-2");
    const webPanel = panel("welcome-1", "welcome");
    const api = {
      activePanel: terminalTwo,
      groups: [{ panels: [terminalOne, webPanel] }, { panels: [terminalTwo] }],
      panels: [terminalOne, webPanel, terminalTwo],
    };

    expect(
      buildWorkspacePanelSnapshots(api, {
        "terminal-1": {
          path: "/Users/xyz/ABC/pier",
          short: "pier",
        },
        "terminal-2": {
          long: "Claude Code",
          path: "/Users/xyz/ABC/bay",
          short: "bay",
        },
      })
    ).toEqual([
      {
        active: false,
        cwd: "/Users/xyz/ABC/pier",
        groupIndex: 0,
        id: "terminal-1",
        kind: "terminal",
        tabCount: 2,
        tabIndex: 0,
        title: "pier",
      },
      {
        active: false,
        groupIndex: 0,
        id: "welcome-1",
        kind: "web",
        tabCount: 2,
        tabIndex: 1,
        title: "Terminal",
      },
      {
        active: true,
        cwd: "/Users/xyz/ABC/bay",
        groupIndex: 1,
        id: "terminal-2",
        kind: "terminal",
        tabCount: 1,
        tabIndex: 0,
        title: "bay",
      },
    ]);
  });
});
