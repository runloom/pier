/**
 * Production PanelTransferTerminalPort: lease + journaled Ghostty/session/task
 * ownership move across Pier windows without killing the PTY.
 */

import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TerminalFocusCoordinator } from "../../ipc/terminal-focus-coordinator.ts";
import type { NativeAddon } from "../../ipc/terminal-native-addon.ts";
import { toNativePanelKey } from "../../ipc/terminal-panel-id.ts";
import type { RegisteredTerminalTaskLifecycle } from "../../ipc/terminal-task-lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "../../ipc/terminal-task-output-bindings.ts";
import { ensureTerminalPanelSession } from "../../state/terminal-session-state.ts";
import {
  getTransferSession,
  transferPanelOwnership as transferSessionPanelOwnership,
} from "../../state/terminal-session-transfer.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import type { TaskService } from "../tasks/task-service-types.ts";
import type { PanelTransferTerminalPort } from "./panel-transfer-types.ts";
import { activateAlias } from "./terminal-hook-owner-routing.ts";
import {
  createTransferCompensation,
  type StagedTransfer,
} from "./terminal-panel-transfer-compensation.ts";

export type { TerminalPanelTransferPhase } from "./terminal-panel-transfer-compensation.ts";

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

let activeTransferApi: TerminalPanelTransfer | null = null;

export function getTerminalPanelTransfer(): TerminalPanelTransfer | null {
  return activeTransferApi;
}

function scopedNativeKey(browserWindowId: number, panelId: string): string {
  return `${browserWindowId}::${panelId}`;
}

export function createTerminalPanelTransfer(
  deps: TerminalPanelTransferDeps
): TerminalPanelTransfer {
  const transfers = new Map<string, StagedTransfer>();
  const leaseBySource = new Map<string, string>();
  const leaseByTarget = new Map<string, string>();

  const panelLeaseKey = (runtimeWindowId: string, panelId: string): string =>
    `${runtimeWindowId}\0${panelId}`;

  const findByLease = (
    runtimeWindowId: string,
    panelId: string
  ): StagedTransfer | null => {
    const sourceId = leaseBySource.get(panelLeaseKey(runtimeWindowId, panelId));
    if (sourceId) {
      return transfers.get(sourceId) ?? null;
    }
    const targetId = leaseByTarget.get(panelLeaseKey(runtimeWindowId, panelId));
    if (targetId) {
      return transfers.get(targetId) ?? null;
    }
    return null;
  };

  const clearLeaseIndexes = (staged: StagedTransfer): void => {
    leaseBySource.delete(
      panelLeaseKey(staged.sourceRuntimeWindowId, staged.panelId)
    );
    leaseByTarget.delete(
      panelLeaseKey(staged.targetRuntimeWindowId, staged.panelId)
    );
  };

  const { reverseCompleted } = createTransferCompensation(
    deps,
    scopedNativeKey
  );

  const api: TerminalPanelTransfer = {
    getCurrentLifecycleId(input) {
      return (
        deps
          .getTaskLifecycle()
          ?.getCurrentLifecycleId(input.panelId, input.sourceWindowId) ?? ""
      );
    },

    async stageLease(input) {
      const source = deps.resolveWindow(input.sourceWindowId);
      const target = deps.resolveWindow(input.targetWindowId);
      if (!(source && target)) {
        throw new Error("terminal transfer windows unavailable for lease");
      }
      if (source.recordId === target.recordId) {
        throw new Error("terminal transfer source and target must differ");
      }
      const existingTargetSession = await getTransferSession(
        target.recordId,
        input.panelId
      );
      if (existingTargetSession) {
        throw new Error("target_conflict");
      }

      const identity = api.resolveTransferIdentity({
        expectedLifecycleId: input.lifecycleId,
        panelId: input.panelId,
        recordId: source.recordId,
        runtimeWindowId: input.sourceWindowId,
      });
      if (!identity.ok) {
        throw new Error(identity.reason ?? "transfer identity mismatch");
      }
      const sourceSession = await getTransferSession(
        source.recordId,
        input.panelId
      );
      if (sourceSession && sourceSession.lifecycleId !== input.lifecycleId) {
        throw new Error(
          `session lifecycle mismatch: expected ${input.lifecycleId}, got ${sourceSession.lifecycleId}`
        );
      }
      if (!sourceSession) {
        // Metadata-less legacy terminal (created before the ensure-on-create
        // invariant). Materialize the entry so commit CAS has something to
        // move; absence of optional metadata must not veto the transfer.
        await ensureTerminalPanelSession(source.recordId, input.panelId);
      }

      const staged: StagedTransfer = {
        completed: [],
        lifecycleId: input.lifecycleId,
        panelId: input.panelId,
        phase: "leased",
        sessionToken: null,
        sourceElectronWindowId: String(source.win.id),
        sourceRecordId: source.recordId,
        sourceRuntimeWindowId: input.sourceWindowId,
        targetElectronWindowId: String(target.win.id),
        targetRecordId: target.recordId,
        targetRuntimeWindowId: input.targetWindowId,
        transferId: input.transferId,
      };
      transfers.set(input.transferId, staged);
      leaseBySource.set(
        panelLeaseKey(input.sourceWindowId, input.panelId),
        input.transferId
      );
      leaseByTarget.set(
        panelLeaseKey(input.targetWindowId, input.panelId),
        input.transferId
      );
    },

    async commitMove(input) {
      const staged = transfers.get(input.transferId);
      if (!staged) {
        throw new Error(`terminal transfer lease missing: ${input.transferId}`);
      }
      if (staged.phase === "moved") {
        return;
      }
      staged.phase = "moving";

      const source = deps.resolveWindow(staged.sourceRuntimeWindowId);
      const target = deps.resolveWindow(staged.targetRuntimeWindowId);
      if (!(source && target)) {
        await reverseCompleted(staged);
        staged.phase = "rolled-back";
        clearLeaseIndexes(staged);
        transfers.delete(input.transferId);
        throw new Error("terminal transfer windows unavailable for commit");
      }

      const addon = deps.getAddon();
      if (!addon) {
        await reverseCompleted(staged);
        staged.phase = "rolled-back";
        clearLeaseIndexes(staged);
        transfers.delete(input.transferId);
        throw new Error("native addon unavailable for terminal move");
      }

      const fromNativePanelId = toNativePanelKey(source.win, staged.panelId);
      const toNativePanelId = toNativePanelKey(target.win, staged.panelId);

      try {
        const moved = addon.moveTerminal({
          fromNativePanelId,
          toNativePanelId,
          toParentHandle: target.win.getNativeWindowHandle(),
          toBrowserWindowId: target.win.id,
        });
        if (!moved) {
          throw new Error("moveTerminal returned false");
        }
        staged.completed.push("native");

        staged.sessionToken = await transferSessionPanelOwnership({
          expectedLifecycleId: staged.lifecycleId,
          panelId: staged.panelId,
          sourceRecordId: staged.sourceRecordId,
          targetRecordId: staged.targetRecordId,
        });
        staged.completed.push("session");

        const taskOutputBindings = deps.getTaskOutputBindings();
        if (taskOutputBindings) {
          const rekeyed = taskOutputBindings.moveNativeKey({
            browserWindowId: target.win.id,
            fromNativePanelId,
            ownerWindowId: staged.targetRuntimeWindowId,
            toNativePanelId,
          });
          if (!rekeyed.ok) {
            throw new Error(rekeyed.error ?? "task output rekey failed");
          }
          staged.completed.push("task-output");
        }

        deps.getTaskLifecycle()?.moveOwner({
          lifecycleId: staged.lifecycleId,
          panelId: staged.panelId,
          sourceWindowId: staged.sourceRuntimeWindowId,
          targetWindowId: staged.targetRuntimeWindowId,
        });
        staged.completed.push("task-lifecycle");

        deps.getTaskService()?.moveRunningOwnerWindow({
          panelId: staged.panelId,
          sourceWindowId: staged.sourceRuntimeWindowId,
          targetWindowId: staged.targetRuntimeWindowId,
        });

        await deps.foreground.runSerial(() => {
          deps.foreground.transferScopes({
            panelId: staged.panelId,
            sourceWindowId: staged.sourceElectronWindowId,
            targetWindowId: staged.targetElectronWindowId,
          });
          activateAlias(
            {
              panelId: staged.panelId,
              windowId: staged.sourceElectronWindowId,
            },
            {
              panelId: staged.panelId,
              windowId: staged.targetElectronWindowId,
            }
          );
        });
        staged.completed.push("foreground");

        deps.focusCoordinator.surfaceWillClose(source.win, staged.panelId);
        deps.focusCoordinator.surfaceCreated(target.win, staged.panelId);
        staged.completed.push("focus");

        deps.broadcastTransfer?.({
          panelId: staged.panelId,
          sourceWindowId: staged.sourceRuntimeWindowId,
          targetWindowId: staged.targetRuntimeWindowId,
          transferId: staged.transferId,
        });
        staged.completed.push("broadcast");

        if (deps.replayMovedSession) {
          try {
            const movedSession = await getTransferSession(
              staged.targetRecordId,
              staged.panelId
            );
            const context = movedSession?.session.context;
            const title = movedSession?.session.title;
            if (context || (title && title.length > 0)) {
              deps.replayMovedSession({
                context,
                panelId: staged.panelId,
                targetElectronWindowId: target.win.id,
                title,
              });
            }
          } catch {
            // Replay is best-effort UI freshness; never fail a committed move.
          }
        }

        staged.phase = "moved";
      } catch (error) {
        await reverseCompleted(staged);
        staged.phase = "rolled-back";
        clearLeaseIndexes(staged);
        transfers.delete(input.transferId);
        throw error;
      }
    },

    async rollback(input) {
      const staged = transfers.get(input.transferId);
      if (!staged) {
        return;
      }
      // PanelTransferService only calls rollback before journal runtime-moved.
      // Even after commitMove (phase "moved"), reverse — unique commit point is
      // the journal phase, not the local terminal port phase.
      await reverseCompleted(staged);
      staged.phase = "rolled-back";
      clearLeaseIndexes(staged);
      transfers.delete(input.transferId);
    },

    isPanelLeased(runtimeWindowId, panelId) {
      const staged = findByLease(runtimeWindowId, panelId);
      return staged !== null && staged.phase !== "rolled-back";
    },

    isNativeKeyLeased(nativePanelId) {
      for (const staged of transfers.values()) {
        if (staged.phase === "rolled-back") {
          continue;
        }
        const sourceKey = scopedNativeKey(
          Number(staged.sourceElectronWindowId),
          staged.panelId
        );
        const targetKey = scopedNativeKey(
          Number(staged.targetElectronWindowId),
          staged.panelId
        );
        if (nativePanelId === sourceKey || nativePanelId === targetKey) {
          return true;
        }
      }
      return false;
    },

    shouldSkipTargetCreate(runtimeWindowId, panelId) {
      const staged = findByLease(runtimeWindowId, panelId);
      return (
        staged !== null &&
        staged.targetRuntimeWindowId === runtimeWindowId &&
        (staged.phase === "leased" || staged.phase === "moving")
      );
    },

    shouldAdoptMovedSurface(runtimeWindowId, panelId) {
      const staged = findByLease(runtimeWindowId, panelId);
      return (
        staged !== null &&
        staged.phase === "moved" &&
        staged.targetRuntimeWindowId === runtimeWindowId
      );
    },

    acknowledgeSourceCloseIdempotent(runtimeWindowId, panelId) {
      const staged = findByLease(runtimeWindowId, panelId);
      if (!staged) {
        return false;
      }
      if (staged.sourceRuntimeWindowId !== runtimeWindowId) {
        return false;
      }
      // Leased or moved source close must succeed without killing the surface.
      return (
        staged.phase === "leased" ||
        staged.phase === "moved" ||
        staged.phase === "moving"
      );
    },

    retainedPanelIdsForWindow(runtimeWindowId, activePanelIds) {
      const retained = new Set(
        activePanelIds.filter((id) => id.trim().length > 0)
      );
      for (const staged of transfers.values()) {
        if (staged.phase === "rolled-back") {
          continue;
        }
        if (
          staged.sourceRuntimeWindowId === runtimeWindowId ||
          staged.targetRuntimeWindowId === runtimeWindowId
        ) {
          retained.add(staged.panelId);
        }
      }
      return [...retained];
    },

    resolveTransferIdentity(input) {
      const current =
        deps
          .getTaskLifecycle()
          ?.getCurrentLifecycleId(input.panelId, input.runtimeWindowId) ?? "";
      const expected = input.expectedLifecycleId;
      // Shells may carry empty lifecycleId on both sides.
      if (expected !== current) {
        return {
          lifecycleId: current,
          ok: false,
          reason: `lifecycle mismatch: expected ${expected}, got ${current}`,
        };
      }
      return { lifecycleId: current, ok: true };
    },
  };

  activeTransferApi = api;
  return api;
}
