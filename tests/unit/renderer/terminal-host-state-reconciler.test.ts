import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastTerminalHostSnapshot,
  resetTerminalHostStateForTests,
  updateTerminalHostInputFacts,
  updateTerminalHostPresentationFacts,
} from "@/lib/workspace/terminal-host-state-reconciler.ts";

const terminalEntry = {
  frame: { height: 100, width: 200, x: 10, y: 20 },
  panelId: "terminal-1",
  visible: true,
};

describe("terminal host state reconciler", () => {
  const applyHostSnapshot = vi.fn();

  beforeEach(() => {
    resetTerminalHostStateForTests();
    applyHostSnapshot.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { applyHostSnapshot },
      },
    });
  });

  it("publishes terminal input intent immediately as a complete pending snapshot", () => {
    const snapshot = updateTerminalHostInputFacts(
      {
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        focusDisabledPanelIds: [],
        webOverlayRects: [],
        webRequestCount: 0,
      },
      "input-routing"
    );

    expect(snapshot).toMatchObject({
      activePanelId: "terminal-1",
      activeTerminalPanelId: "terminal-1",
      basePanel: { kind: "terminal", panelId: "terminal-1" },
      rendererSequence: 1,
      terminals: [{ frame: null, panelId: "terminal-1", visible: false }],
    });
    expect(applyHostSnapshot).toHaveBeenLastCalledWith(snapshot);
  });

  it("merges presentation geometry with the latest input facts", () => {
    updateTerminalHostInputFacts(
      {
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        focusDisabledPanelIds: [],
        webOverlayRects: [],
        webRequestCount: 0,
      },
      "input-routing"
    );

    const snapshot = updateTerminalHostPresentationFacts({
      activePanelId: "terminal-1",
      activeTerminalPanelId: "terminal-1",
      hasMaximizedGroup: false,
      reason: "dockview-layout",
      terminals: [terminalEntry],
    });

    expect(snapshot).toMatchObject({
      basePanel: { kind: "terminal", panelId: "terminal-1" },
      rendererSequence: 2,
      terminals: [terminalEntry],
      webOverlayRects: [],
      webRequestCount: 0,
    });
    expect(getLastTerminalHostSnapshot()).toEqual(snapshot);
  });

  it("publishes overlay changes without losing presentation geometry", () => {
    updateTerminalHostPresentationFacts({
      activePanelId: "terminal-1",
      activeTerminalPanelId: "terminal-1",
      hasMaximizedGroup: false,
      reason: "dockview-layout",
      terminals: [terminalEntry],
    });

    const snapshot = updateTerminalHostInputFacts(
      {
        basePanel: { kind: "terminal", panelId: "terminal-1" },
        focusDisabledPanelIds: [],
        webOverlayRects: [
          {
            frame: { height: 30, width: 80, x: 0, y: 0 },
            id: "search",
          },
        ],
        webRequestCount: 1,
      },
      "input-routing"
    );

    expect(snapshot.terminals).toEqual([terminalEntry]);
    expect(snapshot.webOverlayRects).toHaveLength(1);
    expect(snapshot.webRequestCount).toBe(1);
  });

  it("uses explicit Web input facts even when presentation still names a terminal", () => {
    updateTerminalHostPresentationFacts({
      activePanelId: "terminal-1",
      activeTerminalPanelId: "terminal-1",
      hasMaximizedGroup: false,
      reason: "dockview-layout",
      terminals: [terminalEntry],
    });

    const snapshot = updateTerminalHostInputFacts(
      {
        basePanel: { kind: "web" },
        focusDisabledPanelIds: [],
        webOverlayRects: [],
        webRequestCount: 0,
      },
      "input-routing"
    );

    expect(snapshot.basePanel).toEqual({ kind: "web" });
    expect(snapshot.activeTerminalPanelId).toBeNull();
  });
});
