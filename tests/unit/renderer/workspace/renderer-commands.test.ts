import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeCurrentWindowMock = vi.hoisted(() => vi.fn(async () => undefined));
const showAppConfirmMock = vi.hoisted(() => vi.fn(async () => true));
const openFilesDiskPathForCommandMock = vi.hoisted(() => vi.fn());
const openGitChangesPanelHostMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: closeCurrentWindowMock,
}));

vi.mock("@/lib/comments/open-git-changes.ts", () => ({
  openGitChangesPanelHost: openGitChangesPanelHostMock,
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppConfirm: showAppConfirmMock,
}));

vi.mock("@/lib/files/open-disk-file-panel.ts", () => ({
  openFilesDiskPathForCommand: openFilesDiskPathForCommandMock,
}));

import { runWorkspaceRendererCommand } from "@/components/workspace/renderer-commands.ts";
import {
  releaseWorkspaceBootstrapGate,
  resetPanelTransferRuntimeForTests,
  setWorkspaceBootstrapGate,
} from "@/components/workspace/transfer/runtime.ts";
import {
  confirmTerminalLaunch,
  rejectTerminalLaunch,
  resetTerminalLaunchConfirmationsForTest,
} from "@/lib/workspace/terminal-launch-confirmation.ts";
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
    showAppConfirmMock.mockReset();
    showAppConfirmMock.mockResolvedValue(true);
    openFilesDiskPathForCommandMock.mockReset();
    openGitChangesPanelHostMock.mockReset();
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
    resetTerminalLaunchConfirmationsForTest();
    resetPanelTransferRuntimeForTests();
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

  it("git.openReviewPanel opens the changes panel and resolves its panelId", async () => {
    const context = {
      contextId: "ctx-1",
      cwd: "/repo",
      gitRoot: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
      worktreeKey: "/repo",
    };
    openGitChangesPanelHostMock.mockReturnValue({
      ok: true,
      panelId: "pier.git.changes:ctx-1:uncommitted",
    });

    await runWorkspaceRendererCommand({
      command: { context, type: "git.openReviewPanel" },
      requestId: "renderer-open-review",
    });

    expect(openGitChangesPanelHostMock).toHaveBeenCalledWith({ context });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: { panelId: "pier.git.changes:ctx-1:uncommitted" },
      ok: true,
      requestId: "renderer-open-review",
    });
  });

  it("git.openReviewPanel fails when the changes panel is unavailable", async () => {
    const context = {
      contextId: "ctx-1",
      cwd: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
    };
    openGitChangesPanelHostMock.mockReturnValue({ ok: false, panelId: null });

    await runWorkspaceRendererCommand({
      command: { context, type: "git.openReviewPanel" },
      requestId: "renderer-open-review-unavailable",
    });

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "platform_unavailable",
        message: "git changes panel is unavailable in this window",
      },
      ok: false,
      requestId: "renderer-open-review-unavailable",
    });
  });

  it("closes the last panel by closing the window without removing the panel", async () => {
    closeCurrentWindowMock.mockRejectedValueOnce(new Error("close failed"));
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal]);
    useWorkspaceStore.getState().setApi(api as never);

    await runWorkspaceRendererCommand({
      command: { panelId: "terminal-1", type: "panel.close" },
      requestId: "renderer-close-last-failed",
    });

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(closeCurrentWindowMock).toHaveBeenCalledOnce();
    expect(api.removePanel).not.toHaveBeenCalled();
    // 关窗失败只记日志，不把 panel.close 命令打成失败（避免 renderer 命令卡死）。
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: null,
      ok: true,
      requestId: "renderer-close-last-failed",
    });
  });

  it("resolves terminal.open only after native terminal creation is confirmed", async () => {
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal]);
    useWorkspaceStore.getState().setApi(api as never);

    const command = runWorkspaceRendererCommand({
      command: {
        launchId: "launch-confirmed",
        panelId: terminal.id,
        type: "terminal.open",
      },
      requestId: "renderer-terminal-open-confirmed",
    });
    await Promise.resolve();

    expect(window.pier.rendererCommand.resolve).not.toHaveBeenCalled();
    confirmTerminalLaunch("launch-confirmed");
    await command;

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: { panelId: terminal.id },
      ok: true,
      requestId: "renderer-terminal-open-confirmed",
    });
  });

  it("rejects terminal.open when native terminal creation fails", async () => {
    const terminal = terminalPanel("terminal-1");
    const api = createApi([terminal]);
    useWorkspaceStore.getState().setApi(api as never);

    const command = runWorkspaceRendererCommand({
      command: {
        launchId: "launch-failed",
        panelId: terminal.id,
        type: "terminal.open",
      },
      requestId: "renderer-terminal-open-failed",
    });
    rejectTerminalLaunch("launch-failed", "native create failed");
    await command;

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: { message: "native create failed" },
      ok: false,
      requestId: "renderer-terminal-open-failed",
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

    const command = runWorkspaceRendererCommand({
      command: {
        launchId: "launch-target",
        targetGroupId: "source-group",
        type: "terminal.open",
      },
      requestId: "renderer-open-target-group",
    });
    confirmTerminalLaunch("launch-target");
    await command;

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

  it("rejects terminal.open when the requested panel group no longer exists", async () => {
    const api = {
      ...createApi([]),
      activeGroup: { id: "active-group", panels: [] },
      groups: [{ id: "active-group", panels: [] }],
    };
    useWorkspaceStore.getState().setApi(api as never);
    const addTerminal = vi.spyOn(useWorkspaceStore.getState(), "addTerminal");

    await runWorkspaceRendererCommand({
      command: {
        launchId: "launch-missing-group",
        targetGroupId: "removed-group",
        type: "terminal.open",
      },
      requestId: "renderer-open-missing-group",
    });

    expect(addTerminal).not.toHaveBeenCalled();
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "not_found",
        message: "panel group not found: removed-group",
      },
      ok: false,
      requestId: "renderer-open-missing-group",
    });
  });

  it("opens a split relative to referencePanelId without focusing", async () => {
    const leader = terminalPanel("leader");
    const teammate = terminalPanel("teammate");
    const api = createApi([leader, teammate]);
    useWorkspaceStore.getState().setApi(api as never);
    const addTerminal = vi
      .spyOn(useWorkspaceStore.getState(), "addTerminal")
      .mockReturnValue("terminal-split");

    const command = runWorkspaceRendererCommand({
      command: {
        focus: false,
        launchId: "launch-split-ref",
        placement: "split-below",
        referencePanelId: "teammate",
        type: "terminal.open",
      },
      requestId: "renderer-open-split-ref",
    });
    confirmTerminalLaunch("launch-split-ref");
    await command;

    expect(addTerminal).toHaveBeenCalledWith({
      focus: false,
      launchId: "launch-split-ref",
      placement: "split-below",
      referencePanelId: "teammate",
    });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: { panelId: "terminal-split" },
      ok: true,
      requestId: "renderer-open-split-ref",
    });
  });

  it("rejects terminal.open when referencePanelId is missing", async () => {
    const api = createApi([terminalPanel("leader")]);
    useWorkspaceStore.getState().setApi(api as never);
    const addTerminal = vi.spyOn(useWorkspaceStore.getState(), "addTerminal");

    await runWorkspaceRendererCommand({
      command: {
        launchId: "launch-missing-ref",
        placement: "split-below",
        referencePanelId: "gone",
        type: "terminal.open",
      },
      requestId: "renderer-open-missing-ref",
    });

    expect(addTerminal).not.toHaveBeenCalled();
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "not_found",
        message: "reference panel not found: gone",
      },
      ok: false,
      requestId: "renderer-open-missing-ref",
    });
  });

  it("cancels panel.close / files.openDisk while bootstrap gate is active", async () => {
    const terminal = terminalPanel("terminal-1");
    const welcome = webPanel("welcome-1");
    const api = createApi([terminal, welcome]);
    useWorkspaceStore.getState().setApi(api as never);
    setWorkspaceBootstrapGate(
      "9af45a46-24f2-4ac0-9371-fbe78ca295dc",
      "pending-transfer-restore"
    );

    await runWorkspaceRendererCommand({
      command: { panelId: "terminal-1", type: "panel.close" },
      requestId: "gated-close",
    });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "cancelled",
        message: "workspace bootstrap gate is active",
      },
      ok: false,
      requestId: "gated-close",
    });
    expect(api.removePanel).not.toHaveBeenCalled();

    await runWorkspaceRendererCommand({
      command: {
        path: "src/a.ts",
        root: "/tmp",
        type: "files.openDisk",
      },
      requestId: "gated-open",
    });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        code: "cancelled",
        message: "workspace bootstrap gate is active",
      },
      ok: false,
      requestId: "gated-open",
    });
    expect(api.addPanel).not.toHaveBeenCalled();

    releaseWorkspaceBootstrapGate();
  });

  it("maps files.openDisk open-failed to platform_unavailable", async () => {
    const api = createApi([terminalPanel("terminal-1")]);
    useWorkspaceStore.getState().setApi(api as never);
    openFilesDiskPathForCommandMock.mockReturnValue({
      ok: false,
      reason: "open-failed",
    });

    await runWorkspaceRendererCommand({
      command: {
        path: "src/a.ts",
        root: "/repo",
        type: "files.openDisk",
      },
      requestId: "open-disk-failed",
    });

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "platform_unavailable" }),
        ok: false,
        requestId: "open-disk-failed",
      })
    );
  });

  it("maps files.openDisk invalid-path to invalid_command", async () => {
    const api = createApi([terminalPanel("terminal-1")]);
    useWorkspaceStore.getState().setApi(api as never);
    openFilesDiskPathForCommandMock.mockReturnValue({
      ok: false,
      reason: "invalid-path",
    });

    await runWorkspaceRendererCommand({
      command: {
        path: "../escape.ts",
        root: "/repo",
        type: "files.openDisk",
      },
      requestId: "open-disk-invalid",
    });

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "invalid_command" }),
        ok: false,
        requestId: "open-disk-invalid",
      })
    );
  });

  it("refuses panelTransfer.* commands that bypass the transfer listener", async () => {
    await runWorkspaceRendererCommand({
      command: {
        sourcePanelId: "welcome-1",
        transferId: "9af45a46-24f2-4ac0-9371-fbe78ca295dc",
        type: "panelTransfer.prepareSource",
      },
      requestId: "panel-transfer-bypass",
    });

    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      error: {
        message:
          "panelTransfer.prepareSource must be routed by the panel-transfer listener",
      },
      ok: false,
      requestId: "panel-transfer-bypass",
    });
  });

  it("resizes a split via panel.setSize without addPanel", async () => {
    const resizeView = vi.fn();
    const addPanel = vi.fn();
    const root = {
      children: [{ panelIds: ["p1"] }, { panelIds: ["p2"] }],
      orientation: "HORIZONTAL",
      splitview: {
        contentSize: 1000,
        distributeViewSizes: vi.fn(),
        getViewSize: (index: number) => (index === 0 ? 200 : 800),
        resizeView,
      },
    };
    const api = {
      addPanel,
      component: { gridview: { root } },
      panels: [{ id: "p1" }, { id: "p2" }],
    };
    useWorkspaceStore.getState().setApi(api as never);

    await runWorkspaceRendererCommand({
      command: {
        panelId: "p1",
        type: "panel.setSize",
        widthRatio: 0.3,
      },
      requestId: "set-size-1",
    });

    expect(resizeView).toHaveBeenCalledWith(0, 300);
    expect(addPanel).not.toHaveBeenCalled();
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: { panelId: "p1" },
      ok: true,
      requestId: "set-size-1",
    });
  });

  it("confirms a canvas command and resolves true", async () => {
    showAppConfirmMock.mockResolvedValueOnce(true);
    await runWorkspaceRendererCommand({
      command: {
        command: "echo hello",
        intent: "default",
        type: "dialog.confirm",
      },
      requestId: "canvas-confirm-1",
    });
    expect(showAppConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "default",
      })
    );
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: true,
      ok: true,
      requestId: "canvas-confirm-1",
    });
  });

  it("resolves false when the canvas command confirm is declined", async () => {
    showAppConfirmMock.mockResolvedValueOnce(false);
    await runWorkspaceRendererCommand({
      command: {
        command: "echo hello",
        intent: "default",
        type: "dialog.confirm",
      },
      requestId: "canvas-confirm-2",
    });
    expect(window.pier.rendererCommand.resolve).toHaveBeenCalledWith({
      data: false,
      ok: true,
      requestId: "canvas-confirm-2",
    });
  });
});
