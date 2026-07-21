/**
 * Attach Dockview panel-transfer drag listeners for WorkspaceHost.
 *
 * Dual-trigger: source stamps DataTransfer + offers on willDragPanel and
 * finishes via dragend (bounds channel); the same window also acts as a
 * TARGET for foreign Pier drags via unhandled-dragover accept + didDrop
 * (HTML5 channel). Main's tryClaim arbitrates whichever fires first.
 */

import type { DockviewApi } from "dockview-react";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { createWorkspacePanelTransferHandlers } from "./workspace-panel-transfer.ts";

/**
 * Subscribe to Dockview drag events + window dragend for panel transfer.
 * Returns a disposer that removes all listeners.
 */
export function attachWorkspacePanelTransfer(api: DockviewApi): () => void {
  const transferHandlers = createWorkspacePanelTransferHandlers(
    () => useWorkspaceStore.getState().api
  );
  let activeTransferId: string | null = null;
  const willDragPanelDispose = api.onWillDragPanel((e) => {
    // Stamp MIME first, then capture the returned transferId for dragend.
    activeTransferId = transferHandlers.onWillDragPanel(e);
  });
  const unhandledDragOverDispose = api.onUnhandledDragOver((e) => {
    transferHandlers.onUnhandledDragOver(e as never);
  });
  const didDropDispose = api.onDidDrop((e) => {
    transferHandlers.onDidDrop(e as never);
  });
  // Outside-release guard: prevents dockview's sticky-overlay dragend commit
  // (dndOverlayMounting "absolute") from doing a phantom in-window move when
  // the tab was actually released outside this window.
  const willDropDispose = api.onWillDrop((e) => {
    transferHandlers.onWillDrop(e as never);
  });
  const handleDragEnd = (): void => {
    transferHandlers.onDragEnd(activeTransferId);
    activeTransferId = null;
  };
  // Capture phase: dockview droptargets stopPropagation() on dragend when
  // they commit a sticky overlay (root edge ring is on the dragged tab's
  // ancestor chain), which would silently eat the bubble-phase listener and
  // skip finishDrag — the new-window / cross-window claim would never run.
  window.addEventListener("dragend", handleDragEnd, { capture: true });

  return () => {
    willDragPanelDispose?.dispose();
    unhandledDragOverDispose?.dispose();
    didDropDispose?.dispose();
    willDropDispose?.dispose();
    window.removeEventListener("dragend", handleDragEnd, { capture: true });
  };
}
