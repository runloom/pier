import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

import { runWorkspaceRendererCommand } from "@/components/workspace/workspace-renderer-commands.ts";
import {
  requestTerminalRelaunch,
  useTerminalRelaunchRequest,
} from "@/stores/terminal-relaunch.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function webPanel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Welcome",
    view: { contentComponent: "welcome" },
  };
}

function createApi(panels: ReturnType<typeof terminalPanel>[]) {
  return {
    activeGroup: { panels },
    activePanel: panels[0] ?? null,
    groups: [{ panels }],
    addPanel: vi.fn(),
    panels,
    removePanel: vi.fn(),
    totalPanels: panels.length,
  };
}

describe("workspace renderer commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    closeCurrentWindowMock.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        getWindowContext: vi.fn(async () => ({
          mode: "restore",
          recordId: "record-current",
          sessionId: "record-current",
          windowId: "main",
        })),
        rendererCommand: { resolve: vi.fn() },
        terminal: { close: vi.fn(async () => undefined) },
        workspace: { clearLayout: vi.fn(async () => undefined) },
      },
    });
    useWorkspaceStore.getState().setApi(null);
  });

  it("closes an existing panel and resolves the renderer command", async () => {
    const terminal = terminalPanel("terminal-1");
    const welcome = webPanel("welcome-1");
    const api = createApi([terminal, welcome]);
    useWorkspaceStore.getState().setApi(api as never);

    await runWorkspaceRendererCommand({
      command: { panelId: "terminal-1", type: "panel.close" },
      requestId: "renderer-close-existing",
    });

    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: null,
      ok: true,
      requestId: "renderer-close-existing",
    });
  });

  it("tolerates a missing terminal close API and clears a relaunch request when closing through a renderer command", async () => {
    const terminal = terminalPanel("terminal-missing-close");
    const welcome = webPanel("welcome-1");
    const api = createApi([terminal, welcome]);
    const relaunch = renderHook(() => useTerminalRelaunchRequest(terminal.id));
    useWorkspaceStore.getState().setApi(api as never);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...window.pier,
        terminal: {},
      },
    });

    act(() => {
      requestTerminalRelaunch({
        launchId: "launch-pending",
        panelId: terminal.id,
      });
    });
    expect(relaunch.result.current?.launchId).toBe("launch-pending");

    await act(async () => {
      await runWorkspaceRendererCommand({
        command: { panelId: terminal.id, type: "panel.close" },
        requestId: "renderer-close-missing-terminal-api",
      });
    });

    expect(api.removePanel).toHaveBeenCalledWith(terminal);
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: null,
      ok: true,
      requestId: "renderer-close-missing-terminal-api",
    });
    expect(relaunch.result.current).toBeNull();
  });

  it("returns not_found when closing a missing panel", async () => {
    const api = createApi([webPanel("welcome-1")]);
    useWorkspaceStore.getState().setApi(api as never);

    await runWorkspaceRendererCommand({
      command: { panelId: "missing", type: "panel.close" },
      requestId: "renderer-close-missing",
    });

    expect(api.removePanel).not.toHaveBeenCalled();
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "not_found",
        message: "panel not found: missing",
      },
      ok: false,
      requestId: "renderer-close-missing",
    });
  });

  it("returns a renderer error when closing the last panel fails", async () => {
    closeCurrentWindowMock.mockRejectedValueOnce(new Error("close failed"));
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal]);
    useWorkspaceStore.getState().setApi(api as never);

    await runWorkspaceRendererCommand({
      command: { panelId: "terminal-1", type: "panel.close" },
      requestId: "renderer-close-last-failed",
    });

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).not.toHaveBeenCalled();
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        message: "close failed",
      },
      ok: false,
      requestId: "renderer-close-last-failed",
    });
  });

  it("opens a new terminal in the requested panel group", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const activeGroup = { id: "active-group", panels: [] };
    const api = {
      ...createApi([]),
      activeGroup,
      groups: [sourceGroup, activeGroup],
    };
    useWorkspaceStore.getState().setApi(api as never);
    const addTerminal = vi
      .spyOn(useWorkspaceStore.getState(), "addTerminal")
      .mockReturnValue("terminal-target");

    await runWorkspaceRendererCommand({
      command: {
        launchId: "launch-target",
        targetGroupId: "source-group",
        type: "terminal.open",
      },
      requestId: "renderer-open-target-group",
    });

    expect(addTerminal).toHaveBeenCalledWith({
      launchId: "launch-target",
      referenceGroup: sourceGroup,
    });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: { panelId: "terminal-target" },
      ok: true,
      requestId: "renderer-open-target-group",
    });
  });
});
