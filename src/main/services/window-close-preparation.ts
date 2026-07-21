import { randomUUID } from "node:crypto";
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
}) => Promise<void> | void = () => undefined;
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
  if (lease) {
    try {
      await currentSettlePanelTransferBeforeClose(lease, windowId, reason);
    } catch (err) {
      console.error(
        "[window-close-panel-transfer-settle] failed:",
        err instanceof Error ? err.message : String(err)
      );
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
  windowManager.onClose(({ recordId, transferDestroy }) => {
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
