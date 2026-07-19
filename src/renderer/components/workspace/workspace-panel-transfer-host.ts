/**
 * WorkspaceHost helpers for pending cross-window panel-transfer bootstrap.
 *
 * When this window is a pending transfer target, main's bootstrap() returns a
 * non-empty pending list. Host enters a bootstrap-gate, restores layout
 * (including embedded transfer placeholders), then settles each pending via
 * `panelTransfer.ready` before releasing the gate.
 *
 * Sequence when pending:
 *   - keep private api+flusher (already setApi + registerWorkspaceLayoutFlusher)
 *   - mutation gate blocks shortcuts/plugin add-close/user scheduler
 *     (isApplyingPersistedLayout already skips onDidLayoutChange debounce;
 *     userTouched is not set)
 *   - transfer renderer commands still stage/release/finalize + explicit flush
 *   - order: restoreEmbeddedTransferPanels → sanitize → fromJSON|empty target
 *     → flush → ready → release gate
 * Rollback (ready not-ok/abort) or target-active (ready ok) releases the gate.
 * Empty pending follows the normal restore path.
 */

import type { SerializedDockview } from "dockview-react";
import { restoreEmbeddedTransferPanels } from "./panel-transfer-layout-rewrite.ts";
import { sanitizeSavedLayout } from "./sanitize-saved-layout.ts";
import {
  releaseWorkspaceBootstrapGate,
  setWorkspaceBootstrapGate,
} from "./workspace-bootstrap-gate.ts";
import {
  type BootstrapPendingTransfer,
  bootstrapPendingTransfers,
} from "./workspace-panel-transfer.ts";

export async function loadWorkspaceLayoutWithPendingTransfers(
  recordId: string | null | undefined
): Promise<{
  pendingTransfers: BootstrapPendingTransfer[];
  saved: unknown;
}> {
  try {
    if (!recordId) {
      throw new Error("window context unavailable");
    }
    const [saved, pendingTransfers] = await Promise.all([
      window.pier.workspace.loadLayout(recordId),
      bootstrapPendingTransfers(),
    ]);
    return { pendingTransfers, saved };
  } catch (err) {
    console.error("[workspace] loadLayout/bootstrap failed:", err);
    return { pendingTransfers: [], saved: null };
  }
}

/**
 * Enter bootstrap-gate when there are pending transfers. Returns whether a
 * gate was entered (caller must later settle/release).
 */
export function enterPendingTransferBootstrapGate(
  pendingTransfers: BootstrapPendingTransfer[]
): boolean {
  if (pendingTransfers.length === 0) {
    return false;
  }
  // 取第一个 pending transferId 作为 gate 标签（多个 pending 极少见，
  // 都共享同一 gate；ready 逐个收尾，全部 settle 后再 release）。
  const firstTransferId = pendingTransfers[0]?.transferId ?? "pending";
  setWorkspaceBootstrapGate(firstTransferId, "pending-transfer-restore");
  return true;
}

/**
 * Restore embedded transfer placeholders, then sanitize unknown components.
 * Returns null when sanitize drops the whole layout (caller applies default).
 */
export function restoreAndSanitizeTransferLayout(
  saved: unknown,
  knownComponents: Set<string>
): SerializedDockview | null {
  if (!saved || typeof saved !== "object") {
    return null;
  }
  // 先尝试恢复 embedded transfer placeholder → 原 component（若插件回来了）。
  const restored = restoreEmbeddedTransferPanels(
    saved as SerializedDockview,
    knownComponents
  );
  // 剔除引用未注册 component 的 panel(如禁用插件后旧 layout 残留
  // pier.git.changes) —— 直接 fromJSON 会抛错让整个 layout 回退 default,
  // 把用户的终端等也丢了。先 sanitize 保住其它 panel。
  return sanitizeSavedLayout(restored.layout, knownComponents);
}

/**
 * Call ready for each pending transfer, then release the bootstrap gate.
 * Failures are logged and do not block workspace ready.
 */
export async function settlePendingTransferBootstrap(
  pendingTransfers: BootstrapPendingTransfer[]
): Promise<void> {
  if (pendingTransfers.length === 0) {
    return;
  }
  try {
    for (const pending of pendingTransfers) {
      const transferId = pending.transferId;
      const result = await window.pier.panelTransfer.ready(transferId);
      if (result && !result.ok) {
        console.warn(
          "[workspace] pending transfer ready reported failure:",
          result.code,
          result.message
        );
      }
    }
  } catch (err) {
    console.error("[workspace] pending transfer ready failed:", err);
  } finally {
    releaseWorkspaceBootstrapGate();
  }
}
