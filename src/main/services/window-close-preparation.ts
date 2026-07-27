import { randomUUID } from "node:crypto";
import { createLogger } from "@shared/logger.ts";
import { flushPanelContextState } from "../state/panel-context-state.ts";
import { flushPluginSettings } from "../state/plugin-settings.ts";
import { flushPluginState } from "../state/plugin-state.ts";
import {
  detachAgentsForWindow,
  flushTerminalSessionState,
} from "../state/terminal-session-state.ts";
import { flushTerminalStatusBarPrefs } from "../state/terminal-status-bar-prefs.ts";
import {
  flushWindowRecordState,
  markWindowRecordClosed,
  markWindowRecordFocused,
} from "../state/window-record-state.ts";
import {
  isRendererUnreachableCloseError,
  type NativeWindowCloseFailureDecision,
} from "../windows/native-window-close-failure.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import {
  type WindowCloseDecision,
  windowManager,
} from "../windows/window-manager.ts";
import { armDetaching } from "./agents/window-detaching-guard.ts";

export interface WindowTransitionLease {
  readonly token: symbol;
}

export const windowTransitionState: {
  activeLease: WindowTransitionLease | null;
} = {
  activeLease: null,
};

const log = createLogger("window.close");

/** Windows that already failed prepare once — next close offers force path faster. */
const forceCloseCandidates = new Set<string>();

export let currentFinalizeRendererClose: (
  windowId: string,
  transitionId: string,
  outcome: "abort" | "commit"
) => Promise<void> = async () => undefined;
export let currentFlushCriticalState: () => Promise<void> = async () =>
  undefined;
export let currentPrepareRendererClose: (
  windowId: string,
  reason: "app-quit" | "window-close",
  transitionId: string
) => Promise<void> = async () => undefined;
export let currentRunWindowTransition: <T>(
  operation: () => Promise<T>
) => Promise<T> = async <T>(operation: () => Promise<T>): Promise<T> =>
  await operation();
export let currentReportCloseFailure: (
  windowId: string,
  error: unknown
) => Promise<void> = async () => undefined;
export let currentReportCloseFailureFallback: (input: {
  closeError: unknown;
  feedbackError: unknown;
  windowId: string;
}) =>
  | Promise<NativeWindowCloseFailureDecision | undefined>
  | NativeWindowCloseFailureDecision
  | undefined = () => undefined;
export let currentSettlePanelTransferBeforeClose: (
  lease: WindowTransitionLease,
  windowId: string,
  reason: "app-quit" | "window-close"
) => Promise<void> = async () => undefined;
export let currentSignalPanelTransferClosing: (
  windowId: string,
  reason: "app-quit" | "window-close"
) => void = () => undefined;

let didRegisterCloseHandler = false;

export function setWindowCloseHooks(hooks: {
  finalizeRendererClose?: typeof currentFinalizeRendererClose;
  flushCriticalState?: typeof currentFlushCriticalState;
  prepareRendererClose?: typeof currentPrepareRendererClose;
  reportCloseFailure?: typeof currentReportCloseFailure;
  reportCloseFailureFallback?: typeof currentReportCloseFailureFallback;
  runWindowTransition?: typeof currentRunWindowTransition;
  settlePanelTransferBeforeClose?: typeof currentSettlePanelTransferBeforeClose;
  signalPanelTransferClosing?: typeof currentSignalPanelTransferClosing;
}): void {
  if (hooks.finalizeRendererClose) {
    currentFinalizeRendererClose = hooks.finalizeRendererClose;
  }
  if (hooks.flushCriticalState) {
    currentFlushCriticalState = hooks.flushCriticalState;
  }
  if (hooks.prepareRendererClose) {
    currentPrepareRendererClose = hooks.prepareRendererClose;
  }
  if (hooks.reportCloseFailure) {
    currentReportCloseFailure = hooks.reportCloseFailure;
  }
  if (hooks.reportCloseFailureFallback) {
    currentReportCloseFailureFallback = hooks.reportCloseFailureFallback;
  }
  if (hooks.runWindowTransition) {
    currentRunWindowTransition = hooks.runWindowTransition;
  }
  if (hooks.settlePanelTransferBeforeClose) {
    currentSettlePanelTransferBeforeClose =
      hooks.settlePanelTransferBeforeClose;
  }
  if (hooks.signalPanelTransferClosing) {
    currentSignalPanelTransferClosing = hooks.signalPanelTransferClosing;
  }
}

export function __resetWindowCloseForceCandidatesForTests(): void {
  forceCloseCandidates.clear();
}

export function markWindowCloseForceCandidate(windowId: string): void {
  forceCloseCandidates.add(windowId);
}

export function clearWindowCloseForceCandidate(windowId: string): void {
  forceCloseCandidates.delete(windowId);
}

async function forceAllowCloseAfterUnreachableRenderer(
  windowId: string,
  reason: string
): Promise<WindowCloseDecision> {
  log.error("force-allow-close", { reason, windowId });
  try {
    await currentFlushCriticalState();
  } catch (err) {
    log.error("force-close-critical-flush-failed", {
      message: err instanceof Error ? err.message : String(err),
      windowId,
    });
  }
  try {
    await armAndDetachAgentsBeforeClose(windowId);
  } catch (err) {
    log.error("force-close-detach-failed", {
      message: err instanceof Error ? err.message : String(err),
      windowId,
    });
  }
  await flushAllStoresSettled();
  clearWindowCloseForceCandidate(windowId);
  return "allow";
}

async function presentForceCloseFallback(
  windowId: string,
  closeError: unknown,
  feedbackError: unknown
): Promise<WindowCloseDecision> {
  markWindowCloseForceCandidate(windowId);

  // Renderer IPC timeout / missing window: force-close immediately. A native
  // prompt cannot be answered if the user already believes the app is stuck,
  // and waiting for another click only prolongs the hang.
  if (isRendererUnreachableCloseError(closeError)) {
    log.error("auto-force-close-unreachable", {
      closeError:
        closeError instanceof Error ? closeError.message : String(closeError),
      feedbackError:
        feedbackError instanceof Error
          ? feedbackError.message
          : String(feedbackError),
      windowId,
    });
    return forceAllowCloseAfterUnreachableRenderer(
      windowId,
      "auto-force-timeout"
    );
  }

  try {
    const decision = await currentReportCloseFailureFallback({
      closeError,
      feedbackError,
      windowId,
    });
    if (decision === "force-close") {
      return forceAllowCloseAfterUnreachableRenderer(
        windowId,
        "user-force-close"
      );
    }
  } catch (fallbackError) {
    log.error("native-close-fallback-failed", {
      message:
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError),
      windowId,
    });
    console.error("[window-close-native-feedback] failed:", fallbackError);
  }
  return "veto";
}

async function reportCloseFailure(
  windowId: string,
  closeError: unknown
): Promise<WindowCloseDecision> {
  // Renderer already unreachable: skip another 15s IPC round-trip and offer force close.
  if (isRendererUnreachableCloseError(closeError)) {
    log.error("prepare-unreachable", {
      message:
        closeError instanceof Error ? closeError.message : String(closeError),
      windowId,
    });
    if (windowManager.isQuitting()) {
      log.error("native-close-fallback-suppressed-while-quitting", {
        message:
          closeError instanceof Error ? closeError.message : String(closeError),
        windowId,
      });
      console.error(
        "[window-close-native-feedback] suppressed while quitting:",
        closeError instanceof Error ? closeError.message : String(closeError)
      );
      return "veto";
    }
    return presentForceCloseFallback(windowId, closeError, closeError);
  }

  try {
    await currentReportCloseFailure(windowId, closeError);
    markWindowCloseForceCandidate(windowId);
    log.warn("close-failure-reported-to-renderer", {
      message:
        closeError instanceof Error ? closeError.message : String(closeError),
      windowId,
    });
    return "veto";
  } catch (feedbackError) {
    console.error("[window-close-feedback] failed:", feedbackError);
    log.error("close-failure-report-failed", {
      closeError:
        closeError instanceof Error ? closeError.message : String(closeError),
      feedbackError:
        feedbackError instanceof Error
          ? feedbackError.message
          : String(feedbackError),
      windowId,
    });
    if (windowManager.isQuitting()) {
      console.error(
        "[window-close-native-feedback] suppressed while quitting:",
        feedbackError instanceof Error
          ? feedbackError.message
          : String(feedbackError)
      );
      return "veto";
    }
    return presentForceCloseFallback(windowId, closeError, feedbackError);
  }
}

export async function flushAllStoresSettled(): Promise<void> {
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
      log.error("store-flush-failed", {
        label,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function armAndDetachAgentsBeforeClose(
  windowId: string
): Promise<void> {
  const window = windowManager.get(windowId);
  if (!window || window.isDestroyed()) {
    return;
  }
  const context = findWindowContext(window);
  if (!context) {
    return;
  }
  const electronWindowId = context.electronWindowId ?? String(window.id);
  const sessionScope = context.recordId;
  armDetaching({ electronWindowId, recordId: sessionScope });
  await detachAgentsForWindow(sessionScope);
}

export async function prepareWindowBeforeCloseCore(
  windowId: string,
  reason: "app-quit" | "window-close" = "window-close"
): Promise<WindowCloseDecision> {
  const transitionId = `${reason}:${windowId}:${randomUUID()}`;
  const lease = windowTransitionState.activeLease;
  const priorForceCandidate = forceCloseCandidates.has(windowId);

  if (priorForceCandidate && reason === "window-close") {
    log.warn("repeat-close-after-failed-prepare", { windowId });
    // Second close after a failed prepare: do not wait another full renderer
    // round-trip; offer force-close immediately.
    if (windowManager.isQuitting()) {
      return "veto";
    }
    return presentForceCloseFallback(
      windowId,
      new Error("renderer command timed out"),
      new Error("renderer command timed out")
    );
  }

  if (lease) {
    try {
      await currentSettlePanelTransferBeforeClose(lease, windowId, reason);
    } catch (err) {
      console.error(
        "[window-close-panel-transfer-settle] failed:",
        err instanceof Error ? err.message : String(err)
      );
      log.error("panel-transfer-settle-failed", {
        message: err instanceof Error ? err.message : String(err),
        windowId,
      });
    }
  }
  try {
    await currentPrepareRendererClose(windowId, reason, transitionId);
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
    log.error("prepare-failed", {
      message: err instanceof Error ? err.message : String(err),
      reason,
      transitionId,
      windowId,
    });
    return reportCloseFailure(windowId, err);
  }
  try {
    await currentFlushCriticalState();
  } catch (err) {
    await currentFinalizeRendererClose(windowId, transitionId, "abort").catch(
      () => undefined
    );
    log.error("critical-flush-failed", {
      message: err instanceof Error ? err.message : String(err),
      windowId,
    });
    return reportCloseFailure(windowId, err);
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
    log.error("finalize-failed", {
      message: err instanceof Error ? err.message : String(err),
      transitionId,
      windowId,
    });
    return reportCloseFailure(windowId, err);
  }
  await armAndDetachAgentsBeforeClose(windowId);
  await flushAllStoresSettled();
  clearWindowCloseForceCandidate(windowId);
  log.info("prepare-committed", { reason, transitionId, windowId });
  return "allow";
}

export async function flushWindowBeforeClose(windowId: string): Promise<void> {
  currentSignalPanelTransferClosing(windowId, "window-close");
  const decision = await currentRunWindowTransition(() =>
    prepareWindowBeforeCloseCore(windowId, "window-close")
  );
  if (decision === "veto") {
    throw new Error(`window close preparation was vetoed: ${windowId}`);
  }
}

export function ensureCloseHandler(): void {
  if (didRegisterCloseHandler) {
    return;
  }
  didRegisterCloseHandler = true;
  windowManager.onBeforeClose(({ windowId }) => {
    currentSignalPanelTransferClosing(windowId, "window-close");
    return currentRunWindowTransition(() =>
      prepareWindowBeforeCloseCore(windowId, "window-close")
    );
  });
  windowManager.onClose(({ recordId, transferDestroy, windowId }) => {
    clearWindowCloseForceCandidate(windowId);
    if (transferDestroy) {
      return;
    }
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
