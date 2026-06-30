import { forwardTerminalTaskTabPatch } from "@main/ipc/terminal-tab-chrome.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const forwardToWindowMock = vi.hoisted(() => vi.fn());
const patchTerminalPanelTabMock = vi.hoisted(() => vi.fn());
const patchTerminalPanelTaskStatusMock = vi.hoisted(() => vi.fn());
const updateTerminalPanelTabMock = vi.hoisted(() => vi.fn());

vi.mock("@main/ipc/terminal-forwarding.ts", () => ({
  forwardToWindow: forwardToWindowMock,
}));

vi.mock("@main/ipc/terminal-window-scope.ts", () => ({
  terminalSessionScopeFor: () => "main",
}));

vi.mock("@main/state/terminal-session-state.ts", () => ({
  patchTerminalPanelTab: patchTerminalPanelTabMock,
  patchTerminalPanelTaskStatus: patchTerminalPanelTaskStatusMock,
  updateTerminalPanelTab: updateTerminalPanelTabMock,
}));

function targetWindow() {
  return {
    isDestroyed: () => false,
  } as never;
}

describe("terminal task tab chrome forwarding", () => {
  beforeEach(() => {
    forwardToWindowMock.mockReset();
    patchTerminalPanelTabMock.mockReset();
    patchTerminalPanelTaskStatusMock.mockReset();
    updateTerminalPanelTabMock.mockReset();
  });

  it("does not patch plain terminal tabs when a command-finished event is not tied to a task", async () => {
    patchTerminalPanelTaskStatusMock.mockResolvedValue(false);

    await expect(
      forwardTerminalTaskTabPatch({
        browserWindowId: 42,
        exitCode: 0,
        panelId: "terminal-1",
        targetWindow: targetWindow(),
      })
    ).resolves.toBe(false);

    expect(patchTerminalPanelTaskStatusMock).toHaveBeenCalledWith(
      "main",
      "terminal-1",
      expect.objectContaining({ exitCode: 0, status: "succeeded" })
    );
    expect(patchTerminalPanelTabMock).not.toHaveBeenCalled();
    expect(forwardToWindowMock).not.toHaveBeenCalled();
  });

  it("patches and forwards task tab state when the terminal session has task identity", async () => {
    patchTerminalPanelTaskStatusMock.mockResolvedValue(true);

    await expect(
      forwardTerminalTaskTabPatch({
        browserWindowId: 42,
        exitCode: 1,
        panelId: "task-1",
        targetWindow: targetWindow(),
      })
    ).resolves.toBe(true);

    expect(patchTerminalPanelTabMock).toHaveBeenCalledWith("main", "task-1", {
      state: {
        colorToken: "destructive",
        label: "Failed 1",
        status: "failed",
      },
    });
    expect(forwardToWindowMock).toHaveBeenCalledWith(
      42,
      "pier:terminal:tab-chrome-patch",
      {
        panelId: "task-1",
        tab: {
          state: {
            colorToken: "destructive",
            label: "Failed 1",
            status: "failed",
          },
        },
      },
      "pier-task-tab-patch"
    );
  });

  it("normalizes negative exit codes before patching task chrome", async () => {
    patchTerminalPanelTaskStatusMock.mockResolvedValue(true);

    await expect(
      forwardTerminalTaskTabPatch({
        browserWindowId: 42,
        exitCode: -1,
        panelId: "task-1",
        targetWindow: targetWindow(),
      })
    ).resolves.toBe(true);

    expect(patchTerminalPanelTaskStatusMock).toHaveBeenCalledWith(
      "main",
      "task-1",
      expect.objectContaining({ exitCode: 1, status: "failed" })
    );
    expect(patchTerminalPanelTabMock).toHaveBeenCalledWith(
      "main",
      "task-1",
      expect.objectContaining({
        state: expect.objectContaining({ label: "Failed 1" }),
      })
    );
  });
});
