import { describe, expect, it } from "vitest";
import {
  buildTerminalPresentationSnapshot,
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
    const snapshot = buildTerminalPresentationSnapshot({
      readFrame: () => frame,
      reason: "dockview-maximize",
      rendererSequence: 1,
      workspace: workspace({
        activePanelId: "welcome-1",
        activeTerminalPanelId: null,
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { focused: false, frame, panelId: "terminal-1", visible: false },
      { focused: false, frame, panelId: "terminal-2", visible: false },
    ]);
  });

  it("shows only the active terminal while maximized", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      readFrame: (panelId) => (panelId === "terminal-1" ? frame : null),
      reason: "dockview-maximize",
      rendererSequence: 2,
      workspace: workspace({
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { focused: false, frame, panelId: "terminal-1", visible: true },
      { focused: false, frame: null, panelId: "terminal-2", visible: false },
    ]);
  });

  it("uses dockview visibility or a real anchor frame outside maximized mode", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      readFrame: (panelId) => (panelId === "terminal-2" ? frame : null),
      reason: "dockview-layout",
      rendererSequence: 3,
      workspace: workspace({ hasMaximizedGroup: false }),
    });

    expect(snapshot.terminals).toEqual([
      { focused: false, frame: null, panelId: "terminal-1", visible: false },
      { focused: false, frame, panelId: "terminal-2", visible: true },
    ]);
  });

  it("does not encode keyboard focus in the presentation snapshot", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      readFrame: () => frame,
      reason: "dockview-active-panel",
      rendererSequence: 4,
      workspace: workspace({ hasMaximizedGroup: false }),
    });

    expect(snapshot.terminals[0]).toEqual({
      focused: false,
      frame,
      panelId: "terminal-1",
      visible: true,
    });
  });
});
