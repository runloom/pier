import { describe, expect, it } from "vitest";
import {
  buildTerminalPresentationFacts,
  type TerminalPresentationWorkspaceState,
} from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";

const frame = { height: 93, width: 213, x: 0, y: 72 };

function workspace(
  overrides: Partial<TerminalPresentationWorkspaceState>
): TerminalPresentationWorkspaceState {
  return {
    activePanelId: "terminal-1",
    activeTerminalPanelId: "terminal-1",
    hasMaximizedGroup: false,
    panels: [
      {
        component: "terminal",
        dockviewActive: true,
        dockviewVisible: true,
        id: "terminal-1",
      },
      {
        component: "terminal",
        dockviewActive: false,
        dockviewVisible: false,
        id: "terminal-2",
      },
      {
        component: "welcome",
        dockviewActive: false,
        dockviewVisible: true,
        id: "welcome-1",
      },
    ],
    ...overrides,
  };
}

describe("terminal presentation reconciler", () => {
  it("hides every terminal while a web panel is maximized", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: () => frame,
      reason: "dockview-maximize",
      workspace: workspace({
        activePanelId: "welcome-1",
        activeTerminalPanelId: null,
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { frame, panelId: "terminal-1", visible: false },
      { frame, panelId: "terminal-2", visible: false },
    ]);
  });

  it("shows only the active terminal while maximized", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: (panelId) => (panelId === "terminal-1" ? frame : null),
      reason: "dockview-maximize",
      workspace: workspace({
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { frame, panelId: "terminal-1", visible: true },
      { frame: null, panelId: "terminal-2", visible: false },
    ]);
  });

  it("does not treat a real anchor frame as visible when dockview marks the panel hidden", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: (panelId) => (panelId === "terminal-2" ? frame : null),
      reason: "dockview-layout",
      workspace: workspace({ hasMaximizedGroup: false }),
    });

    expect(snapshot.terminals).toEqual([
      { frame: null, panelId: "terminal-1", visible: false },
      { frame, panelId: "terminal-2", visible: false },
    ]);
  });

  it("keeps the active terminal visible during transient dockview visibility lag", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: (panelId) => (panelId === "terminal-2" ? frame : null),
      reason: "dockview-layout",
      workspace: workspace({
        activePanelId: "terminal-2",
        activeTerminalPanelId: "terminal-2",
        hasMaximizedGroup: false,
        panels: [
          {
            component: "terminal",
            dockviewActive: false,
            dockviewVisible: false,
            id: "terminal-2",
          },
        ],
      }),
    });

    expect(snapshot.terminals).toEqual([
      { frame, panelId: "terminal-2", visible: true },
    ]);
  });

  it("does not encode keyboard focus in the presentation snapshot", () => {
    const snapshot = buildTerminalPresentationFacts({
      readFrame: () => frame,
      reason: "dockview-active-panel",
      workspace: workspace({ hasMaximizedGroup: false }),
    });

    expect(snapshot.terminals[0]).toEqual({
      frame,
      panelId: "terminal-1",
      visible: true,
    });
    expect(snapshot.terminals[0]).not.toHaveProperty("focused");
  });
});
