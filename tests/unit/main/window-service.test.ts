import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let closeCallback:
    | ((payload: { recordId: string; windowId: string }) => void)
    | null = null;
  let beforeCloseCallback:
    | ((payload: { recordId: string; windowId: string }) => void)
    | null = null;
  const liveWindowContexts: Array<{ recordId: string }> = [];
  return {
    close: vi.fn(),
    create: vi.fn((options?: { recordId?: string }) => {
      liveWindowContexts.push({ recordId: options?.recordId ?? "unknown" });
      return "w-1";
    }),
    createWindowRecord: vi.fn(async () => ({ id: "record-new" })),
    flushTerminalSessionState: vi.fn(async () => undefined),
    flushWindowRecordState: vi.fn(async () => undefined),
    focus: vi.fn(),
    getCloseCallback: () => closeCallback,
    getBeforeCloseCallback: () => beforeCloseCallback,
    getAll: vi.fn(() =>
      liveWindowContexts.map((context) => ({
        isDestroyed: () => false,
        __recordId: context.recordId,
      }))
    ),
    list: vi.fn(
      (): Array<{ focused: boolean; id: string; recordId: string }> => []
    ),
    markWindowRecordClosed: vi.fn(async () => undefined),
    markWindowRecordOpen: vi.fn(async () => undefined),
    onBeforeClose: vi.fn(
      (callback: (payload: { recordId: string; windowId: string }) => void) => {
        beforeCloseCallback = callback;
      }
    ),
    onClose: vi.fn(
      (callback: (payload: { recordId: string; windowId: string }) => void) => {
        closeCallback = callback;
      }
    ),
    readMostRecentClosedWindowRecordId: vi.fn(async () => "record-closed"),
    readOpenWindowRecordIds: vi.fn(async () => ["record-open-1"]),
    resetLiveWindowCount: () => {
      liveWindowContexts.length = 0;
    },
    setLiveWindowRecords: (recordIds: string[]) => {
      liveWindowContexts.length = 0;
      liveWindowContexts.push(...recordIds.map((recordId) => ({ recordId })));
    },
  };
});

vi.mock("@main/state/window-record-state.ts", () => ({
  createWindowRecord: mocks.createWindowRecord,
  flushWindowRecordState: mocks.flushWindowRecordState,
  markWindowRecordClosed: mocks.markWindowRecordClosed,
  markWindowRecordOpen: mocks.markWindowRecordOpen,
  readMostRecentClosedWindowRecordId: mocks.readMostRecentClosedWindowRecordId,
  readOpenWindowRecordIds: mocks.readOpenWindowRecordIds,
}));

vi.mock("@main/state/terminal-session-state.ts", () => ({
  flushTerminalSessionState: mocks.flushTerminalSessionState,
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    close: mocks.close,
    create: mocks.create,
    focus: mocks.focus,
    getAll: mocks.getAll,
    list: mocks.list,
    onBeforeClose: mocks.onBeforeClose,
    onClose: mocks.onClose,
  },
}));

vi.mock("@main/windows/window-identity.ts", () => ({
  findWindowContext: (window: { __recordId?: string }) =>
    window.__recordId
      ? {
          mode: "restore",
          recordId: window.__recordId,
          sessionId: window.__recordId,
          windowId: "main",
        }
      : null,
}));

describe("WindowService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetLiveWindowCount();
  });

  it("creates Cmd+N windows from a new durable window record", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();
    const result = await service.create({ mode: "fresh" });

    expect(result).toEqual({ recordId: "record-new", windowId: "w-1" });
    expect(mocks.markWindowRecordOpen).toHaveBeenCalledWith("record-new");
    expect(mocks.create).toHaveBeenCalledWith({
      id: "main",
      mode: "fresh",
      recordId: "record-new",
    });
  });

  it("does not mark a window record open when native window creation fails", async () => {
    mocks.create.mockImplementationOnce(() => {
      throw new Error("create failed");
    });
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();

    await expect(service.create()).rejects.toThrow("create failed");
    expect(mocks.markWindowRecordOpen).not.toHaveBeenCalled();
  });

  it("rejects restoring a durable record that is already open in a live window", async () => {
    mocks.setLiveWindowRecords(["record-closed"]);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();

    await expect(service.restoreMostRecentClosed()).rejects.toThrow(
      "window record already open"
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("moves a user-closed window record to recently closed records", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService();
    mocks.getCloseCallback()?.({ recordId: "record-1", windowId: "main" });
    await Promise.resolve();

    expect(mocks.markWindowRecordClosed).toHaveBeenCalledWith("record-1");
  });

  it("restores the most recently closed window record", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();
    const result = await service.restoreMostRecentClosed();

    expect(result).toEqual({ recordId: "record-closed", windowId: "w-1" });
    expect(mocks.markWindowRecordOpen).toHaveBeenCalledWith("record-closed");
    expect(mocks.create).toHaveBeenCalledWith({
      id: "main",
      mode: "restore",
      recordId: "record-closed",
    });
  });

  it("flushes renderer layout and debounced main state before a user close completes", async () => {
    const flushRendererLayout = vi.fn(async () => undefined);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService({ flushRendererLayout });
    await mocks.getBeforeCloseCallback()?.({
      recordId: "record-1",
      windowId: "main",
    });

    expect(flushRendererLayout).toHaveBeenCalledWith("main");
    expect(mocks.flushTerminalSessionState).toHaveBeenCalled();
    expect(mocks.flushWindowRecordState).toHaveBeenCalled();
  });

  it("flushes every live window before Cmd+Q destroys windows", async () => {
    const flushRendererLayout = vi.fn(async () => undefined);
    mocks.list.mockReturnValueOnce([
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "w-1", recordId: "record-w-1" },
    ]);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService({ flushRendererLayout });
    await service.flushOpenWindows();

    expect(flushRendererLayout).toHaveBeenCalledWith("main");
    expect(flushRendererLayout).toHaveBeenCalledWith("w-1");
    expect(mocks.flushTerminalSessionState).toHaveBeenCalled();
    expect(mocks.flushWindowRecordState).toHaveBeenCalled();
  });

  it("restores the last user-closed window when the app is activated with no live windows", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();
    const result = await service.restoreMostRecentClosed();

    expect(result).toEqual({ recordId: "record-closed", windowId: "w-1" });
  });

  it("restores all open window records for Cmd+Q relaunch", async () => {
    mocks.readOpenWindowRecordIds.mockResolvedValueOnce([
      "record-open-1",
      "record-open-2",
    ]);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();
    const result = await service.restoreOpenWindows();

    expect(result).toEqual([
      { recordId: "record-open-1", windowId: "w-1" },
      { recordId: "record-open-2", windowId: "w-1" },
    ]);
    expect(mocks.create).toHaveBeenCalledWith({
      id: "main",
      mode: "restore",
      recordId: "record-open-1",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      mode: "restore",
      recordId: "record-open-2",
    });
  });
});
