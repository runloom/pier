import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";

function fakeWin(id: number): AppWindow {
  return {
    id,
    appView: null,
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: () => Buffer.from(`handle-${id}`),
    host: {} as AppWindow["host"],
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
    moveTop: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    webContents: {} as AppWindow["webContents"],
  };
}

const transferSession = vi.fn();
const rollbackSession = vi.fn();
const getTransferSession = vi.fn();

vi.mock("../../../src/main/state/terminal-session-transfer.ts", () => ({
  getTransferSession: (...args: unknown[]) => getTransferSession(...args),
  rollbackTransferPanelOwnership: (...args: unknown[]) =>
    rollbackSession(...args),
  transferPanelOwnership: (...args: unknown[]) => transferSession(...args),
}));

describe("TerminalPanelTransfer", () => {
  beforeEach(() => {
    vi.resetModules();
    transferSession.mockReset();
    rollbackSession.mockReset();
    getTransferSession.mockReset();
    getTransferSession.mockResolvedValue(null);
    transferSession.mockResolvedValue({
      panelId: "panel-1",
      sourceRecordId: "source-record",
      targetRecordId: "target-record",
    });
    rollbackSession.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    const { clearAllTerminalHookOwnerAliases } = await import(
      "../../../src/main/services/panel-transfer/terminal-hook-owner-routing.ts"
    );
    clearAllTerminalHookOwnerAliases();
  });

  async function load() {
    const routing = await import(
      "../../../src/main/services/panel-transfer/terminal-hook-owner-routing.ts"
    );
    routing.clearAllTerminalHookOwnerAliases();
    const { createTerminalPanelTransfer } = await import(
      "../../../src/main/services/panel-transfer/terminal-panel-transfer.ts"
    );
    return { createTerminalPanelTransfer, resolveOwner: routing.resolveOwner };
  }

  function baseDeps(args: {
    createTerminalPanelTransfer: typeof import("../../../src/main/services/panel-transfer/terminal-panel-transfer.ts").createTerminalPanelTransfer;
    moveTerminal?: ReturnType<typeof vi.fn>;
    sourceWin: AppWindow;
    targetWin: AppWindow;
    lifecycleId?: string;
  }) {
    const moveTerminal = args.moveTerminal ?? vi.fn(() => true);
    const moveOwner = vi.fn();
    const moveNativeKey = vi.fn(() => ({ ok: true as const }));
    const moveTaskOwner = vi.fn();
    const transferScopes = vi.fn();
    const surfaceWillClose = vi.fn();
    const surfaceCreated = vi.fn();
    const lifecycleId = args.lifecycleId ?? "";
    const transfer = args.createTerminalPanelTransfer({
      focusCoordinator: { surfaceCreated, surfaceWillClose } as never,
      foreground: {
        runSerial: async (op) => await op(),
        transferScopes,
      },
      getAddon: () => ({ moveTerminal }) as never,
      getTaskLifecycle: () =>
        ({
          getCurrentLifecycleId: () => lifecycleId,
          moveOwner,
        }) as never,
      getTaskOutputBindings: () => ({ moveNativeKey }) as never,
      getTaskService: () =>
        ({ moveRunningOwnerWindow: moveTaskOwner }) as never,
      resolveWindow: (runtimeWindowId) => {
        if (runtimeWindowId === "source") {
          return { recordId: "source-record", win: args.sourceWin };
        }
        if (runtimeWindowId === "target") {
          return { recordId: "target-record", win: args.targetWin };
        }
        return null;
      },
    });
    return {
      moveNativeKey,
      moveOwner,
      moveTaskOwner,
      moveTerminal,
      surfaceCreated,
      surfaceWillClose,
      transfer,
      transferScopes,
    };
  }

  it("changes only scoped native keys while raw panelId/lifecycle stay stable", async () => {
    const { createTerminalPanelTransfer, resolveOwner } = await load();
    const sourceWin = fakeWin(11);
    const targetWin = fakeWin(22);
    const {
      moveOwner,
      moveTaskOwner,
      moveTerminal,
      surfaceCreated,
      surfaceWillClose,
      transfer,
    } = baseDeps({
      createTerminalPanelTransfer,
      lifecycleId: "run-1",
      sourceWin,
      targetWin,
    });

    await transfer.stageLease({
      lifecycleId: "run-1",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-1",
    });
    await transfer.commitMove({
      lifecycleId: "run-1",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-1",
    });

    expect(moveTerminal.mock.calls[0]?.[0]).toMatchObject({
      fromNativePanelId: "11::panel-1",
      toNativePanelId: "22::panel-1",
      toBrowserWindowId: 22,
    });
    expect(transferSession).toHaveBeenCalledWith({
      expectedLifecycleId: "run-1",
      panelId: "panel-1",
      sourceRecordId: "source-record",
      targetRecordId: "target-record",
    });
    expect(moveOwner).toHaveBeenCalledWith({
      lifecycleId: "run-1",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
    });
    expect(moveTaskOwner).toHaveBeenCalledWith({
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
    });
    expect(resolveOwner("11", "panel-1")).toEqual({
      panelId: "panel-1",
      windowId: "22",
    });
    expect(surfaceWillClose).toHaveBeenCalledWith(sourceWin, "panel-1");
    expect(surfaceCreated).toHaveBeenCalledWith(targetWin, "panel-1");
  });

  it("source close lease is idempotent and target adopts without recreate", async () => {
    const { createTerminalPanelTransfer } = await load();
    const { transfer } = baseDeps({
      createTerminalPanelTransfer,
      sourceWin: fakeWin(1),
      targetWin: fakeWin(2),
    });

    await transfer.stageLease({
      lifecycleId: "",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-2",
    });
    expect(transfer.acknowledgeSourceCloseIdempotent("source", "panel-1")).toBe(
      true
    );
    expect(transfer.shouldSkipTargetCreate("target", "panel-1")).toBe(true);

    await transfer.commitMove({
      lifecycleId: "",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-2",
    });
    expect(transfer.shouldAdoptMovedSurface("target", "panel-1")).toBe(true);
    expect(transfer.shouldSkipTargetCreate("target", "panel-1")).toBe(false);
  });

  it("reverses completed substeps on pre-commit failure", async () => {
    const { createTerminalPanelTransfer } = await load();
    const moveTerminal = vi.fn(() => true);
    transferSession.mockRejectedValueOnce(new Error("session cas failed"));
    const { transfer } = baseDeps({
      createTerminalPanelTransfer,
      moveTerminal,
      sourceWin: fakeWin(3),
      targetWin: fakeWin(4),
    });

    await transfer.stageLease({
      lifecycleId: "",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-3",
    });
    await expect(
      transfer.commitMove({
        lifecycleId: "",
        panelId: "panel-1",
        sourceWindowId: "source",
        targetWindowId: "target",
        transferId: "t-3",
      })
    ).rejects.toThrow("session cas failed");

    expect(moveTerminal).toHaveBeenCalledTimes(2);
    expect(moveTerminal.mock.calls[1]?.[0]).toMatchObject({
      fromNativePanelId: "4::panel-1",
      toNativePanelId: "3::panel-1",
      toBrowserWindowId: 3,
    });
    expect(transfer.isPanelLeased("source", "panel-1")).toBe(false);
  });

  it("rollback after commitMove still reverses before journal commit point", async () => {
    const { createTerminalPanelTransfer, resolveOwner } = await load();
    const moveTerminal = vi.fn(() => true);
    const { transfer } = baseDeps({
      createTerminalPanelTransfer,
      moveTerminal,
      sourceWin: fakeWin(5),
      targetWin: fakeWin(6),
    });

    await transfer.stageLease({
      lifecycleId: "",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-4",
    });
    await transfer.commitMove({
      lifecycleId: "",
      panelId: "panel-1",
      sourceWindowId: "source",
      targetWindowId: "target",
      transferId: "t-4",
    });
    expect(resolveOwner("5", "panel-1").windowId).toBe("6");
    await transfer.rollback({ transferId: "t-4" });
    expect(moveTerminal).toHaveBeenCalledTimes(2);
    expect(moveTerminal.mock.calls[1]?.[0]).toMatchObject({
      fromNativePanelId: "6::panel-1",
      toNativePanelId: "5::panel-1",
      toBrowserWindowId: 5,
    });
    expect(rollbackSession).toHaveBeenCalledTimes(1);
    expect(resolveOwner("5", "panel-1").windowId).toBe("5");
  });
});
