/**
 * Attach Dockview panel-transfer drag listeners for WorkspaceHost.
 *
 * Dual-trigger: source stamps DataTransfer + offers on willDragPanel and
 * finishes via dragend (bounds channel); the same window also acts as a
 * TARGET for foreign Pier drags via unhandled-dragover accept + didDrop
 * (HTML5 channel). Main's tryClaim arbitrates whichever fires first.
 *
 * Live overlay: main broadcasts cursor classification. Source overlay
 * hide is the dockview-core document-dragleave patch. This window drives
 * Dockview `contentDropTarget.showOverlay` when it is the hovered foreign
 * target (HTML5 dragover never arrives).
 */

import type { DockviewApi } from "dockview-react";
import { getWindowContext } from "@/lib/ipc/window-ipc.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { createWorkspacePanelTransferHandlers } from "./index.ts";
import { createPanelTransferOverlayPreviewSession } from "./overlay-preview.ts";

/**
 * Subscribe to Dockview drag events + window dragend for panel transfer.
 * Returns a disposer that removes all listeners.
 */
export function attachWorkspacePanelTransfer(api: DockviewApi): () => void {
  const getApi = () => useWorkspaceStore.getState().api;
  const transferHandlers = createWorkspacePanelTransferHandlers(getApi);
  let windowId: string | null = null;
  const overlaySession = createPanelTransferOverlayPreviewSession({
    getApi,
    getWindowId: () => windowId,
  });
  getWindowContext()
    .then((context) => {
      windowId = context.windowId;
      overlaySession.refresh();
    })
    .catch(() => undefined);
  const onOverlayPreview =
    globalThis.window?.pier?.panelTransfer?.onOverlayPreview;
  const overlayPreviewDispose =
    typeof onOverlayPreview === "function"
      ? onOverlayPreview((preview) => {
          overlaySession.apply(preview);
        })
      : undefined;
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
  const handleDragEnd = (event: DragEvent): void => {
    transferHandlers.onDragEnd(activeTransferId, event);
    activeTransferId = null;
  };
  const handleWindowDrop = (event: DragEvent): void => {
    transferHandlers.onWindowDrop(event);
  };
  window.addEventListener("drop", handleWindowDrop, { capture: true });
  // Capture phase: dockview droptargets stopPropagation() on dragend when
  // they commit a sticky overlay (root edge ring is on the dragged tab's
  // ancestor chain), which would silently eat the bubble-phase listener and
  // skip finishDrag — the new-window / cross-window claim would never run.
  window.addEventListener("dragend", handleDragEnd, { capture: true });

  return () => {
    overlayPreviewDispose?.();
    overlaySession.dispose();
    willDragPanelDispose?.dispose();
    unhandledDragOverDispose?.dispose();
    didDropDispose?.dispose();
    willDropDispose?.dispose();
    window.removeEventListener("dragend", handleDragEnd, { capture: true });
    window.removeEventListener("drop", handleWindowDrop, { capture: true });
  };
}
