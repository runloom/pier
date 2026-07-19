import type {
  PanelTransferPhase,
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import type { WindowTransitionLease } from "../window-service.ts";
import {
  type PanelTransferTransactionDeps,
  rollbackBeforeCommit,
  rollForwardAfterRuntimeMoved,
} from "./panel-transfer-commit.ts";
import {
  requireOk,
  snapshotFromPrepare,
  throwIfAborted,
  writePhase,
} from "./panel-transfer-phase-utils.ts";
import {
  PANEL_TRANSFER_SHOW_HOLD_REASON,
  type PanelTransferCaller,
  type PanelTransferJournalRecord,
  type PanelTransferTargetRef,
  sideEffectKey,
} from "./panel-transfer-types.ts";

export type { PanelTransferTransactionDeps } from "./panel-transfer-commit.ts";
export {
  abortJournalRecord,
  rollForwardAfterRuntimeMoved,
} from "./panel-transfer-commit.ts";
export type { PanelTransferRendererPort } from "./panel-transfer-renderer-port.ts";

const PRE_COMMIT_PHASES = new Set<PanelTransferPhase>([
  "offered",
  "claimed",
  "source-prepared",
  "target-durable",
  "commit-intent",
  "rolling-back",
]);

const POST_COMMIT_PHASES = new Set<PanelTransferPhase>([
  "runtime-moved",
  "source-durable",
  "target-active",
  "committed",
]);

export function isPostCommitPhase(phase: PanelTransferPhase): boolean {
  return POST_COMMIT_PHASES.has(phase);
}

export function isPreCommitPhase(phase: PanelTransferPhase): boolean {
  return PRE_COMMIT_PHASES.has(phase) || phase === "aborted";
}

export interface RunClaimedTransferInput {
  abortSignal: AbortSignal;
  deps: PanelTransferTransactionDeps;
  lease: WindowTransitionLease;
  placement: PanelTransferPlacement;
  record: PanelTransferJournalRecord;
  source: PanelTransferCaller;
  target: PanelTransferTargetRef;
}

export async function runClaimedTransfer(
  input: RunClaimedTransferInput
): Promise<PanelTransferResult> {
  const { abortSignal, deps, lease, placement, source, target } = input;
  let record = input.record;
  const transferId = record.transferId;
  const panelId = record.offer.panel.panelId;
  const targetPanelId = panelId;
  const sideEffects = new Set<string>();
  const mark = (phase: PanelTransferPhase) => {
    sideEffects.add(sideEffectKey(transferId, phase));
  };

  try {
    throwIfAborted(abortSignal);
    if (
      await deps.workspace.hasPanelId({
        panelId,
        windowRecordId: target.windowRecordId,
      })
    ) {
      return {
        code: "target_conflict",
        message: "target already has panel id",
        ok: false,
      };
    }

    record = await writePhase(deps.journal, record, "claimed", {
      placement,
      target,
      targetPanelId,
    });
    mark("claimed");

    throwIfAborted(abortSignal);
    const prepareResult = await deps.renderer.prepareSource({
      sourcePanelId: panelId,
      transferId,
      windowId: source.runtimeWindowId,
    });
    requireOk(prepareResult, "prepareSource failed");
    const snapshot = snapshotFromPrepare(
      prepareResult,
      panelId,
      record.offer.panel.componentId
    );
    record = await writePhase(deps.journal, record, "source-prepared", {
      snapshot,
    });
    mark("source-prepared");

    throwIfAborted(abortSignal);
    if (snapshot.prepared.drafts && snapshot.prepared.drafts.length > 0) {
      await deps.files.stageDrafts({
        drafts: snapshot.prepared.drafts,
        transferId,
      });
    }
    if (snapshot.runtime.kind === "terminal") {
      await deps.terminal.stageLease({
        lifecycleId: snapshot.runtime.lifecycleId,
        panelId,
        sourceWindowId: source.runtimeWindowId,
        targetWindowId: target.runtimeWindowId,
        transferId,
      });
    }

    if (target.kind === "internal") {
      deps.windows.holdRendererShow(
        target.runtimeWindowId,
        PANEL_TRANSFER_SHOW_HOLD_REASON
      );
    }

    const stageResult = await deps.renderer.stageTarget({
      panel: snapshot.panel,
      placement,
      prepared: snapshot.prepared,
      targetPanelId,
      transferId,
      windowId: target.runtimeWindowId,
    });
    requireOk(stageResult, "stageTarget failed");
    record = await writePhase(deps.journal, record, "target-durable", {
      snapshot,
      targetPanelId,
    });
    mark("target-durable");

    throwIfAborted(abortSignal);
    record = await writePhase(deps.journal, record, "commit-intent");
    mark("commit-intent");

    if (snapshot.runtime.kind === "terminal") {
      await deps.terminal.commitMove({
        lifecycleId: snapshot.runtime.lifecycleId,
        panelId,
        sourceWindowId: source.runtimeWindowId,
        targetWindowId: target.runtimeWindowId,
        transferId,
      });
    }
    if (snapshot.prepared.drafts && snapshot.prepared.drafts.length > 0) {
      await deps.files.commitDrafts({
        drafts: snapshot.prepared.drafts,
        transferId,
      });
    }

    record = await writePhase(deps.journal, record, "runtime-moved");
    mark("runtime-moved");

    return await rollForwardAfterRuntimeMoved({
      deps,
      lease,
      record,
      source,
      target,
      targetPanelId,
    });
  } catch (error) {
    if (isPostCommitPhase(record.phase)) {
      return await rollForwardAfterRuntimeMoved({
        deps,
        lease,
        record,
        source,
        target,
        targetPanelId,
      });
    }
    return await rollbackBeforeCommit({
      deps,
      error,
      lease,
      record,
      source,
      target,
    });
  }
}
