/**
 * Hook used by `PanelTabHeader` to intercept same-group tab-drop index for
 * cross-window panel transfers.
 *
 * Dockview's own tab strip handles same-window reorder via its private
 * `TabDropIndexEvent`. For cross-window transfers (Path B), the main process
 * routes the drop back to the target renderer via the
 * `panelTransfer.stageTarget` renderer command, and the placement's `index`
 * is computed *here* from the pointer's half-region within the hovered tab.
 *
 * The hook attaches capture-phase `dragover` / `drop` listeners to the tab
 * content root. When the drag carries the Pier panel-transfer MIME, it:
 *   - computes the hovered tab's index within `props.api.group.panels`,
 *   - picks `index` (left half) or `index + 1` (right half) based on pointer X,
 *   - calls `stopImmediatePropagation` so Dockview's private index handling
 *     does not also fire,
 *   - calls `dropTransferOnce(transferId, { kind: "tab", groupId, index })`.
 *
 * It does NOT touch Dockview's private `TabDropIndexEvent` or internal classes.
 */

import {
  PANEL_TRANSFER_MIME,
  type PanelTransferPlacement,
} from "@shared/contracts/panel-transfer.ts";
import { useCallback } from "react";
import { getActiveDrag } from "./workspace-panel-transfer-dnd.ts";
import { readPanelTransferId } from "./workspace-panel-transfer-shared.ts";

interface PanelTabHeaderApiLike {
  group?: {
    id: string;
    panels: ReadonlyArray<{ id: string }>;
  } | null;
  id: string;
}

export interface UsePanelTransferTabDropInput {
  api: PanelTabHeaderApiLike;
  /** Override for tests; defaults to window.pier.panelTransfer.drop. */
  dropTransferOnce?: (
    transferId: string,
    placement: PanelTransferPlacement
  ) => void;
}

function defaultDropTransferOnce(
  transferId: string,
  placement: PanelTransferPlacement
): void {
  const api = globalThis.window?.pier?.panelTransfer;
  if (!api) {
    return;
  }
  api.drop({ transferId, placement }).catch((err: unknown) => {
    console.error("[panelTransfer] tab drop failed:", err);
  });
}

function hasPanelTransferType(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  const types = dataTransfer.types;
  return types.includes(PANEL_TRANSFER_MIME) || types.includes("text/plain");
}

function computeTabIndex(
  api: PanelTabHeaderApiLike,
  clientX: number,
  currentTarget: HTMLElement
): { index: number; groupId: string } | null {
  const group = api.group;
  if (!group) {
    return null;
  }
  const tabIndex = group.panels.findIndex((p) => p.id === api.id);
  if (tabIndex < 0) {
    return null;
  }
  const rect = currentTarget.getBoundingClientRect();
  const isLeftHalf = clientX - rect.left <= rect.width / 2;
  // Insert before hovered tab (left half) or after (right half).
  const index = isLeftHalf ? tabIndex : tabIndex + 1;
  return { index, groupId: group.id };
}

export function usePanelTransferTabDrop(input: UsePanelTransferTabDropInput): {
  onDragOverCapture: (event: React.DragEvent) => void;
  onDropCapture: (event: React.DragEvent) => void;
} {
  const api = input.api;
  const dropTransferOnce = input.dropTransferOnce ?? defaultDropTransferOnce;

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      // Same-window local drag: let Dockview reorder tabs.
      if (getActiveDrag()) {
        return;
      }
      if (!hasPanelTransferType(event.nativeEvent.dataTransfer)) {
        return;
      }
      const transferId = readPanelTransferId(event.nativeEvent.dataTransfer);
      if (!transferId) {
        return;
      }
      const target = event.currentTarget as HTMLElement;
      const computed = computeTabIndex(api, event.clientX, target);
      if (!computed) {
        return;
      }
      // We don't drop here yet — just claim the index by preventing dockview's
      // private index handler. The actual drop is resolved in onDropCapture.
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    },
    [api]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      // Same-window local drag: do not stopImmediatePropagation / drop.
      if (getActiveDrag()) {
        return;
      }
      if (!hasPanelTransferType(event.nativeEvent.dataTransfer)) {
        return;
      }
      const transferId = readPanelTransferId(event.nativeEvent.dataTransfer);
      if (!transferId) {
        return;
      }
      const target = event.currentTarget as HTMLElement;
      const computed = computeTabIndex(api, event.clientX, target);
      if (!computed) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      dropTransferOnce(transferId, {
        groupId: computed.groupId,
        index: computed.index,
        kind: "tab",
      });
    },
    [api, dropTransferOnce]
  );

  return {
    onDragOverCapture: handleDragOver,
    onDropCapture: handleDrop,
  };
}
