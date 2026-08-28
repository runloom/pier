import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TerminalFocusCoordinator } from "../../ipc/terminal/focus-coordinator.ts";
import type { NativeAddon } from "../../ipc/terminal/native-addon.ts";
import type { RegisteredTerminalTaskLifecycle } from "../../ipc/terminal/task/lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "../../ipc/terminal/task/output-bindings.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import type { TaskService } from "../tasks/service-types.ts";
import type { PanelTransferTerminalPort } from "./types.ts";

export interface TerminalPanelTransferDeps {
  broadcastTransfer?:
    | ((input: {
        panelId: string;
        sourceWindowId: string;
        targetWindowId: string;
        transferId: string;
      }) => void)
    | undefined;
  focusCoordinator: TerminalFocusCoordinator;
  foreground: {
    runSerial: <T>(operation: () => Promise<T> | T) => Promise<T>;
    transferScopes: (input: {
      panelId: string;
      sourceWindowId: string;
      targetWindowId: string;
    }) => void;
  };
  getAddon: () => NativeAddon | null;
  getTaskLifecycle: () => RegisteredTerminalTaskLifecycle | null;
  getTaskOutputBindings: () => TaskOutputTerminalBindings | null;
  getTaskService: () => TaskService | null;
  /**
   * Replay the moved panel's persisted context/title to the target window
   * renderer. The target panel mounts during stage — before the session entry
   * moves under the target record — so its mount-time readSession misses and
   * it would otherwise fall back to creation-time params until the next OSC
   * cwd/title event (idle shells: never).
   */
  replayMovedSession?:
    | ((input: {
        context?: PanelContext | undefined;
        panelId: string;
        targetElectronWindowId: number;
        title?: string | undefined;
      }) => void)
    | undefined;
  resolveWindow: (runtimeWindowId: string) => {
    recordId: string;
    win: AppWindow;
  } | null;
}

export interface TerminalPanelTransfer extends PanelTransferTerminalPort {
  acknowledgeSourceCloseIdempotent(
    runtimeWindowId: string,
    panelId: string
  ): boolean;
  isNativeKeyLeased(nativePanelId: string): boolean;
  isPanelLeased(runtimeWindowId: string, panelId: string): boolean;
  registerTargetPresentation(
    runtimeWindowId: string,
    panelId: string,
    presentationId: number
  ): boolean;
  resolveTransferIdentity(input: {
    expectedLifecycleId: string;
    panelId: string;
    recordId: string;
    runtimeWindowId: string;
  }): {
    lifecycleId: string;
    ok: boolean;
    reason?: string;
  };
  /** Active + leased panel ids that reconcile/retain must keep alive. */
  retainedPanelIdsForWindow(
    runtimeWindowId: string,
    activePanelIds: readonly string[]
  ): string[];
  shouldAdoptMovedSurface(runtimeWindowId: string, panelId: string): boolean;
  shouldSkipTargetCreate(runtimeWindowId: string, panelId: string): boolean;
}
