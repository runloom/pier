/** Terminal panel ownership transfer APIs over session store records. */

import { readTerminalPanelSession } from "./terminal-session-state.ts";
import type { TerminalPanelSession } from "./terminal-session-state-schemas.ts";
import {
  emptyWindowSession,
  ensureTerminalSessionStore,
} from "./terminal-session-store.ts";

/** Narrow view for transfer identity checks — never invents ownerWindowId. */
export interface TerminalTransferSessionView {
  /** Task run id when present; shells/agents without a task use empty string. */
  lifecycleId: string;
  panelId: string;
  recordId: string;
  session: TerminalPanelSession;
}

export async function getTransferSession(
  recordId: string,
  panelId: string
): Promise<TerminalTransferSessionView | null> {
  const session = await readTerminalPanelSession(recordId, panelId);
  if (!session) {
    return null;
  }
  return {
    lifecycleId: session.task?.runId ?? "",
    panelId,
    recordId,
    session,
  };
}

/**
 * Opaque rollback token for transferPanelOwnership. External modules must not
 * inspect fields beyond passing the token back to rollbackTransferPanelOwnership.
 */
export interface TerminalPanelOwnershipRollbackToken {
  readonly panelId: string;
  readonly sourceRecordId: string;
  readonly targetRecordId: string;
}

export class TerminalPanelOwnershipConflictError extends Error {
  readonly code: string;

  constructor(message: string, code = "ownership_conflict") {
    super(message);
    this.name = "TerminalPanelOwnershipConflictError";
    this.code = code;
  }
}

/**
 * CAS-move `windows[sourceRecordId].panels[panelId]` → `windows[targetRecordId]`
 * and flush. Optional expectedLifecycleId must match task.runId (shells: "").
 */
export async function transferPanelOwnership(input: {
  expectedLifecycleId?: string | undefined;
  panelId: string;
  sourceRecordId: string;
  targetRecordId: string;
}): Promise<TerminalPanelOwnershipRollbackToken> {
  const { panelId, sourceRecordId, targetRecordId } = input;
  if (
    panelId.trim().length === 0 ||
    sourceRecordId.trim().length === 0 ||
    targetRecordId.trim().length === 0
  ) {
    throw new TerminalPanelOwnershipConflictError(
      "transferPanelOwnership requires non-empty identities"
    );
  }
  if (sourceRecordId === targetRecordId) {
    throw new TerminalPanelOwnershipConflictError(
      "transferPanelOwnership source and target must differ"
    );
  }

  const s = await ensureTerminalSessionStore();
  const current = s.get();
  const sourceWindow = current.windows[sourceRecordId];
  const panel = sourceWindow?.panels[panelId];
  if (!panel) {
    throw new TerminalPanelOwnershipConflictError(
      `source panel missing: ${sourceRecordId}/${panelId}`,
      "source_missing"
    );
  }
  if (input.expectedLifecycleId !== undefined) {
    const actual = panel.task?.runId ?? "";
    if (actual !== input.expectedLifecycleId) {
      throw new TerminalPanelOwnershipConflictError(
        `lifecycle mismatch: expected ${input.expectedLifecycleId}, got ${actual}`,
        "lifecycle_mismatch"
      );
    }
  }
  if (current.windows[targetRecordId]?.panels[panelId]) {
    throw new TerminalPanelOwnershipConflictError(
      `target already has panel: ${targetRecordId}/${panelId}`,
      "target_conflict"
    );
  }

  s.mutate((state) => {
    const liveSource = state.windows[sourceRecordId];
    const livePanel = liveSource?.panels[panelId];
    if (!(liveSource && livePanel)) {
      throw new TerminalPanelOwnershipConflictError(
        `source panel missing during CAS: ${sourceRecordId}/${panelId}`,
        "source_missing"
      );
    }
    if (state.windows[targetRecordId]?.panels[panelId]) {
      throw new TerminalPanelOwnershipConflictError(
        `target already has panel during CAS: ${targetRecordId}/${panelId}`,
        "target_conflict"
      );
    }
    const targetWindow = state.windows[targetRecordId] ?? emptyWindowSession();
    state.windows[targetRecordId] = targetWindow;
    targetWindow.panels[panelId] = {
      ...livePanel,
      updatedAt: new Date().toISOString(),
    };
    delete liveSource.panels[panelId];
    if (Object.keys(liveSource.panels).length === 0) {
      delete state.windows[sourceRecordId];
    }
    return state;
  });
  await s.flush();
  return {
    panelId,
    sourceRecordId,
    targetRecordId,
  };
}

export async function rollbackTransferPanelOwnership(
  token: TerminalPanelOwnershipRollbackToken
): Promise<void> {
  await transferPanelOwnership({
    panelId: token.panelId,
    sourceRecordId: token.targetRecordId,
    targetRecordId: token.sourceRecordId,
  });
}
