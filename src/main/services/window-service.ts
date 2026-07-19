import { randomUUID } from "node:crypto";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type {
  WindowCreateOptions,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import {
  createWindowRecord,
  flushWindowRecordState,
  markWindowRecordClosed,
  markWindowRecordOpen,
  readMostRecentClosedWindowRecordId,
  readPreferredOpenWindowRecordIds,
  readWindowRecordLayout,
} from "../state/window-record-state.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import {
  type WindowBounds,
  type WindowCloseResult,
  windowManager,
} from "../windows/window-manager.ts";
import {
  armAndDetachAgentsBeforeClose,
  currentFinalizeRendererClose,
  currentFlushCriticalState,
  currentPrepareRendererClose,
  currentSettlePanelTransferBeforeClose,
  currentSignalPanelTransferClosing,
  ensureCloseHandler,
  flushAllStoresSettled,
  flushWindowBeforeClose,
  setWindowCloseHooks,
  type WindowTransitionLease,
  windowTransitionState,
} from "./window-close-preparation.ts";

export type { WindowTransitionLease } from "./window-close-preparation.ts";

export interface WindowService {
  close(windowId: string): Promise<WindowCloseResult>;
  closeAfterTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void>;
  closeOpenWindowRecord(recordId: string): Promise<void>;
  create(options?: WindowCreateOptions): Promise<WindowCreateResult>;
  createForTransfer(
    lease: WindowTransitionLease,
    input: {
      bounds: WindowBounds;
      transferId: string;
    }
  ): Promise<WindowCreateResult>;
  destroyForTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void>;
  flushOpenWindows(
    additionalCriticalFlush?: () => Promise<void>
  ): Promise<void>;
  flushWindow(windowId: string): Promise<void>;
  focus(windowId: string): void;
  list(): WindowInfo[];
  restoreMostRecentClosed(): Promise<WindowCreateResult | null>;
  restoreOpenWindows(): Promise<WindowCreateResult[]>;
  runExclusive<T>(
    operation: (lease: WindowTransitionLease) => Promise<T>
  ): Promise<T>;
}

export interface CreateWindowServiceArgs {
  finalizeRendererClose?: (
    windowId: string,
    transitionId: string,
    outcome: "abort" | "commit"
  ) => Promise<void>;
  flushCriticalState?: () => Promise<void>;
  prepareRendererClose?: (
    windowId: string,
    reason: "app-quit" | "window-close",
    transitionId: string
  ) => Promise<void>;
  reportCloseFailure?: (windowId: string, error: unknown) => Promise<void>;
  reportCloseFailureFallback?: (input: {
    closeError: unknown;
    feedbackError: unknown;
    windowId: string;
  }) => Promise<void> | void;
  runWhenPluginTransitionsIdle?: <T>(operation: () => Promise<T>) => Promise<T>;
  settlePanelTransferBeforeClose?: (
    lease: WindowTransitionLease,
    windowId: string,
    reason: "app-quit" | "window-close"
  ) => Promise<void>;
  signalPanelTransferClosing?: (
    windowId: string,
    reason: "app-quit" | "window-close"
  ) => void;
}

function assertTransitionLease(lease: WindowTransitionLease): void {
  if (windowTransitionState.activeLease !== lease) {
    throw new Error("window transition lease required");
  }
}

/** True when durable dockview layout has no remaining panels. */
export function isTransferSourceLayoutEmpty(layout: unknown): boolean {
  if (layout == null) {
    return true;
  }
  if (typeof layout !== "object") {
    return false;
  }
  if (!("panels" in layout)) {
    return true;
  }
  const panels = layout.panels;
  if (panels == null) {
    return true;
  }
  if (Array.isArray(panels)) {
    return panels.length === 0;
  }
  if (typeof panels === "object") {
    return Object.keys(panels).length === 0;
  }
  return false;
}

function nextRuntimeWindowId(): string | undefined {
  return windowManager.getAll().length === 0 ? "main" : undefined;
}

function isWindowRecordOpenInLiveWindow(recordId: string): boolean {
  return windowManager
    .getAll()
    .some((win) => findWindowContext(win)?.recordId === recordId);
}

export function createWindowService(
  args: CreateWindowServiceArgs = {}
): WindowService {
  setWindowCloseHooks({
    finalizeRendererClose:
      args.finalizeRendererClose ?? (async () => undefined),
    flushCriticalState: args.flushCriticalState ?? (async () => undefined),
    prepareRendererClose: args.prepareRendererClose ?? (async () => undefined),
    reportCloseFailure: args.reportCloseFailure ?? (async () => undefined),
    reportCloseFailureFallback:
      args.reportCloseFailureFallback ?? (() => undefined),
    settlePanelTransferBeforeClose:
      args.settlePanelTransferBeforeClose ?? (async () => undefined),
    signalPanelTransferClosing:
      args.signalPanelTransferClosing ?? (() => undefined),
  });

  const runWhenPluginTransitionsIdle =
    args.runWhenPluginTransitionsIdle ??
    (async <T>(operation: () => Promise<T>): Promise<T> => await operation());
  let transitionTail: Promise<void> = Promise.resolve();
  let quitSealed = false;

  const runWindowTransition = <T>(operation: () => Promise<T>): Promise<T> => {
    const runWithLease = async (): Promise<T> => {
      const lease: WindowTransitionLease = {
        token: Symbol("window-transition-lease"),
      };
      windowTransitionState.activeLease = lease;
      try {
        return await operation();
      } finally {
        if (windowTransitionState.activeLease === lease) {
          windowTransitionState.activeLease = null;
        }
      }
    };
    const result = transitionTail.then(runWithLease, runWithLease);
    transitionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
  setWindowCloseHooks({ runWindowTransition });
  ensureCloseHandler();

  const runExclusive = <T>(
    operation: (lease: WindowTransitionLease) => Promise<T>
  ): Promise<T> =>
    runWindowTransition(async () => {
      const lease = windowTransitionState.activeLease;
      if (!lease) {
        throw new Error("window transition lease missing");
      }
      return await operation(lease);
    });

  async function create(
    options: WindowCreateOptions = {}
  ): Promise<WindowCreateResult> {
    const mode = options.mode ?? "fresh";
    const recordId = (await createWindowRecord()).id;
    return await createFromRecord({ mode, recordId });
  }

  async function createFromRecord(options: {
    bounds?: WindowBounds;
    mode: "fresh" | "restore";
    recordId: string;
    showInactive?: boolean;
    startup?: { kind: "panel-transfer"; transferId: string };
    underLease?: boolean;
  }): Promise<WindowCreateResult> {
    const run = async (): Promise<WindowCreateResult> => {
      if (quitSealed) {
        throw new Error("window creation is sealed for app quit");
      }
      const { bounds, mode, recordId, showInactive, startup } = options;
      if (isWindowRecordOpenInLiveWindow(recordId)) {
        throw new Error(`window record already open: ${recordId}`);
      }
      const runtimeWindowId = nextRuntimeWindowId();
      const windowId = windowManager.create({
        ...(runtimeWindowId ? { id: runtimeWindowId } : {}),
        ...(bounds ? { bounds } : {}),
        mode,
        recordId,
        ...(showInactive ? { showInactive: true } : {}),
        ...(startup ? { startup } : {}),
      });
      await markWindowRecordOpen(recordId);
      return { recordId, windowId };
    };
    if (options.underLease) {
      return await run();
    }
    return await runWhenPluginTransitionsIdle(() => runWindowTransition(run));
  }

  async function createForTransfer(
    lease: WindowTransitionLease,
    input: {
      bounds: WindowBounds;
      transferId: string;
    }
  ): Promise<WindowCreateResult> {
    assertTransitionLease(lease);
    if (quitSealed) {
      throw new Error("window creation is sealed for app quit");
    }
    const recordId = (await createWindowRecord()).id;
    return await createFromRecord({
      bounds: input.bounds,
      mode: "fresh",
      recordId,
      showInactive: true,
      startup: { kind: "panel-transfer", transferId: input.transferId },
      underLease: true,
    });
  }

  async function closeAfterTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void> {
    assertTransitionLease(lease);
    const window = windowManager.get(windowId);
    if (!window || window.isDestroyed()) {
      return;
    }
    const context = findWindowContext(window);
    if (!context) {
      throw new Error(`window context missing for transfer close: ${windowId}`);
    }
    // Only last-tab sources may be destroyed. Multi-tab sources keep the window.
    const layout = await readWindowRecordLayout(context.recordId);
    if (!isTransferSourceLayoutEmpty(layout)) {
      return;
    }
    await markWindowRecordClosed(context.recordId);
    await flushWindowRecordState();
    await windowManager.destroyForTransfer(windowId, transferId);
  }

  async function destroyForTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void> {
    assertTransitionLease(lease);
    const window = windowManager.get(windowId);
    if (!window || window.isDestroyed()) {
      return;
    }
    const context = findWindowContext(window);
    if (context) {
      await markWindowRecordClosed(context.recordId);
      await flushWindowRecordState();
    }
    await windowManager.destroyForTransfer(windowId, transferId);
  }

  async function closeOpenWindowRecord(recordId: string): Promise<void> {
    if (recordId.trim().length === 0 || recordId.startsWith("pending:")) {
      return;
    }
    await markWindowRecordClosed(recordId);
    await flushWindowRecordState();
  }

  return {
    close: (windowId) => windowManager.close(windowId),
    closeAfterTransfer,
    closeOpenWindowRecord,
    create,
    createForTransfer,
    destroyForTransfer,
    flushOpenWindows: async (additionalCriticalFlush) =>
      await runWindowTransition(async () => {
        quitSealed = false;
        const windows = windowManager.list();
        for (const windowInfo of windows) {
          currentSignalPanelTransferClosing(windowInfo.id, "app-quit");
        }
        const lease = windowTransitionState.activeLease;
        if (lease) {
          await Promise.allSettled(
            windows.map((windowInfo) =>
              currentSettlePanelTransferBeforeClose(
                lease,
                windowInfo.id,
                "app-quit"
              )
            )
          );
        }
        const transitionId = `app-quit:${randomUUID()}`;
        const rendererResults = await Promise.allSettled(
          windows.map((windowInfo) =>
            currentPrepareRendererClose(windowInfo.id, "app-quit", transitionId)
          )
        );
        const failures = rendererResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        try {
          await currentFlushCriticalState();
        } catch (error) {
          failures.push(error);
        }
        if (additionalCriticalFlush) {
          try {
            await additionalCriticalFlush();
          } catch (error) {
            failures.push(error);
          }
        }
        const outcome = failures.length === 0 ? "commit" : "abort";
        const finalizeResults = await Promise.allSettled(
          windows.map((windowInfo) =>
            currentFinalizeRendererClose(windowInfo.id, transitionId, outcome)
          )
        );
        const failedFinalizeWindowIds: string[] = [];
        for (const [index, result] of finalizeResults.entries()) {
          if (result.status === "rejected") {
            failures.push(result.reason);
            const windowId = windows[index]?.id;
            if (windowId) {
              failedFinalizeWindowIds.push(windowId);
            }
          }
        }
        if (outcome === "commit" && failedFinalizeWindowIds.length > 0) {
          await Promise.allSettled(
            windows.map(({ id: windowId }) =>
              currentFinalizeRendererClose(windowId, transitionId, "abort")
            )
          );
        }
        if (failures.length > 0) {
          await flushAllStoresSettled();
          throw new AggregateError(failures, "window close preparation failed");
        }
        await Promise.allSettled(
          windows.map((windowInfo) =>
            armAndDetachAgentsBeforeClose(windowInfo.id)
          )
        );
        await flushAllStoresSettled();
        quitSealed = true;
      }),
    flushWindow: flushWindowBeforeClose,
    list: () => windowManager.list(),
    restoreMostRecentClosed: async () => {
      const recordId = await readMostRecentClosedWindowRecordId();
      if (!recordId) {
        return null;
      }
      return await createFromRecord({ mode: "restore", recordId });
    },
    restoreOpenWindows: async () => {
      const recordIds = await readPreferredOpenWindowRecordIds();
      const results: WindowCreateResult[] = [];
      for (const [index, recordId] of recordIds.entries()) {
        results.push(
          await createFromRecord({
            mode: "restore",
            recordId,
            showInactive: index > 0,
          })
        );
      }
      return results;
    },
    runExclusive,
  };
}
