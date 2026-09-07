import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalSurfaceClose } from "@/panel-kits/terminal/hooks/use-surface-close.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

describe("useTerminalSurfaceClose", () => {
  const listeners: Array<(request: { panelId: string }) => void> = [];
  const closePanel = vi.fn(async () => true);

  beforeEach(() => {
    listeners.length = 0;
    closePanel.mockClear();
    useForegroundActivityStore.setState({
      activities: {
        "terminal-osc": {
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-osc",
          source: "hook",
          spawnedAt: 1,
          status: "ready",
          subagentCount: 0,
          updatedAt: 2,
          windowId: "main",
        },
      },
      ts: 1,
    });
    useWorkspaceStore.setState({ closePanel } as never);
    vi.stubGlobal("pier", {
      terminal: {
        onSurfaceCloseRequest: vi.fn(
          (cb: (request: { panelId: string }) => void) => {
            listeners.push(cb);
            return () => {
              const i = listeners.indexOf(cb);
              if (i >= 0) listeners.splice(i, 1);
            };
          }
        ),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  });

  it("does not auto-close after FA clears for a latched OSC agent", () => {
    const { rerender } = renderHook(() =>
      useTerminalSurfaceClose("terminal-osc")
    );
    act(() => {
      useForegroundActivityStore.setState({ activities: {}, ts: 2 });
    });
    rerender();
    act(() => {
      for (const listener of listeners) {
        listener({ panelId: "terminal-osc" });
      }
    });
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("auto-closes an ordinary shell", () => {
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    renderHook(() => useTerminalSurfaceClose("terminal-shell"));
    act(() => {
      for (const listener of listeners) {
        listener({ panelId: "terminal-shell" });
      }
    });
    expect(closePanel).toHaveBeenCalledWith("terminal-shell");
  });
});
