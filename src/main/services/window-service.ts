import { randomUUID } from "node:crypto";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type {
  WindowCreateOptions,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import { flushPanelContextState } from "../state/panel-context-state.ts";
import { flushPluginSettings } from "../state/plugin-settings.ts";
import { flushPluginState } from "../state/plugin-state.ts";
import {
  detachAgentsForWindow,
  flushTerminalSessionState,
} from "../state/terminal-session-state.ts";
import { flushTerminalStatusBarPrefs } from "../state/terminal-status-bar-prefs.ts";
import {
  createWindowRecord,
  flushWindowRecordState,
  markWindowRecordClosed,
  markWindowRecordFocused,
  markWindowRecordOpen,
  readMostRecentClosedWindowRecordId,
  readPreferredOpenWindowRecordIds,
} from "../state/window-record-state.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import {
  type WindowCloseDecision,
  type WindowCloseResult,
  windowManager,
} from "../windows/window-manager.ts";
import { armDetaching } from "./agents/window-detaching-guard.ts";

export interface WindowService {
  close(windowId: string): Promise<WindowCloseResult>;
  create(options?: WindowCreateOptions): Promise<WindowCreateResult>;
  flushOpenWindows(
    additionalCriticalFlush?: () => Promise<void>
  ): Promise<void>;
  flushWindow(windowId: string): Promise<void>;
  focus(windowId: string): void;
  list(): WindowInfo[];
  restoreMostRecentClosed(): Promise<WindowCreateResult | null>;
  restoreOpenWindows(): Promise<WindowCreateResult[]>;
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
}

let didRegisterCloseHandler = false;
let currentFinalizeRendererClose: (
  windowId: string,
  transitionId: string,
  outcome: "abort" | "commit"
) => Promise<void> = async () => undefined;
let currentFlushCriticalState: () => Promise<void> = async () => undefined;
let currentPrepareRendererClose: (
  windowId: string,
  reason: "app-quit" | "window-close",
  transitionId: string
) => Promise<void> = async () => undefined;
let currentRunWindowTransition: <T>(operation: () => Promise<T>) => Promise<T> =
  async <T>(operation: () => Promise<T>): Promise<T> => await operation();
let currentReportCloseFailure: (
  windowId: string,
  error: unknown
) => Promise<void> = async () => undefined;
let currentReportCloseFailureFallback: NonNullable<
  CreateWindowServiceArgs["reportCloseFailureFallback"]
> = () => undefined;

async function reportCloseFailure(
  windowId: string,
  closeError: unknown
): Promise<void> {
  try {
    await currentReportCloseFailure(windowId, closeError);
  } catch (feedbackError) {
    console.error("[window-close-feedback] failed:", feedbackError);
    try {
      await currentReportCloseFailureFallback({
        closeError,
        feedbackError,
        windowId,
      });
    } catch (fallbackError) {
      console.error("[window-close-native-feedback] failed:", fallbackError);
    }
  }
}

/**
 * 并发 flush 6 个 debounced store。任何一路失败不能吞其他成功——用 allSettled
 * 保证全部尝试写盘并把 rejection 分别 log，避免旧 Promise.all 语义下靠前 fail
 * 掩盖后面的成功/失败。
 */
async function flushAllStoresSettled(): Promise<void> {
  const flushes: [string, () => Promise<void>][] = [
    ["plugin-state", flushPluginState],
    ["plugin-settings", flushPluginSettings],
    ["panel-context-state", flushPanelContextState],
    ["terminal-session-state", flushTerminalSessionState],
    ["terminal-status-bar-prefs", flushTerminalStatusBarPrefs],
    ["window-record-state", flushWindowRecordState],
  ];
  const results = await Promise.allSettled(flushes.map(([, fn]) => fn()));
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      const label = flushes[i]?.[0] ?? "unknown";
      const err = result.reason;
      console.error(
        `[${label}] flush failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
async function armAndDetachAgentsBeforeClose(windowId: string): Promise<void> {
  const window = windowManager.get(windowId);
  if (!window || window.isDestroyed()) {
    return;
  }
  const context = findWindowContext(window);
  if (!context) {
    return;
  }
  // terminal session store 键是 runtime windowId（main / w-N），不是 layout record UUID。
  const electronWindowId = context.electronWindowId ?? String(window.id);
  const sessionScope = context.windowId;
  armDetaching({ electronWindowId, recordId: sessionScope });
  await detachAgentsForWindow(sessionScope);
}

async function prepareWindowBeforeCloseCore(
  windowId: string
): Promise<WindowCloseDecision> {
  const transitionId = `window-close:${windowId}:${randomUUID()}`;
  try {
    await currentPrepareRendererClose(windowId, "window-close", transitionId);
  } catch (err) {
    await currentFinalizeRendererClose(windowId, transitionId, "abort").catch(
      (finalizeError: unknown) => {
        console.error(
          "[window-close-abort] failed:",
          finalizeError instanceof Error
            ? finalizeError.message
            : String(finalizeError)
        );
      }
    );
    console.error(
      "[window-close-prepare] failed:",
      err instanceof Error ? err.message : String(err)
    );
    await reportCloseFailure(windowId, err);
    return "veto";
  }
  try {
    await currentFlushCriticalState();
  } catch (err) {
    await currentFinalizeRendererClose(windowId, transitionId, "abort").catch(
      () => undefined
    );
    await reportCloseFailure(windowId, err);
    return "veto";
  }
  try {
    await currentFinalizeRendererClose(windowId, transitionId, "commit");
  } catch (err) {
    await currentFinalizeRendererClose(windowId, transitionId, "abort").catch(
      (finalizeError: unknown) => {
        console.error(
          "[window-close-abort-after-commit-failure] failed:",
          finalizeError instanceof Error
            ? finalizeError.message
            : String(finalizeError)
        );
      }
    );
    console.error(
      "[window-close-commit] failed:",
      err instanceof Error ? err.message : String(err)
    );
    await reportCloseFailure(windowId, err);
    return "veto";
  }
  await armAndDetachAgentsBeforeClose(windowId);
  await flushAllStoresSettled();
  return "allow";
}

async function flushWindowBeforeClose(windowId: string): Promise<void> {
  const decision = await currentRunWindowTransition(() =>
    prepareWindowBeforeCloseCore(windowId)
  );
  if (decision === "veto") {
    throw new Error(`window close preparation was vetoed: ${windowId}`);
  }
}

function ensureCloseHandler(): void {
  if (didRegisterCloseHandler) {
    return;
  }
  didRegisterCloseHandler = true;
  windowManager.onBeforeClose(({ windowId }) =>
    currentRunWindowTransition(() => prepareWindowBeforeCloseCore(windowId))
  );
  windowManager.onClose(({ recordId }) => {
    markWindowRecordClosed(recordId).catch((err) => {
      console.error("[window-record-close] failed:", err);
    });
  });
  windowManager.onFocus(({ recordId }) => {
    markWindowRecordFocused(recordId).catch((err) => {
      console.error("[window-record-focus] failed:", err);
    });
  });
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
  currentFlushCriticalState =
    args.flushCriticalState ?? (async () => undefined);
  currentFinalizeRendererClose =
    args.finalizeRendererClose ?? (async () => undefined);
  currentPrepareRendererClose =
    args.prepareRendererClose ?? (async () => undefined);
  currentReportCloseFailure =
    args.reportCloseFailure ?? (async () => undefined);
  currentReportCloseFailureFallback =
    args.reportCloseFailureFallback ?? (() => undefined);
  const runWhenPluginTransitionsIdle =
    args.runWhenPluginTransitionsIdle ??
    (async <T>(operation: () => Promise<T>): Promise<T> => await operation());
  let transitionTail: Promise<void> = Promise.resolve();
  let quitSealed = false;
  const runWindowTransition = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transitionTail.then(operation, operation);
    transitionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
  currentRunWindowTransition = runWindowTransition;
  ensureCloseHandler();

  async function create(
    options: WindowCreateOptions = {}
  ): Promise<WindowCreateResult> {
    const mode = options.mode ?? "fresh";
    const recordId = (await createWindowRecord()).id;
    return await createFromRecord({ mode, recordId });
  }

  async function createFromRecord(options: {
    mode: "fresh" | "restore";
    recordId: string;
    showInactive?: boolean;
  }): Promise<WindowCreateResult> {
    return await runWhenPluginTransitionsIdle(() =>
      runWindowTransition(async () => {
        if (quitSealed) {
          throw new Error("window creation is sealed for app quit");
        }
        const { mode, recordId, showInactive } = options;
        if (isWindowRecordOpenInLiveWindow(recordId)) {
          throw new Error(`window record already open: ${recordId}`);
        }
        const runtimeWindowId = nextRuntimeWindowId();
        const windowId = windowManager.create({
          ...(runtimeWindowId ? { id: runtimeWindowId } : {}),
          mode,
          recordId,
          ...(showInactive ? { showInactive: true } : {}),
        });
        await markWindowRecordOpen(recordId);
        return { recordId, windowId };
      })
    );
  }

  return {
    close: (windowId) => windowManager.close(windowId),
    create,
    focus: (windowId) => windowManager.focus(windowId),
    flushOpenWindows: async (additionalCriticalFlush) =>
      await runWindowTransition(async () => {
        quitSealed = false;
        const windows = windowManager.list();
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
          const recoveryResults = await Promise.allSettled(
            windows.map(({ id: windowId }) =>
              currentFinalizeRendererClose(windowId, transitionId, "abort")
            )
          );
          for (const result of recoveryResults) {
            if (result.status === "rejected") {
              failures.push(result.reason);
            }
          }
        }
        if (failures.length > 0) {
          // abort：不 arm detaching（避免永久卡住），仍 flush 既有关键状态
          await flushAllStoresSettled();
          throw new AggregateError(failures, "window close preparation failed");
        }
        // 仅在确定会销毁窗口时 arm+detach
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
  };
}
