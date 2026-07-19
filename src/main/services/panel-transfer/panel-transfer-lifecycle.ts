import type {
  PanelTransferBootstrapState,
  PanelTransferPhase,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import type { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import type { WindowTransitionLease } from "../window-service.ts";
import { recoverPendingTransfers } from "./panel-transfer-recovery.ts";
import {
  isPostCommitPhase,
  type PanelTransferTransactionDeps,
  rollForwardAfterRuntimeMoved,
} from "./panel-transfer-transaction.ts";
import type {
  PanelTransferCaller,
  PanelTransferService,
} from "./panel-transfer-types.ts";

const BOOTSTRAP_MIN_PHASE = new Set<PanelTransferPhase>([
  "source-prepared",
  "target-durable",
  "commit-intent",
  "runtime-moved",
  "source-durable",
  "target-active",
]);

export interface PanelTransferLifecycleArgs {
  clearOffer(transferId: string): void;
  deps: PanelTransferTransactionDeps;
  journal: PanelTransferJournal;
  offers: Map<
    string,
    {
      abort: AbortController;
      claim?: { target: { runtimeWindowId: string } };
      source: PanelTransferCaller;
    }
  >;
  pluginMutation: <T>(operation: () => Promise<T>) => Promise<T>;
  pruneTombstones(): void;
  rememberTombstone(transferId: string, result: PanelTransferResult): void;
  reportJournalParseFailure?:
    | ((path: string, error: unknown) => void)
    | undefined;
  tombstones: Map<string, { expiresAt: number; result: PanelTransferResult }>;
  windowAbort: Map<string, AbortController>;
  windows: PanelTransferTransactionDeps["windows"];
}

export function createPanelTransferLifecycleMethods(
  args: PanelTransferLifecycleArgs
): Pick<
  PanelTransferService,
  | "bootstrap"
  | "cancel"
  | "flushJournal"
  | "ready"
  | "recoverPending"
  | "settleWindowBeforeClose"
  | "signalWindowClosing"
> {
  const {
    deps,
    journal,
    offers,
    clearOffer,
    pluginMutation,
    pruneTombstones,
    rememberTombstone,
    reportJournalParseFailure,
    tombstones,
    windows,
    windowAbort,
  } = args;

  return {
    async bootstrap(caller) {
      await journal.init();
      const pending: PanelTransferBootstrapState["pending"] = [];
      for (const record of journal.list()) {
        if (!(record.snapshot && BOOTSTRAP_MIN_PHASE.has(record.phase)))
          continue;
        // Durable attachment key is windowRecordId. Runtime ids are
        // process-local and reassigned after restoreOpenWindows().
        const isSource = record.source.windowRecordId === caller.windowRecordId;
        const isTarget =
          record.target?.windowRecordId === caller.windowRecordId;
        if (!(isSource || isTarget)) continue;
        pending.push({
          inert: isTarget && !isPostCommitPhase(record.phase),
          panelId: record.offer.panel.panelId,
          phase: record.phase,
          role: isTarget ? "target" : "source",
          snapshot: record.snapshot,
          transferId: record.transferId,
        });
      }
      return { pending };
    },

    async cancel(caller, transferId) {
      const live = offers.get(transferId);
      if (!live) return;
      if (
        live.source.runtimeWindowId !== caller.runtimeWindowId &&
        live.source.webContentsId !== caller.webContentsId
      ) {
        return;
      }
      live.abort.abort(new DOMException("cancelled", "AbortError"));
      if (live.claim) return;
      clearOffer(transferId);
    },

    async ready(caller, transferId) {
      pruneTombstones();
      const tombstone = tombstones.get(transferId);
      if (tombstone) return tombstone.result;
      const record = journal.get(transferId);
      if (!record) return null;
      if (
        !record.target ||
        record.target.windowRecordId !== caller.windowRecordId
      ) {
        return null;
      }
      if (
        !isPostCommitPhase(record.phase) &&
        record.phase !== "target-durable"
      ) {
        return null;
      }
      if (isPostCommitPhase(record.phase)) {
        // Refresh process-local runtime ids from the live caller / window list
        // so roll-forward addresses the restored WebContents, not stale main/w-N.
        const liveWindows = windows.list();
        const liveSource = liveWindows.find(
          (windowInfo) => windowInfo.recordId === record.source.windowRecordId
        );
        const source: PanelTransferCaller = liveSource
          ? {
              ...record.source,
              runtimeWindowId: liveSource.id,
            }
          : record.source;
        const target = {
          ...record.target,
          runtimeWindowId: caller.runtimeWindowId,
        };
        let liveRecord = record;
        if (
          source.runtimeWindowId !== record.source.runtimeWindowId ||
          target.runtimeWindowId !== record.target.runtimeWindowId
        ) {
          liveRecord = {
            ...record,
            source,
            target,
            updatedAt: Date.now(),
          };
          await journal.upsert(liveRecord);
        }
        const result = await pluginMutation(() =>
          windows.runExclusive(async (lease) =>
            rollForwardAfterRuntimeMoved({
              deps,
              lease,
              record: liveRecord,
              source,
              target,
              targetPanelId:
                liveRecord.targetPanelId ?? liveRecord.offer.panel.panelId,
            })
          )
        );
        rememberTombstone(transferId, result);
        return result;
      }
      return null;
    },

    signalWindowClosing(windowId) {
      const controller = windowAbort.get(windowId) ?? new AbortController();
      windowAbort.set(windowId, controller);
      if (!controller.signal.aborted) {
        controller.abort(new DOMException("window closing", "AbortError"));
      }
      for (const live of offers.values()) {
        if (
          live.source.runtimeWindowId === windowId ||
          live.claim?.target.runtimeWindowId === windowId
        ) {
          live.abort.abort(new DOMException("window closing", "AbortError"));
        }
      }
    },

    async settleWindowBeforeClose(
      _lease: WindowTransitionLease,
      windowId: string
    ) {
      for (const [transferId, live] of [...offers.entries()]) {
        const involves =
          live.source.runtimeWindowId === windowId ||
          live.claim?.target.runtimeWindowId === windowId;
        if (!involves) continue;
        const journaled = journal.get(transferId);
        if (!journaled) {
          live.abort.abort(new DOMException("window closing", "AbortError"));
          if (!live.claim) clearOffer(transferId);
          continue;
        }
        if (journaled.phase === "claimed" || journaled.phase === "offered") {
          live.abort.abort(new DOMException("window closing", "AbortError"));
          await journal.remove(transferId).catch(() => undefined);
          clearOffer(transferId);
        }
      }
    },

    async recoverPending() {
      await recoverPendingTransfers({
        deps,
        journal,
        reportParseFailure: reportJournalParseFailure,
      });
    },

    async flushJournal() {
      await journal.flush();
    },
  };
}
