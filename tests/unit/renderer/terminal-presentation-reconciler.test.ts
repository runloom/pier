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
    activePanelKind: "terminal",
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
      overlayActive: false,
      readFrame: () => frame,
      reason: "dockview-maximize",
      rendererSequence: 1,
      workspace: workspace({
        activePanelId: "welcome-1",
        activePanelKind: "web",
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { focused: false, frame, panelId: "terminal-1", visible: false },
      { focused: false, frame, panelId: "terminal-2", visible: false },
    ]);
  });

  it("shows and focuses only the active terminal while maximized", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      overlayActive: false,
      readFrame: (panelId) => (panelId === "terminal-1" ? frame : null),
      reason: "dockview-maximize",
      rendererSequence: 2,
      workspace: workspace({
        hasMaximizedGroup: true,
      }),
    });

    expect(snapshot.terminals).toEqual([
      { focused: true, frame, panelId: "terminal-1", visible: true },
      { focused: false, frame: null, panelId: "terminal-2", visible: false },
    ]);
  });

  it("uses dockview visibility or a real anchor frame outside maximized mode", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      overlayActive: false,
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

  it("clears terminal focus while overlay is active without hiding it", () => {
    const snapshot = buildTerminalPresentationSnapshot({
      overlayActive: true,
      readFrame: () => frame,
      reason: "overlay",
      rendererSequence: 4,
      workspace: workspace({ hasMaximizedGroup: false }),
    });

    expect(snapshot.terminals[0]).toEqual({
      focused: false,
      frame,
      panelId: "terminal-1",
      visible: true,
    });
    expect(snapshot.overlayActive).toBe(true);
  });
});
