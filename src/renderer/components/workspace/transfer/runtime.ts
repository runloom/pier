/**
 * Renderer-side runtime state for cross-window panel transfer.
 *
 * Path B: target claim is main-mediated. This module holds the
 * renderer-local state that the four `panelTransfer.*` renderer commands
 * (prepareSource / stageTarget / releaseSource / finalize) and the Dockview
 * drag handlers read and mutate:
 *
 * - relocation suppression flag (releaseSource removes panel without closing
 *   native terminal / closing the source window)
 * - frozen source snapshots keyed by transferId (so stageTarget can verify the
 *   local adapter revision matches what main holds)
 * - idempotency record for finalize (`${transferId}:${command}:${role}:${outcome}`)
 * - bootstrap gate (mutation gate blocking shortcuts / plugin add-close / user
 *   scheduler while a pending transfer is being restored)
 *
 * State is module-level (single workspace per renderer process). All access is
 * synchronous; no locks needed.
 */

import type { PanelTransferRendererSourceSnapshot } from "@shared/contracts/panel-transfer.ts";

/**
 * Tracks whether the workspace is currently mid-relocation. When true,
 * removePanel must NOT trigger close guards / native terminal close / window
 * close — main has already committed runtime ownership elsewhere.
 */
let relocationSuppressed = false;

export function isPanelRelocationSuppressed(): boolean {
  return relocationSuppressed;
}

export function setPanelRelocationSuppressed(value: boolean): void {
  relocationSuppressed = value;
}

/**
 * Frozen source snapshots produced by prepareSource. Keyed by transferId.
 * Cleared on finalize.
 */
const frozenSourceSnapshots = new Map<
  string,
  { snapshot: PanelTransferRendererSourceSnapshot; revision: number }
>();

export function setFrozenSourceSnapshot(
  transferId: string,
  snapshot: PanelTransferRendererSourceSnapshot,
  revision: number
): void {
  frozenSourceSnapshots.set(transferId, { snapshot, revision });
}

export function getFrozenSourceSnapshot(
  transferId: string
): PanelTransferRendererSourceSnapshot | null {
  return frozenSourceSnapshots.get(transferId)?.snapshot ?? null;
}

export function getFrozenSourceSnapshotRevision(
  transferId: string
): number | null {
  return frozenSourceSnapshots.get(transferId)?.revision ?? null;
}

export function clearFrozenSourceSnapshot(transferId: string): void {
  frozenSourceSnapshots.delete(transferId);
}

/**
 * Idempotency record for finalize. Key: `${transferId}:${command}:${role}:${outcome}`.
 * A repeated identical finalize is a no-op success; a conflicting finalize
 * (same transferId, different outcome) is rejected.
 */
const finalizeRecords = new Map<
  string,
  { transferId: string; outcome: "commit" | "abort" }
>();

export function finalizeKey(
  transferId: string,
  command: string,
  role: "source" | "target",
  outcome: "commit" | "abort"
): string {
  return `${transferId}:${command}:${role}:${outcome}`;
}

export function recordFinalize(
  transferId: string,
  command: string,
  role: "source" | "target",
  outcome: "commit" | "abort"
): { alreadyRecorded: boolean; conflictingOutcome: "commit" | "abort" | null } {
  const key = finalizeKey(transferId, command, role, outcome);
  const existing = finalizeRecords.get(transferId);
  if (existing) {
    // Same transferId already finalized. Idempotent only if same outcome.
    if (existing.outcome === outcome) {
      return { alreadyRecorded: true, conflictingOutcome: null };
    }
    return { alreadyRecorded: false, conflictingOutcome: existing.outcome };
  }
  finalizeRecords.set(transferId, { transferId, outcome });
  // Also mark the key for dedup if the same command+role+outcome is re-sent.
  finalizeRecords.set(key, { transferId, outcome });
  return { alreadyRecorded: false, conflictingOutcome: null };
}

export function isFinalizeRecorded(
  transferId: string,
  command: string,
  role: "source" | "target",
  outcome: "commit" | "abort"
): boolean {
  return finalizeRecords.has(finalizeKey(transferId, command, role, outcome));
}

export function clearFinalizeRecord(transferId: string): void {
  // Remove both the transferId-keyed and command-keyed entries.
  for (const [key, record] of finalizeRecords) {
    if (record.transferId === transferId) {
      finalizeRecords.delete(key);
    }
  }
}

/**
 * Staged target panels keyed by transferId. Written by stageTarget so
 * finalize(target, commit) can activate the panel it staged (VS Code
 * `targetGroup.focus()` semantics — a moved panel lands active).
 */
const stagedTargetPanels = new Map<string, string>();

export function setStagedTargetPanel(
  transferId: string,
  panelId: string
): void {
  stagedTargetPanels.set(transferId, panelId);
}

export function takeStagedTargetPanel(transferId: string): string | null {
  const panelId = stagedTargetPanels.get(transferId) ?? null;
  stagedTargetPanels.delete(transferId);
  return panelId;
}

/**
 * Bootstrap gate: when a pending transfer is being restored into this window,
 * block workspace mutations (shortcuts, plugin add-close, user scheduler) but
 * allow transfer commands (stageTarget / releaseSource / finalize + explicit
 * flush). The gate is released after rollback completes or the target reaches
 * `target-active`.
 */
let bootstrapGate: {
  transferId: string;
  reason: string;
} | null = null;

/**
 * Transfers whose finalize already ran in this window. A transfer-startup
 * window sets its gate from an async boot path; when the whole transaction
 * outruns that boot path, the release (in finalize) would happen BEFORE the
 * set — leaving a permanent gate. Late set attempts for finalized transfers
 * must be no-ops.
 */
const finalizedGateTombstones = new Set<string>();

export function recordFinalizedGateTombstone(transferId: string): void {
  finalizedGateTombstones.add(transferId);
}

export function isWorkspaceBootstrapGateActive(): boolean {
  return bootstrapGate !== null;
}

export function getWorkspaceBootstrapGate(): {
  transferId: string;
  reason: string;
} | null {
  return bootstrapGate;
}

export function setWorkspaceBootstrapGate(
  transferId: string,
  reason: string
): void {
  if (finalizedGateTombstones.has(transferId)) {
    return;
  }
  bootstrapGate = { transferId, reason };
}

export function releaseWorkspaceBootstrapGate(): void {
  bootstrapGate = null;
}

/**
 * Reset all module state. Tests only.
 */
export function resetPanelTransferRuntimeForTests(): void {
  relocationSuppressed = false;
  frozenSourceSnapshots.clear();
  finalizeRecords.clear();
  stagedTargetPanels.clear();
  finalizedGateTombstones.clear();
  bootstrapGate = null;
}
