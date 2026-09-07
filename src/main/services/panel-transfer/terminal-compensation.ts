import { refreshTerminalDraft } from "../../ipc/terminal/drafts/broadcast.ts";
import { nativeTerminalProcesses } from "../../ipc/terminal/process/registry.ts";
import { terminalDraftStore } from "../../state/terminal-drafts/index.ts";

/**
 * Reverse/compensation helpers for journaled terminal panel ownership moves.
 */

import type { TerminalFocusCoordinator } from "../../ipc/terminal/focus-coordinator.ts";
import type { NativeAddon } from "../../ipc/terminal/native-addon.ts";
import type { RegisteredTerminalTaskLifecycle } from "../../ipc/terminal/task/lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "../../ipc/terminal/task/output-bindings.ts";
import {
  rollbackTransferPanelOwnership,
  type TerminalPanelOwnershipRollbackToken,
} from "../../state/terminal-session-transfer.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import type { TaskService } from "../tasks/service-types.ts";
import { clearAlias } from "./terminal-hook-owner-routing.ts";

export type TerminalPanelTransferPhase =
  | "leased"
  | "moving"
  | "moved"
  | "rolled-back";

export type CompletedSubstep =
  | "native"
  | "draft"
  | "session"
  | "task-output"
  | "task-lifecycle"
  | "foreground"
  | "focus"
  | "broadcast";

export interface StagedTransfer {
  completed: CompletedSubstep[];
  lifecycleId: string;
  panelId: string;
  phase: TerminalPanelTransferPhase;
  sessionToken: TerminalPanelOwnershipRollbackToken | null;
  sourceElectronWindowId: string;
  sourcePresentationId: number | null;
  sourceRecordId: string;
  sourceRuntimeWindowId: string;
  targetElectronWindowId: string;
  targetPresentationId: number | null;
  targetRecordId: string;
  targetRuntimeWindowId: string;
  transferId: string;
}

/** Deps needed to reverse completed transfer substeps. */
export interface TransferCompensationDeps {
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
  resolveWindow: (runtimeWindowId: string) => {
    recordId: string;
    win: AppWindow;
  } | null;
}

export function createTransferCompensation(
  deps: TransferCompensationDeps,
  scopedNativeKey: (browserWindowId: number, panelId: string) => string
): {
  reverseCompleted: (staged: StagedTransfer) => Promise<void>;
} {
  const reverseSubstep = (
    staged: StagedTransfer,
    step: CompletedSubstep
  ): Promise<void> | void => {
    const sourceWin = deps.resolveWindow(staged.sourceRuntimeWindowId)?.win;
    const targetWin = deps.resolveWindow(staged.targetRuntimeWindowId)?.win;
    switch (step) {
      case "broadcast":
        deps.broadcastTransfer?.({
          panelId: staged.panelId,
          sourceWindowId: staged.sourceRuntimeWindowId,
          targetWindowId: staged.targetRuntimeWindowId,
          transferId: staged.transferId,
        });
        break;
      case "focus":
        if (targetWin && !targetWin.isDestroyed()) {
          deps.focusCoordinator.surfaceWillClose(targetWin, staged.panelId);
        }
        if (sourceWin && !sourceWin.isDestroyed()) {
          deps.focusCoordinator.surfaceCreated(sourceWin, staged.panelId);
        }
        break;
      case "foreground":
        return deps.foreground.runSerial(() => {
          clearAlias({
            panelId: staged.panelId,
            windowId: staged.sourceElectronWindowId,
          });
          deps.foreground.transferScopes({
            panelId: staged.panelId,
            sourceWindowId: staged.targetElectronWindowId,
            targetWindowId: staged.sourceElectronWindowId,
          });
        });
      case "task-lifecycle":
        deps.getTaskLifecycle()?.moveOwner({
          lifecycleId: staged.lifecycleId,
          panelId: staged.panelId,
          sourceWindowId: staged.targetRuntimeWindowId,
          targetWindowId: staged.sourceRuntimeWindowId,
        });
        deps.getTaskService()?.moveRunningOwnerWindow({
          panelId: staged.panelId,
          sourceWindowId: staged.targetRuntimeWindowId,
          targetWindowId: staged.sourceRuntimeWindowId,
        });
        break;
      case "task-output": {
        const bindings = deps.getTaskOutputBindings();
        if (sourceWin && bindings) {
          bindings.moveNativeKey({
            browserWindowId: sourceWin.id,
            fromNativePanelId: scopedNativeKey(
              Number(staged.targetElectronWindowId),
              staged.panelId
            ),
            ownerWindowId: staged.sourceRuntimeWindowId,
            toNativePanelId: scopedNativeKey(sourceWin.id, staged.panelId),
          });
        }
        break;
      }
      case "draft":
        return terminalDraftStore()
          .move(staged.targetRecordId, staged.sourceRecordId, staged.panelId)
          .then(async () => {
            if (sourceWin)
              await refreshTerminalDraft(sourceWin, staged.panelId);
          });
      case "session":
        if (staged.sessionToken) {
          return rollbackTransferPanelOwnership(staged.sessionToken).then(
            () => {
              staged.sessionToken = null;
            }
          );
        }
        break;
      case "native":
        if (sourceWin && targetWin) {
          const addon = deps.getAddon();
          const movedBack = addon?.moveTerminal({
            fromNativePanelId: scopedNativeKey(targetWin.id, staged.panelId),
            toNativePanelId: scopedNativeKey(sourceWin.id, staged.panelId),
            toParentHandle: sourceWin.getNativeWindowHandle(),
            toBrowserWindowId: sourceWin.id,
          });
          if (movedBack)
            nativeTerminalProcesses.move(
              scopedNativeKey(targetWin.id, staged.panelId),
              scopedNativeKey(sourceWin.id, staged.panelId)
            );
          if (movedBack && staged.sourcePresentationId !== null) {
            addon?.requestTerminalPresentation({
              nativePanelId: scopedNativeKey(sourceWin.id, staged.panelId),
              presentationId: staged.sourcePresentationId,
            });
          }
        }
        break;
      default:
        break;
    }
  };

  const reverseCompleted = async (staged: StagedTransfer): Promise<void> => {
    for (const step of [...staged.completed].reverse()) {
      const pending = reverseSubstep(staged, step);
      if (pending) await pending;
    }
    staged.completed = [];
    const process =
      nativeTerminalProcesses.get(
        scopedNativeKey(Number(staged.sourceElectronWindowId), staged.panelId)
      ) ??
      nativeTerminalProcesses.get(
        scopedNativeKey(Number(staged.targetElectronWindowId), staged.panelId)
      );
    if (process) nativeTerminalProcesses.setTransferring(process, false);
  };

  return { reverseCompleted };
}
