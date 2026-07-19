/**
 * Drag-and-drop handlers and drop placement for cross-window panel transfer.
 */

import type { PanelTransferPlacement } from "@shared/contracts/panel-transfer.ts";
import { PANEL_TRANSFER_MIME } from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";
import { isPanelTransferMovable } from "./panel-transfer-adapters.ts";
import {
  type DidDropEventLike,
  isRealDragEvent,
  panelComponentOf,
  panelJsonParamsOf,
  panelTitleOf,
  pierPanelTransfer,
  showPanelTransferFailure,
  stampMovableDataTransfer,
  type TabDragEventLike,
  type UnhandledDragOverEventLike,
} from "./workspace-panel-transfer-shared.ts";

export interface WorkspacePanelTransferHandlers {
  onDidDrop(event: DidDropEventLike): void;
  onDragEnd(transferId: string | null): void;
  onEscape(transferId: string | null): void;
  onUnhandledDragOver(event: UnhandledDragOverEventLike): void;
  onWillDragPanel(event: TabDragEventLike): void;
}

interface TransferDragState {
  capability: "movable" | "unsupported";
  componentId: string;
  panelId: string;
  transferId: string;
}

let activeDrag: TransferDragState | null = null;

export function setActiveDrag(state: TransferDragState | null): void {
  activeDrag = state;
}

export function getActiveDrag(): TransferDragState | null {
  return activeDrag;
}

export function createWorkspacePanelTransferHandlers(
  getApi: () => DockviewApi | null
): WorkspacePanelTransferHandlers {
  return {
    onWillDragPanel(event) {
      const native = event.nativeEvent;
      if (!isRealDragEvent(native)) {
        return;
      }
      const panel = event.panel;
      const component = panelComponentOf(panel);
      if (!component) {
        return;
      }
      const transferId = crypto.randomUUID();
      const movable = isPanelTransferMovable(component);
      const capability: "movable" | "unsupported" = movable
        ? "movable"
        : "unsupported";
      if (movable) {
        stampMovableDataTransfer(
          native.dataTransfer,
          transferId,
          panel,
          component
        );
      }
      setActiveDrag({
        capability,
        componentId: component,
        panelId: panel.id,
        transferId,
      });
      const offer =
        capability === "movable"
          ? {
              capability: "movable" as const,
              panel: {
                componentId: component,
                panelId: panel.id,
                params: panelJsonParamsOf(panel),
                title: panelTitleOf(panel),
              },
              transferId,
              version: 1 as const,
            }
          : {
              capability: "unsupported" as const,
              panel: {
                componentId: component,
                panelId: panel.id,
                title: panelTitleOf(panel),
              },
              transferId,
              version: 1 as const,
            };
      pierPanelTransfer()
        .offer(offer)
        .catch((err) => {
          console.error("[panelTransfer] offer failed:", err);
        });
    },

    onUnhandledDragOver(event) {
      const native = event.nativeEvent;
      if (!(native instanceof DragEvent && native.dataTransfer)) {
        return;
      }
      const types = native.dataTransfer.types;
      if (
        !(types.includes(PANEL_TRANSFER_MIME) || types.includes("text/plain"))
      ) {
        return;
      }
      native.preventDefault();
      native.dataTransfer.dropEffect = "move";
      if (typeof event.accept === "function") {
        event.accept();
      }
    },

    onDidDrop(event) {
      const native = event.nativeEvent;
      if (!(native instanceof DragEvent && native.dataTransfer)) {
        return;
      }
      const drag = getActiveDrag();
      if (!drag) {
        // Foreign-window drop — main routes the placement back via stageTarget.
        return;
      }
      const api = getApi();
      if (!api) {
        return;
      }
      const placement = computePlacementFromDrop(event, drag.panelId, api);
      if (!placement) {
        return;
      }
      pierPanelTransfer()
        .drop({ transferId: drag.transferId, placement })
        .catch((err) => {
          console.error("[panelTransfer] drop failed:", err);
        });
    },

    onDragEnd(transferId) {
      const id = transferId ?? getActiveDrag()?.transferId ?? null;
      setActiveDrag(null);
      if (!id) {
        return;
      }
      pierPanelTransfer()
        .finishDrag(id)
        .then((result) => {
          if (result && !result.ok) {
            showPanelTransferFailure(result).catch(() => undefined);
          }
        })
        .catch((err) => {
          console.error("[panelTransfer] finishDrag failed:", err);
        });
    },

    onEscape(transferId) {
      const id = transferId ?? getActiveDrag()?.transferId ?? null;
      setActiveDrag(null);
      if (!id) {
        return;
      }
      pierPanelTransfer()
        .cancel(id)
        .catch((err) => {
          console.error("[panelTransfer] cancel failed:", err);
        });
    },
  };
}

export function computePlacementFromDrop(
  event: DidDropEventLike,
  _sourcePanelId: string,
  _api: DockviewApi
): PanelTransferPlacement | null {
  const group = event.group;
  const position = event.position;
  if (!group) {
    return { kind: "root" };
  }
  if (position === "center") {
    return {
      groupId: group.id,
      index: group.panels.length,
      kind: "tab",
    };
  }
  const direction = positionToDirection(position);
  if (!direction) {
    return {
      groupId: group.id,
      index: group.panels.length,
      kind: "tab",
    };
  }
  // The placement contract carries only `referenceGroupId` (not
  // `referencePanel`); dockview's addPanel position takes either, but the
  // transfer placement is main-mediated and main only needs the target group.
  // Same-group split (source panel in the drop group) is a same-window
  // Dockview operation that never reaches the cross-window drop path.
  return {
    direction,
    referenceGroupId: group.id,
    kind: "split",
  };
}

export function positionToDirection(
  position: string | undefined
): "left" | "right" | "above" | "below" | null {
  switch (position) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "top":
    case "above":
      return "above";
    case "bottom":
    case "below":
      return "below";
    default:
      return null;
  }
}
