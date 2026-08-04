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
} from "./commit.ts";
import { waitForTargetWorkspaceReady } from "./helpers.ts";
import {
  requireOk,
  snapshotFromPrepare,
  throwIfAborted,
  writePhase,
} from "./phase-utils.ts";
import {
  PANEL_TRANSFER_SHOW_HOLD_REASON,
  type PanelTransferCaller,
  type PanelTransferJournalRecord,
  type PanelTransferTargetRef,
  sideEffectKey,
} from "./types.ts";

export type { PanelTransferTransactionDeps } from "./commit.ts";
export {
  abortJournalRecord,
  rollForwardAfterRuntimeMoved,
} from "./commit.ts";
export type { PanelTransferRendererPort } from "./renderer-port.ts";

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
  const mode = record.offer.mode ?? "move";
  // Move reuses the source panel id (terminal lifecycle binding). Copy must
  // allocate a fresh id so the source tab can remain open.
  let targetPanelId = panelId;
  if (mode === "copy") {
    targetPanelId =
      record.targetPanelId && record.targetPanelId !== panelId
        ? record.targetPanelId
        : crypto.randomUUID();
  }
  const sideEffects = new Set<string>();
  const mark = (phase: PanelTransferPhase) => {
    sideEffects.add(sideEffectKey(transferId, phase));
  };

  try {
    throwIfAborted(abortSignal);
    if (
      await deps.workspace.hasPanelId({
        panelId: targetPanelId,
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
    // Terminal lifecycle identity comes from main's canonical registry —
    // renderer snapshots carry only runtimeKind and never forge lifecycle.
    const terminalLifecycleId = deps.terminal.getCurrentLifecycleId({
      panelId,
      sourceWindowId: source.runtimeWindowId,
    });
    const snapshot = snapshotFromPrepare(
      prepareResult,
      panelId,
      record.offer.panel.componentId,
      terminalLifecycleId
    );
    if (mode === "copy" && snapshot.runtime.kind === "terminal") {
      // Throw so catch runs rollbackBeforeCommit / finalize(abort) and
      // clears prepare-side freeze (relocationSuppressed, frozen snapshot).
      throw new Error("terminal panels cannot be copied across windows");
    }
    record = await writePhase(deps.journal, record, "source-prepared", {
      snapshot,
    });
    mark("source-prepared");

    throwIfAborted(abortSignal);
    if (snapshot.prepared.drafts && snapshot.prepared.drafts.length > 0) {
      if (!record.target) {
        throw new Error("Panel transfer target is required to stage drafts");
      }
      await deps.files.stageDrafts({
        drafts: snapshot.prepared.drafts,
        sourceOwner: record.source.windowRecordId,
        targetOwner: record.target.windowRecordId,
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

    // New windows (and slow managed targets) may not have Dockview api yet.
    await waitForTargetWorkspaceReady(
      deps.renderer,
      target.runtimeWindowId,
      abortSignal
    );

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
      if (!record.target) {
        throw new Error("Panel transfer target is required to commit drafts");
      }
      await deps.files.commitDrafts({
        drafts: snapshot.prepared.drafts,
        sourceOwner: record.source.windowRecordId,
        targetOwner: record.target.windowRecordId,
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
        targetPanelId: record.targetPanelId ?? targetPanelId,
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
