import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalChildExitedInject } from "@/panel-kits/terminal/hooks/use-child-exited-inject.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  resetTerminalEndStateStoreForTests,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/i18n/use-t.ts", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { toast } from "sonner";

type ChildExitedHandler = (event: {
  endReason?: "exited" | "stopped";
  exitCode: number;
  generation?: number;
  lifecycleId: string;
  panelId: string;
  runtimeMs: number;
}) => void;

describe("useTerminalChildExitedInject", () => {
  const listeners: ChildExitedHandler[] = [];
  const injectDisplayText = vi.fn();

  beforeEach(() => {
    listeners.length = 0;
    injectDisplayText.mockReset();
    vi.mocked(toast.error).mockReset();
    resetTerminalEndStateStoreForTests();
    useForegroundActivityStore.setState({
      activities: {
        "terminal-child": {
          agentId: "claude",
          kind: "agent",
          panelId: "terminal-child",
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
    useWorkspaceStore.setState({
      api: {
        panels: [{ id: "terminal-child" }, { id: "terminal-parent" }],
      } as never,
    });
    vi.stubGlobal("pier", {
      terminal: {
        injectDisplayText,
        onChildExited: vi.fn((cb: ChildExitedHandler) => {
          listeners.push(cb);
          return () => {
            const i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
          };
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTerminalEndStateStoreForTests();
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  });

  it("toasts when inject fails on a panel that is still open", async () => {
    injectDisplayText.mockResolvedValue({
      error: "inject failed",
      ok: false,
    });
    renderHook(() =>
      useTerminalChildExitedInject("terminal-child", undefined, {
        agentIdHint: "claude",
      })
    );

    await act(async () => {
      listeners[0]?.({
        endReason: "exited",
        exitCode: 0,
        generation: 1,
        lifecycleId: "child-life",
        panelId: "terminal-child",
        runtimeMs: 12,
      });
      await Promise.resolve();
    });

    expect(
      useTerminalEndStateStore.getState().ends["terminal-child"]
    ).toBeDefined();
    expect(toast.error).toHaveBeenCalledWith(
      "terminal.ghosttyHost.injectExitFailed"
    );
  });

  it("does not toast a closing-tab inject error after the panel is gone", async () => {
    injectDisplayText.mockResolvedValue({
      error: "terminal closing",
      ok: false,
    });
    useWorkspaceStore.setState({
      api: { panels: [{ id: "terminal-parent" }] } as never,
    });
    renderHook(() =>
      useTerminalChildExitedInject("terminal-child", undefined, {
        agentIdHint: "claude",
      })
    );

    await act(async () => {
      listeners[0]?.({
        endReason: "exited",
        exitCode: 0,
        generation: 1,
        lifecycleId: "child-life",
        panelId: "terminal-child",
        runtimeMs: 12,
      });
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not toast a write failure after the tab is already gone", async () => {
    injectDisplayText.mockResolvedValue({
      error: "inject failed",
      ok: false,
    });
    useWorkspaceStore.setState({
      api: { panels: [{ id: "terminal-parent" }] } as never,
    });
    renderHook(() =>
      useTerminalChildExitedInject("terminal-child", undefined, {
        agentIdHint: "claude",
      })
    );

    await act(async () => {
      listeners[0]?.({
        endReason: "exited",
        exitCode: 0,
        generation: 1,
        lifecycleId: "child-life",
        panelId: "terminal-child",
        runtimeMs: 12,
      });
      await Promise.resolve();
    });

    expect(toast.error).not.toHaveBeenCalled();
  });
});
