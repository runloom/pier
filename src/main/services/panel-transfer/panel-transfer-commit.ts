import type {
  PanelTransferPhase,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import type { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import type { WindowTransitionLease } from "../window-service.ts";
import { fail, requireOk, writePhase } from "./panel-transfer-phase-utils.ts";
import type { PanelTransferRendererPort } from "./panel-transfer-renderer-port.ts";
import {
  PANEL_TRANSFER_SHOW_HOLD_REASON,
  type PanelTransferCaller,
  type PanelTransferFilesPort,
  type PanelTransferJournalRecord,
  type PanelTransferTargetRef,
  type PanelTransferTerminalPort,
  type PanelTransferWindowPort,
  type PanelTransferWorkspacePort,
} from "./panel-transfer-types.ts";

const POST_COMMIT_PHASES = new Set<PanelTransferPhase>([
  "runtime-moved",
  "source-durable",
  "target-active",
  "committed",
]);

function isPostCommitPhase(phase: PanelTransferPhase): boolean {
  return POST_COMMIT_PHASES.has(phase);
}

export interface PanelTransferTransactionDeps {
  files: PanelTransferFilesPort;
  journal: PanelTransferJournal;
  renderer: PanelTransferRendererPort;
  terminal: PanelTransferTerminalPort;
  windows: PanelTransferWindowPort;
  workspace: PanelTransferWorkspacePort;
}

export async function rollForwardAfterRuntimeMoved(input: {
  deps: PanelTransferTransactionDeps;
  lease: WindowTransitionLease;
  record: PanelTransferJournalRecord;
  source: PanelTransferCaller;
  target: PanelTransferTargetRef;
  targetPanelId: string;
}): Promise<PanelTransferResult> {
  const { deps, lease, source, target, targetPanelId } = input;
  let record = input.record;
  const transferId = record.transferId;
  const panelId = record.offer.panel.panelId;
  const snapshot = record.snapshot;

  if (record.phase === "runtime-moved" || record.phase === "source-durable") {
    if (record.phase === "runtime-moved") {
      const release = await deps.renderer.releaseSource({
        sourcePanelId: panelId,
        transferId,
        windowId: source.runtimeWindowId,
      });
      requireOk(release, "releaseSource failed");
      record = await writePhase(deps.journal, record, "source-durable");
    }

    const sourceFinalize = await deps.renderer.finalize({
      outcome: "commit",
      role: "source",
      transferId,
      windowId: source.runtimeWindowId,
    });
    requireOk(sourceFinalize, "source finalize failed");

    const targetFinalize = await deps.renderer.finalize({
      outcome: "commit",
      role: "target",
      transferId,
      windowId: target.runtimeWindowId,
    });
    requireOk(targetFinalize, "target finalize failed");

    record = await writePhase(deps.journal, record, "target-active");
    deps.windows.releaseRendererShow(
      target.runtimeWindowId,
      PANEL_TRANSFER_SHOW_HOLD_REASON
    );

    record = await writePhase(deps.journal, record, "committed");
    await deps.journal.remove(transferId);

    try {
      await deps.windows.closeAfterTransfer(
        lease,
        source.runtimeWindowId,
        transferId
      );
    } catch {
      // Source may still have other panels.
    }

    return { ok: true, targetPanelId };
  }

  if (record.phase === "target-active" || record.phase === "committed") {
    await deps.journal.remove(transferId).catch(() => undefined);
    deps.windows.releaseRendererShow(
      target.runtimeWindowId,
      PANEL_TRANSFER_SHOW_HOLD_REASON
    );
    return { ok: true, targetPanelId };
  }

  if (!snapshot) {
    return fail("transfer_failed", "missing snapshot after commit point");
  }
  return fail(
    "transfer_failed",
    `unexpected post-commit phase: ${record.phase}`
  );
}

export async function rollbackBeforeCommit(input: {
  deps: PanelTransferTransactionDeps;
  error: unknown;
  lease?: WindowTransitionLease;
  record: PanelTransferJournalRecord;
  source: PanelTransferCaller;
  target: PanelTransferTargetRef;
}): Promise<PanelTransferResult> {
  const { deps, source, target } = input;
  let record = input.record;
  const transferId = record.transferId;
  const snapshot = record.snapshot;

  try {
    record = await writePhase(deps.journal, record, "rolling-back");
  } catch {
    // continue best-effort rollback
  }

  try {
    await deps.terminal.rollback({ transferId });
  } catch {
    // best effort
  }
  if (snapshot?.prepared.drafts && snapshot.prepared.drafts.length > 0) {
    try {
      await deps.files.rollbackDrafts({
        drafts: snapshot.prepared.drafts,
        transferId,
      });
    } catch {
      // best effort
    }
  }

  try {
    await deps.renderer.finalize({
      outcome: "abort",
      role: "target",
      transferId,
      windowId: target.runtimeWindowId,
    });
  } catch {
    // best effort
  }
  try {
    await deps.renderer.finalize({
      outcome: "abort",
      role: "source",
      transferId,
      windowId: source.runtimeWindowId,
    });
  } catch {
    // best effort
  }

  deps.windows.releaseRendererShow(
    target.runtimeWindowId,
    PANEL_TRANSFER_SHOW_HOLD_REASON
  );

  if (target.kind === "internal") {
    const pendingPlaceholder = target.windowRecordId.startsWith("pending:");
    if (!pendingPlaceholder && input.lease) {
      try {
        await deps.windows.destroyForTransfer(
          input.lease,
          target.runtimeWindowId,
          transferId
        );
      } catch {
        // best effort — do not block abort result on destroy failure
      }
    } else if (!pendingPlaceholder) {
      // Cold pre-commit abort: createForTransfer may have opened the record
      // before crash, but destroyForTransfer needs a live lease/window.
      try {
        await deps.windows.closeOpenWindowRecord(target.windowRecordId);
      } catch {
        // best effort
      }
    }
  }

  try {
    record = await writePhase(deps.journal, record, "aborted");
    await deps.journal.remove(transferId);
  } catch {
    // ignore
  }

  const message =
    input.error instanceof Error
      ? input.error.message
      : String(input.error ?? "transfer failed");
  if (message.includes("target already has panel id")) {
    return fail("target_conflict", message);
  }
  if (message.toLowerCase().includes("abort")) {
    return fail("expired", "transfer aborted");
  }
  return fail("transfer_failed", message);
}

export async function abortJournalRecord(input: {
  deps: Pick<
    PanelTransferTransactionDeps,
    "files" | "journal" | "renderer" | "terminal" | "windows"
  >;
  record: PanelTransferJournalRecord;
}): Promise<void> {
  const { deps, record } = input;
  if (isPostCommitPhase(record.phase)) {
    return;
  }
  await rollbackBeforeCommit({
    deps: {
      ...deps,
      workspace: {
        clearLayout: async () => undefined,
        hasPanelId: async () => false,
      },
    },
    error: new DOMException("panel transfer aborted", "AbortError"),
    record,
    source: record.source,
    target: record.target ?? {
      kind: "managed",
      runtimeWindowId: record.source.runtimeWindowId,
      windowRecordId: record.source.windowRecordId,
    },
  });
}
