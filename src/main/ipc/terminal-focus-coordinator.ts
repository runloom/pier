import { isDeepStrictEqual } from "node:util";
import type {
  NativeFocusIntentResult,
  TerminalCoordinatorDebugSnapshot,
  TerminalFocusApplyResult,
  TerminalHostReason,
  TerminalHostSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalNativeApplyResult,
  TerminalNativeWindowState,
} from "@shared/contracts/terminal.ts";
import { computeEffectiveKeyboardTarget } from "@shared/terminal-keyboard-target.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { isTerminalHostSnapshot } from "./terminal-host-snapshot-validation.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { fromNativePanelKey, toNativePanelKey } from "./terminal-panel-id.ts";

interface WindowRecord {
  desired: TerminalHostSnapshot | null;
  dirty: boolean;
  effective: TerminalNativeWindowState | null;
  lastError: string | null;
  lastSuccessfulNativeApplySequence: number;
  lastSuccessfulRendererSequence: number | null;
  readyPanelIds: Set<string>;
  win: AppWindow;
  windowFocused: boolean;
}

function unavailableResult(
  record: WindowRecord | null,
  error: string | null
): TerminalFocusApplyResult {
  return {
    effective: record?.effective ?? null,
    error,
    nativeStatus: null,
    rendererSequence: record?.desired?.rendererSequence ?? null,
    shouldAck: false,
    status: "unavailable",
    webContentsFocused: false,
  };
}

export class TerminalFocusCoordinator {
  private addon: NativeAddon | null = null;
  private nextNativeApplySequence = 1;
  private readonly records = new Map<number, WindowRecord>();

  configureNativeAddon(addon: NativeAddon | null): void {
    this.addon = addon;
    for (const record of this.records.values()) {
      record.dirty = true;
    }
  }

  acceptRendererSnapshot(
    win: AppWindow,
    snapshot: TerminalHostSnapshot
  ): TerminalFocusApplyResult {
    const existing = this.records.get(win.id) ?? null;
    if (win.isDestroyed()) {
      return unavailableResult(existing, "destroyed-window");
    }
    const record = this.recordFor(win);
    if (!isTerminalHostSnapshot(snapshot)) {
      record.lastError = "invalid-host-snapshot";
      return {
        ...unavailableResult(record, "invalid-host-snapshot"),
        status: "error",
      };
    }

    if (record.desired) {
      if (snapshot.rendererSequence < record.desired.rendererSequence) {
        record.lastError = "stale-renderer-sequence";
        return this.rejectedResult(record, "stale", "stale-renderer-sequence");
      }
      if (snapshot.rendererSequence === record.desired.rendererSequence) {
        if (!isDeepStrictEqual(snapshot, record.desired)) {
          record.lastError = "renderer-sequence-conflict";
          return this.rejectedResult(
            record,
            "conflict",
            "renderer-sequence-conflict"
          );
        }
        if (
          !record.dirty &&
          record.lastSuccessfulRendererSequence === snapshot.rendererSequence
        ) {
          record.lastError = null;
          return {
            effective: record.effective,
            error: null,
            nativeStatus: null,
            rendererSequence: snapshot.rendererSequence,
            shouldAck: true,
            status: "unchanged",
            webContentsFocused: false,
          };
        }
      }
    }

    record.desired = snapshot;
    record.dirty = true;
    return this.reconcile(record, snapshot.reason);
  }

  acceptNativeFocusIntent(
    win: AppWindow,
    nativePanelId: string
  ): NativeFocusIntentResult {
    const rawPanelId = fromNativePanelKey(nativePanelId);
    if (toNativePanelKey(win, rawPanelId) !== nativePanelId) {
      return { ok: false, reason: "cross-window" };
    }
    const record = this.records.get(win.id);
    if (!record || win.isDestroyed()) {
      return { ok: false, reason: "stale" };
    }
    if (!record.readyPanelIds.has(rawPanelId)) {
      return { ok: false, reason: "not-ready" };
    }
    const entry = record.desired?.terminals.find(
      (terminal) => terminal.panelId === rawPanelId
    );
    if (!entry) {
      return { ok: false, reason: "stale" };
    }
    if (!entry.visible || entry.frame === null) {
      return { ok: false, reason: "hidden" };
    }
    // Web overlay (e.g. Rich Input composer) is holding keyboard ownership —
    // reject native focus intent so the terminal click stays with the web layer.
    const webRequestCount = record.desired?.webRequestCount ?? 0;
    if (webRequestCount > 0) {
      return { ok: false, reason: "web-overlay-active" };
    }
    return { ok: true, panelId: rawPanelId };
  }

  setWindowFocused(
    win: AppWindow,
    focused: boolean,
    reason: "window-focus" | "window-blur"
  ): TerminalFocusApplyResult {
    if (win.isDestroyed()) {
      return unavailableResult(
        this.records.get(win.id) ?? null,
        "destroyed-window"
      );
    }
    const record = this.recordFor(win);
    record.windowFocused = focused;
    record.dirty = true;
    return this.reconcile(record, reason);
  }

  surfaceCreated(win: AppWindow, panelId: string): TerminalFocusApplyResult {
    if (win.isDestroyed() || panelId.length === 0) {
      return unavailableResult(
        this.records.get(win.id) ?? null,
        "invalid-surface"
      );
    }
    const record = this.recordFor(win);
    record.readyPanelIds.add(panelId);
    record.dirty = true;
    return this.reconcile(record, "surface-created");
  }

  surfaceWillClose(win: AppWindow, panelId: string): TerminalFocusApplyResult {
    if (win.isDestroyed() || panelId.length === 0) {
      return unavailableResult(
        this.records.get(win.id) ?? null,
        "invalid-surface"
      );
    }
    const record = this.recordFor(win);
    record.readyPanelIds.delete(panelId);
    record.dirty = true;
    return this.reconcile(record, "surface-closing");
  }

  replay(win: AppWindow, reason: TerminalHostReason): TerminalFocusApplyResult {
    if (win.isDestroyed()) {
      return unavailableResult(
        this.records.get(win.id) ?? null,
        "destroyed-window"
      );
    }
    const record = this.recordFor(win);
    record.dirty = true;
    return this.reconcile(record, reason);
  }

  clearWindow(windowId: number): void {
    this.records.delete(windowId);
  }

  readDebug(win: AppWindow): TerminalCoordinatorDebugSnapshot {
    const record = this.records.get(win.id);
    return {
      desired: record?.desired ?? null,
      dirty: record?.dirty ?? false,
      effective: record?.effective ?? null,
      lastError: record?.lastError ?? null,
      lastSuccessfulNativeApplySequence:
        record?.lastSuccessfulNativeApplySequence ?? 0,
      readyPanelIds: [...(record?.readyPanelIds ?? [])].sort(),
    };
  }

  /** Dockview 当前 active panel；尚无 host snapshot 时为 null。 */
  activePanelId(win: AppWindow): string | null {
    return this.records.get(win.id)?.desired?.activePanelId ?? null;
  }

  private recordFor(win: AppWindow): WindowRecord {
    const existing = this.records.get(win.id);
    if (existing) {
      existing.win = win;
      return existing;
    }
    const record: WindowRecord = {
      desired: null,
      dirty: false,
      effective: null,
      lastError: null,
      lastSuccessfulNativeApplySequence: 0,
      lastSuccessfulRendererSequence: null,
      readyPanelIds: new Set<string>(),
      win,
      windowFocused: win.isFocused(),
    };
    this.records.set(win.id, record);
    return record;
  }

  private rejectedResult(
    record: WindowRecord,
    status: "conflict" | "stale",
    error: string
  ): TerminalFocusApplyResult {
    return {
      effective: record.effective,
      error,
      nativeStatus: null,
      rendererSequence: record.desired?.rendererSequence ?? null,
      shouldAck: false,
      status,
      webContentsFocused: false,
    };
  }

  private reconcile(
    record: WindowRecord,
    reason: TerminalHostReason
  ): TerminalFocusApplyResult {
    const desired = record.desired;
    if (!desired) {
      record.lastError = this.addon ? null : "native-addon-unavailable";
      return unavailableResult(record, record.lastError);
    }
    if (record.win.isDestroyed()) {
      record.lastError = "destroyed-window";
      return unavailableResult(record, record.lastError);
    }

    const requestedTarget = computeEffectiveKeyboardTarget(
      desired.basePanel,
      desired.webRequestCount
    );
    const requestedTerminal =
      requestedTarget.kind === "terminal"
        ? desired.terminals.find(
            (entry) => entry.panelId === requestedTarget.panelId
          )
        : undefined;
    const terminalEligible =
      requestedTarget.kind === "terminal" &&
      record.windowFocused &&
      record.readyPanelIds.has(requestedTarget.panelId) &&
      requestedTerminal?.visible === true &&
      requestedTerminal.frame !== null &&
      // 原生聚焦开关关闭（composer 接管）的终端不具备键盘资格。
      !desired.focusDisabledPanelIds.includes(requestedTarget.panelId);
    const rawKeyboardTarget: TerminalKeyboardFocusTarget = terminalEligible
      ? requestedTarget
      : { kind: "web" };
    const keyboardTarget: TerminalKeyboardFocusTarget =
      rawKeyboardTarget.kind === "terminal"
        ? {
            kind: "terminal",
            panelId: toNativePanelKey(record.win, rawKeyboardTarget.panelId),
          }
        : rawKeyboardTarget;
    const focusDisabledPanelIds = desired.focusDisabledPanelIds.map((panelId) =>
      toNativePanelKey(record.win, panelId)
    );
    const nativeApplySequence = this.nextNativeApplySequence++;
    const candidate: TerminalNativeWindowState = {
      focusDisabledPanelIds,
      keyboardTarget,
      nativeApplySequence,
      reason,
      rendererSequence: desired.rendererSequence,
      terminals: desired.terminals.map((entry) => ({
        ...entry,
        focused:
          rawKeyboardTarget.kind === "terminal" &&
          entry.panelId === rawKeyboardTarget.panelId,
        panelId: toNativePanelKey(record.win, entry.panelId),
        visible: entry.visible && entry.frame !== null,
      })),
      webOverlayRects: desired.webOverlayRects,
      windowFocused: record.windowFocused,
    };

    if (!this.addon) {
      record.dirty = true;
      record.lastError = "native-addon-unavailable";
      return unavailableResult(record, record.lastError);
    }

    const previousOwner = record.effective?.keyboardTarget ?? null;
    let nativeResult: TerminalNativeApplyResult;
    try {
      nativeResult = this.addon.applyTerminalWindowState(
        record.win.getNativeWindowHandle(),
        candidate
      );
    } catch (error) {
      nativeResult = {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const rendererWasSuccessful =
      record.lastSuccessfulRendererSequence === desired.rendererSequence;
    const nativeSucceeded =
      nativeResult.status === "applied" ||
      (nativeResult.status === "unchanged" && rendererWasSuccessful);
    if (nativeSucceeded) {
      record.effective = candidate;
      record.dirty = false;
      record.lastError = null;
      if (nativeResult.status === "applied") {
        record.lastSuccessfulNativeApplySequence = nativeApplySequence;
        record.lastSuccessfulRendererSequence = desired.rendererSequence;
      }
    } else {
      record.dirty = true;
      if (nativeResult.status === "error") {
        record.lastError = nativeResult.error;
      } else if (nativeResult.status === "stale") {
        record.lastError = "native-stale";
      } else {
        record.lastError = "native-unchanged-before-success";
      }
    }

    const shouldFocusWeb =
      keyboardTarget.kind === "web" &&
      record.windowFocused &&
      !record.win.webContents.isDestroyed() &&
      (previousOwner?.kind !== "web" ||
        reason === "window-focus" ||
        !nativeSucceeded);
    if (shouldFocusWeb) {
      record.win.webContents.focus();
    }

    if (!nativeSucceeded) {
      return {
        effective: record.effective,
        error: record.lastError,
        nativeStatus: nativeResult.status,
        rendererSequence: desired.rendererSequence,
        shouldAck: false,
        status: nativeResult.status === "error" ? "error" : nativeResult.status,
        webContentsFocused: shouldFocusWeb,
      };
    }
    return {
      effective: candidate,
      error: null,
      nativeStatus: nativeResult.status,
      rendererSequence: desired.rendererSequence,
      shouldAck: true,
      status: nativeResult.status === "applied" ? "applied" : "unchanged",
      webContentsFocused: shouldFocusWeb,
    };
  }
}

export const terminalFocusCoordinator = new TerminalFocusCoordinator();
