import type { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import {
  abortJournalRecord,
  isPostCommitPhase,
  type PanelTransferTransactionDeps,
  rollForwardAfterRuntimeMoved,
} from "./panel-transfer-transaction.ts";
import type {
  PanelTransferJournalRecord,
  PanelTransferWindowPort,
} from "./panel-transfer-types.ts";

export interface RecoverPendingInput {
  deps: PanelTransferTransactionDeps;
  journal: PanelTransferJournal;
  /**
   * Optional dialog hook for unreadable journals. Production wires native dialog.
   */
  reportParseFailure?: ((path: string, error: unknown) => void) | undefined;
}

/**
 * Startup recovery:
 * - pre commit-point: tear down staged target/drafts/session and abort, keep source
 * - post runtime-moved: keep pending with snapshot until target bootstrap→ready→finalize;
 *   best-effort source cleanup / open-record correction
 */
export async function recoverPendingTransfers(
  input: RecoverPendingInput
): Promise<void> {
  const { deps, journal, reportParseFailure } = input;
  await journal.init();
  if (journal.parseFailure) {
    reportParseFailure?.(journal.parseFailure.path, journal.parseFailure.error);
    return;
  }

  const pending = [...journal.list()];
  for (const record of pending) {
    try {
      if (isPostCommitPhase(record.phase)) {
        await recoverPostCommit(deps, record);
      } else {
        await abortJournalRecord({ deps, record });
      }
    } catch (error) {
      console.error(
        `[panel-transfer-recovery] failed for ${record.transferId}:`,
        error
      );
    }
  }
}

async function recoverPostCommit(
  deps: PanelTransferTransactionDeps,
  record: PanelTransferJournalRecord
): Promise<void> {
  // Keep journal entry with snapshot so target bootstrap can restore after
  // restoreOpenWindows(). recoverPending runs BEFORE windows are restored, so
  // an empty live window list must never mean "target gone — drop journal".
  if (!(record.snapshot && record.target)) {
    // Truly unrecoverable: no snapshot to hand to target bootstrap.
    await deps.journal.remove(record.transferId);
    return;
  }

  const liveWindows = deps.windows.list();
  const sourceStillOpen = liveWindows.some(
    (windowInfo) => windowInfo.recordId === record.source.windowRecordId
  );

  if (sourceStillOpen && record.phase === "runtime-moved") {
    try {
      await deps.renderer.releaseSource({
        sourcePanelId: record.offer.panel.panelId,
        transferId: record.transferId,
        windowId: record.source.runtimeWindowId,
      });
      await deps.journal.upsert({
        ...record,
        phase: "source-durable",
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error(
        "[panel-transfer-recovery] source release during recovery failed:",
        error
      );
    }
  }

  // Do not force target finalize here — target renderer must bootstrap→restore→ready.
  // Retain journal until that path (or an explicit unrecoverable condition) consumes it.
}

export async function rollForwardWithLease(input: {
  deps: PanelTransferTransactionDeps;
  record: PanelTransferJournalRecord;
  windows: PanelTransferWindowPort;
}): Promise<void> {
  const { deps, record, windows } = input;
  if (!(record.target && record.snapshot)) {
    return;
  }
  await windows.runExclusive(async (lease) => {
    await rollForwardAfterRuntimeMoved({
      deps,
      lease,
      record,
      source: record.source,
      target: record.target!,
      targetPanelId: record.targetPanelId ?? record.offer.panel.panelId,
    });
  });
}
