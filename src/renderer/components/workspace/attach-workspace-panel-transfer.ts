/**
 * Attach Dockview panel-transfer drag/drop listeners for WorkspaceHost.
 *
 * Path B: target claim is main-mediated; renderer stamps DataTransfer and
 * routes drops to `window.pier.panelTransfer.drop`.
 */

import { PANEL_TRANSFER_TEXT_PREFIX } from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { createWorkspacePanelTransferHandlers } from "./workspace-panel-transfer.ts";

/**
 * Subscribe to Dockview drag events + window dragend/Escape for panel
 * transfer. Returns a disposer that removes all listeners.
 */
export function attachWorkspacePanelTransfer(api: DockviewApi): () => void {
  const transferHandlers = createWorkspacePanelTransferHandlers(
    () => useWorkspaceStore.getState().api
  );
  let activeTransferId: string | null = null;
  const willDragPanelDispose = api.onWillDragPanel((e) => {
    // 捕获 transferId 供 dragend 使用（dockview 不传 transferId 给 dragend）。
    const native = e.nativeEvent as DragEvent;
    if (native instanceof DragEvent && native.dataTransfer) {
      const text = native.dataTransfer.getData("text/plain");
      if (text.startsWith(PANEL_TRANSFER_TEXT_PREFIX)) {
        activeTransferId = text.slice(PANEL_TRANSFER_TEXT_PREFIX.length);
      }
    }
    transferHandlers.onWillDragPanel(e);
  });
  const unhandledDragOverDispose = api.onUnhandledDragOver((e) => {
    transferHandlers.onUnhandledDragOver(e as never);
  });
  const didDropDispose = api.onDidDrop((e) => {
    transferHandlers.onDidDrop(e as never);
  });
  const handleDragEnd = (): void => {
    transferHandlers.onDragEnd(activeTransferId);
    activeTransferId = null;
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && activeTransferId) {
      transferHandlers.onEscape(activeTransferId);
      activeTransferId = null;
    }
  };
  window.addEventListener("dragend", handleDragEnd);
  window.addEventListener("keydown", handleKeyDown);

  return () => {
    willDragPanelDispose?.dispose();
    unhandledDragOverDispose?.dispose();
    didDropDispose?.dispose();
    window.removeEventListener("dragend", handleDragEnd);
    window.removeEventListener("keydown", handleKeyDown);
  };
}
