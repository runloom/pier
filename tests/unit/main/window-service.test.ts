import { beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => {
  let closeCallback:
    | ((payload: { recordId: string; windowId: string }) => void)
    | null = null;
  let focusCallback:
    | ((payload: { recordId: string; windowId: string }) => void)
    | null = null;
  let beforeCloseCallback:
    | ((payload: {
        recordId: string;
        windowId: string;
      }) => Promise<"allow" | "veto"> | "allow" | "veto")
    | null = null;
  const liveWindowContexts: Array<{
    electronId: number;
    recordId: string;
    windowId: string;
  }> = [];
  return {
    close: vi.fn(),
    create: vi.fn(
      (options?: {
        id?: string;
        recordId?: string;
        showInactive?: boolean;
      }) => {
        liveWindowContexts.push({
          electronId: liveWindowContexts.length + 1,
          recordId: options?.recordId ?? "unknown",
          // Track the runtime id the service requested so get(windowId) works.
          windowId: options?.id ?? `w-${liveWindowContexts.length + 1}`,
        });
        // Historical mock return: service tests assert "w-1" as the create result.
        return "w-1";
      }
    ),
    destroyForTransfer: vi.fn(async () => undefined),
    createWindowRecord: vi.fn(async () => ({ id: "record-new" })),
    flushPluginSettings: vi.fn(async () => undefined),
    flushPluginState: vi.fn(async () => undefined),
    detachAgentsForWindow: vi.fn(async () => undefined),
    flushTerminalSessionState: vi.fn(async () => undefined),
    flushTerminalStatusBarPrefs: vi.fn(async () => undefined),
    flushWindowRecordState: vi.fn(async () => undefined),
    flushPanelContextState: vi.fn(async () => undefined),
    focus: vi.fn(),
    getCloseCallback: () => closeCallback,
    getFocusCallback: () => focusCallback,
    getBeforeCloseCallback: () => beforeCloseCallback,
    get: vi.fn((windowId: string) => {
      const match = liveWindowContexts.find(
        (context) => context.windowId === windowId
      );
      if (!match) {
        return;
      }
      return {
        id: match.electronId,
        isDestroyed: () => false,
        __recordId: match.recordId,
        __electronWindowId: String(match.electronId),
        __windowId: match.windowId,
      };
    }),
    getAll: vi.fn(() =>
      liveWindowContexts.map((context) => ({
        id: context.electronId,
        isDestroyed: () => false,
        __recordId: context.recordId,
        __electronWindowId: String(context.electronId),
        __windowId: context.windowId,
      }))
    ),
    list: vi.fn(
      (): Array<{ focused: boolean; id: string; recordId: string }> => []
    ),
    markWindowRecordClosed: vi.fn(async () => undefined),
    markWindowRecordFocused: vi.fn(async () => undefined),
    markWindowRecordOpen: vi.fn(async () => undefined),
    onBeforeClose: vi.fn(
      (
        callback: (payload: {
          recordId: string;
          windowId: string;
        }) => Promise<"allow" | "veto"> | "allow" | "veto"
      ) => {
        beforeCloseCallback = callback;
      }
    ),
    onClose: vi.fn(
      (callback: (payload: { recordId: string; windowId: string }) => void) => {
        closeCallback = callback;
      }
    ),
    onFocus: vi.fn(
      (callback: (payload: { recordId: string; windowId: string }) => void) => {
        focusCallback = callback;
      }
    ),
    readMostRecentClosedWindowRecordId: vi.fn(async () => "record-closed"),
    readOpenWindowRecordIds: vi.fn(async () => ["record-open-1"]),
    readPreferredOpenWindowRecordIds: vi.fn(async () => ["record-open-1"]),
    readWindowRecordLayout: vi.fn(async () => null as unknown),
    resetLiveWindowCount: () => {
      liveWindowContexts.length = 0;
    },
    setLiveWindowRecords: (recordIds: string[]) => {
      liveWindowContexts.length = 0;
      liveWindowContexts.push(
        ...recordIds.map((recordId, index) => ({
          electronId: index + 1,
          recordId,
          windowId: index === 0 ? "main" : `w-${index}`,
        }))
      );
    },
  };
});

vi.mock("@main/state/window-record-state.ts", () => ({
  createWindowRecord: mocks.createWindowRecord,
  flushWindowRecordState: mocks.flushWindowRecordState,
  markWindowRecordClosed: mocks.markWindowRecordClosed,
  markWindowRecordFocused: mocks.markWindowRecordFocused,
  markWindowRecordOpen: mocks.markWindowRecordOpen,
  readMostRecentClosedWindowRecordId: mocks.readMostRecentClosedWindowRecordId,
  readOpenWindowRecordIds: mocks.readOpenWindowRecordIds,
  readPreferredOpenWindowRecordIds: mocks.readPreferredOpenWindowRecordIds,
  readWindowRecordLayout: mocks.readWindowRecordLayout,
}));

vi.mock("@main/state/terminal-session-state.ts", () => ({
  detachAgentsForWindow: mocks.detachAgentsForWindow,
  flushTerminalSessionState: mocks.flushTerminalSessionState,
}));

vi.mock("@main/services/agents/window-detaching-guard.ts", () => ({
  armDetaching: vi.fn(),
}));

vi.mock("@main/state/plugin-state.ts", () => ({
  flushPluginState: mocks.flushPluginState,
}));

vi.mock("@main/state/plugin-settings.ts", () => ({
  flushPluginSettings: mocks.flushPluginSettings,
}));

vi.mock("@main/state/terminal-status-bar-prefs.ts", () => ({
  flushTerminalStatusBarPrefs: mocks.flushTerminalStatusBarPrefs,
}));

vi.mock("@main/state/panel-context-state.ts", () => ({
  flushPanelContextState: mocks.flushPanelContextState,
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    close: mocks.close,
    create: mocks.create,
    destroyForTransfer: mocks.destroyForTransfer,
    focus: mocks.focus,
    get: mocks.get,
    getAll: mocks.getAll,
    list: mocks.list,
    onBeforeClose: mocks.onBeforeClose,
    onClose: mocks.onClose,
    onFocus: mocks.onFocus,
  },
}));

vi.mock("@main/windows/window-identity.ts", () => ({
  findWindowContext: (window: {
    __electronWindowId?: string;
    __recordId?: string;
    __windowId?: string;
  }) =>
    window.__recordId
      ? {
          electronWindowId: window.__electronWindowId ?? "1",
          mode: "restore" as const,
          recordId: window.__recordId,
          windowId: window.__windowId ?? "main",
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

  it("creates a new window inside the plugin transition gate", async () => {
    const events: string[] = [];
    const runWhenPluginTransitionsIdle = async <T>(
      operation: () => Promise<T>
    ): Promise<T> => {
      events.push("gate-enter");
      const result = await operation();
      events.push("gate-exit");
      return result;
    };
    mocks.create.mockImplementationOnce(() => {
      events.push("window-create");
      return "w-1";
    });
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService({ runWhenPluginTransitionsIdle });
    await service.create();

    expect(events).toEqual(["gate-enter", "window-create", "gate-exit"]);
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
    const prepareRendererClose = vi.fn(async () => undefined);
    const { armDetaching } = await import(
      "@main/services/agents/window-detaching-guard.ts"
    );
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService({ prepareRendererClose });
    mocks.setLiveWindowRecords(["record-1"]);
    const decision = await mocks.getBeforeCloseCallback()?.({
      recordId: "record-1",
      windowId: "main",
    });

    expect(decision).toBe("allow");
    expect(prepareRendererClose).toHaveBeenCalledWith(
      "main",
      "window-close",
      expect.stringMatching(/^window-close:main:/)
    );
    expect(armDetaching).toHaveBeenCalledWith({
      electronWindowId: "1",
      recordId: "main",
    });
    expect(mocks.detachAgentsForWindow).toHaveBeenCalledWith("main");
    expect(mocks.flushPluginState).toHaveBeenCalled();
    expect(mocks.flushPluginSettings).toHaveBeenCalled();
    expect(mocks.flushTerminalSessionState).toHaveBeenCalled();
    expect(mocks.flushTerminalStatusBarPrefs).toHaveBeenCalled();
    expect(mocks.flushWindowRecordState).toHaveBeenCalled();
    expect(mocks.flushPanelContextState).toHaveBeenCalled();
  });

  it("flushes every live window before Cmd+Q destroys windows", async () => {
    const prepareRendererClose = vi.fn(async () => undefined);
    mocks.setLiveWindowRecords(["record-main", "record-w-1"]);
    mocks.list.mockReturnValueOnce([
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "w-1", recordId: "record-w-1" },
    ]);
    const { armDetaching } = await import(
      "@main/services/agents/window-detaching-guard.ts"
    );
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService({ prepareRendererClose });
    await service.flushOpenWindows();

    expect(prepareRendererClose).toHaveBeenCalledWith(
      "main",
      "app-quit",
      expect.stringMatching(/^app-quit:/)
    );
    expect(prepareRendererClose).toHaveBeenCalledWith(
      "w-1",
      "app-quit",
      expect.stringMatching(/^app-quit:/)
    );
    expect(armDetaching).toHaveBeenCalledWith({
      electronWindowId: "1",
      recordId: "main",
    });
    expect(armDetaching).toHaveBeenCalledWith({
      electronWindowId: "2",
      recordId: "w-1",
    });
    expect(mocks.detachAgentsForWindow).toHaveBeenCalledWith("main");
    expect(mocks.detachAgentsForWindow).toHaveBeenCalledWith("w-1");
    expect(mocks.flushPluginState).toHaveBeenCalled();
    expect(mocks.flushPluginSettings).toHaveBeenCalled();
    expect(mocks.flushTerminalSessionState).toHaveBeenCalled();
    expect(mocks.flushTerminalStatusBarPrefs).toHaveBeenCalled();
    expect(mocks.flushWindowRecordState).toHaveBeenCalled();
    expect(mocks.flushPanelContextState).toHaveBeenCalled();
  });

  it("aborts every committed renderer when one app-quit finalizer fails", async () => {
    mocks.list.mockReturnValue([
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "w-1", recordId: "record-w-1" },
    ]);
    const finalizeRendererClose = vi.fn(
      async (
        windowId: string,
        _transitionId: string,
        outcome: "abort" | "commit"
      ) => {
        if (windowId === "w-1" && outcome === "commit") {
          throw new Error("renderer commit failed");
        }
      }
    );
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    const service = createWindowService({ finalizeRendererClose });

    await expect(service.flushOpenWindows()).rejects.toThrow(
      "window close preparation failed"
    );

    expect(finalizeRendererClose).toHaveBeenCalledWith(
      "main",
      expect.stringMatching(/^app-quit:/),
      "abort"
    );
    expect(finalizeRendererClose).toHaveBeenCalledWith(
      "w-1",
      expect.stringMatching(/^app-quit:/),
      "abort"
    );
  });

  it("does not create a window after app-quit preparation has sealed the cohort", async () => {
    const gate = deferred<void>();
    mocks.list.mockReturnValue([
      { focused: true, id: "main", recordId: "record-main" },
    ]);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    const service = createWindowService({
      prepareRendererClose: async () => await gate.promise,
    });
    const quitting = service.flushOpenWindows();
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
    const creating = service.create();

    expect(mocks.create).not.toHaveBeenCalled();
    gate.resolve();
    await expect(quitting).resolves.toBeUndefined();
    await expect(creating).rejects.toThrow(
      "window creation is sealed for app quit"
    );
  });

  it("vetoes a user close when renderer preparation fails", async () => {
    const prepareRendererClose = vi.fn(async () => {
      throw new Error("draft flush failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const reportCloseFailure = vi.fn(async () => undefined);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService({ prepareRendererClose, reportCloseFailure });
    const decision = await mocks.getBeforeCloseCallback()?.({
      recordId: "record-1",
      windowId: "main",
    });

    expect(decision).toBe("veto");
    expect(mocks.flushWindowRecordState).not.toHaveBeenCalled();
    expect(reportCloseFailure).toHaveBeenCalledOnce();
    expect(reportCloseFailure).toHaveBeenCalledWith("main", expect.any(Error));
    expect(error).toHaveBeenCalledWith(
      "[window-close-prepare] failed:",
      "draft flush failed"
    );
  });

  it("falls back to native feedback when the renderer report fails", async () => {
    const prepareRendererClose = vi.fn(async () => {
      throw new Error("draft flush failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reportCloseFailure = vi.fn(async () => {
      throw new Error("renderer feedback failed");
    });
    const reportCloseFailureFallback = vi.fn();
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService({
      prepareRendererClose,
      reportCloseFailure,
      reportCloseFailureFallback,
    });
    const decision = await mocks.getBeforeCloseCallback()?.({
      recordId: "record-1",
      windowId: "main",
    });

    expect(decision).toBe("veto");
    expect(reportCloseFailureFallback).toHaveBeenCalledOnce();
    expect(reportCloseFailureFallback).toHaveBeenCalledWith({
      closeError: expect.any(Error),
      feedbackError: expect.objectContaining({
        message: "renderer feedback failed",
      }),
      windowId: "main",
    });
  });

  it("rejects app quit only after attempting every renderer and critical flush", async () => {
    const prepareRendererClose = vi.fn(async (windowId: string) => {
      if (windowId === "main") {
        throw new Error("main renderer failed");
      }
    });
    const flushCriticalState = vi.fn(async () => {
      throw new Error("draft fsync failed");
    });
    mocks.list.mockReturnValueOnce([
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "w-1", recordId: "record-w-1" },
    ]);
    const { armDetaching } = await import(
      "@main/services/agents/window-detaching-guard.ts"
    );
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    const service = createWindowService({
      flushCriticalState,
      prepareRendererClose,
    });

    await expect(service.flushOpenWindows()).rejects.toThrow(
      "window close preparation failed"
    );

    expect(prepareRendererClose).toHaveBeenCalledTimes(2);
    expect(flushCriticalState).toHaveBeenCalledOnce();
    expect(mocks.flushWindowRecordState).toHaveBeenCalledOnce();
    expect(armDetaching).not.toHaveBeenCalled();
    expect(mocks.detachAgentsForWindow).not.toHaveBeenCalled();
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
    mocks.readPreferredOpenWindowRecordIds.mockResolvedValueOnce([
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
      showInactive: true,
    });
  });

  it("restores the last focused open window in the foreground on relaunch", async () => {
    mocks.readOpenWindowRecordIds.mockResolvedValueOnce([
      "record-open-1",
      "record-focused",
    ]);
    mocks.readPreferredOpenWindowRecordIds.mockResolvedValueOnce([
      "record-focused",
      "record-open-1",
    ]);
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    const service = createWindowService();
    const result = await service.restoreOpenWindows();

    expect(result).toEqual([
      { recordId: "record-focused", windowId: "w-1" },
      { recordId: "record-open-1", windowId: "w-1" },
    ]);
    expect(mocks.create).toHaveBeenNthCalledWith(1, {
      id: "main",
      mode: "restore",
      recordId: "record-focused",
    });
    expect(mocks.create).toHaveBeenNthCalledWith(2, {
      mode: "restore",
      recordId: "record-open-1",
      showInactive: true,
    });
  });

  it("records durable window focus without changing the window lifecycle state", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );

    createWindowService();
    mocks.getFocusCallback()?.({ recordId: "record-focused", windowId: "w-2" });
    await Promise.resolve();

    expect(mocks.markWindowRecordFocused).toHaveBeenCalledWith(
      "record-focused"
    );
    expect(mocks.markWindowRecordOpen).not.toHaveBeenCalledWith(
      "record-focused"
    );
    expect(mocks.markWindowRecordClosed).not.toHaveBeenCalledWith(
      "record-focused"
    );
  });

  it("runExclusive provides a transition lease", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    const service = createWindowService();
    const seen: symbol[] = [];
    await service.runExclusive(async (lease) => {
      seen.push(lease.token);
      return "ok";
    });
    expect(seen).toHaveLength(1);
  });

  it("createForTransfer and closeAfterTransfer require the active lease", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    mocks.create.mockImplementationOnce(() => "w-transfer");
    // ensure destroyForTransfer exists on mock
    const service = createWindowService();
    const fakeLease = { token: Symbol("foreign") };
    await expect(
      service.createForTransfer(fakeLease, {
        bounds: { height: 800, width: 1200, x: 10, y: 10 },
        transferId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })
    ).rejects.toThrow(/lease required/);

    await service.runExclusive(async (lease) => {
      const created = await service.createForTransfer(lease, {
        bounds: { height: 800, width: 1200, x: 10, y: 10 },
        transferId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      expect(created.windowId).toBeTruthy();
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          showInactive: true,
          startup: {
            kind: "panel-transfer",
            transferId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        })
      );
    });
  });

  it("closeAfterTransfer no-ops when source layout still has panels", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    mocks.setLiveWindowRecords(["record-source"]);
    mocks.readWindowRecordLayout.mockResolvedValueOnce({
      panels: { "panel-keep": { id: "panel-keep" } },
    });
    const service = createWindowService();
    await service.runExclusive(async (lease) => {
      await service.closeAfterTransfer(
        lease,
        "main",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      );
    });
    expect(mocks.markWindowRecordClosed).not.toHaveBeenCalled();
    expect(mocks.destroyForTransfer).not.toHaveBeenCalled();
  });

  it("closeAfterTransfer destroys only when source layout is empty", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    mocks.setLiveWindowRecords(["record-source"]);
    mocks.readWindowRecordLayout.mockResolvedValueOnce({ panels: {} });
    const service = createWindowService();
    await service.runExclusive(async (lease) => {
      await service.closeAfterTransfer(
        lease,
        "main",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      );
    });
    expect(mocks.markWindowRecordClosed).toHaveBeenCalledWith("record-source");
    expect(mocks.destroyForTransfer).toHaveBeenCalledWith(
      "main",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );
  });

  it("closeOpenWindowRecord marks record closed and flushes without lease", async () => {
    const { createWindowService } = await import(
      "@main/services/window-service.ts"
    );
    const service = createWindowService();
    await service.closeOpenWindowRecord("record-orphan-internal");
    expect(mocks.markWindowRecordClosed).toHaveBeenCalledWith(
      "record-orphan-internal"
    );
    expect(mocks.flushWindowRecordState).toHaveBeenCalled();
    expect(mocks.destroyForTransfer).not.toHaveBeenCalled();

    await service.closeOpenWindowRecord("pending:transfer-id");
    expect(mocks.markWindowRecordClosed).toHaveBeenCalledTimes(1);
  });
});
