/**
 * Drag-and-drop handlers for cross-window panel transfer.
 *
 * Dual-trigger claim design (belt and suspenders):
 *
 * - HTML5 channel (primary when the OS delivers cross-window drag events —
 *   VS Code relies on exactly this for cross-main-window tab drags): the
 *   TARGET window accepts foreign dragover (Dockview then shows its native
 *   drop overlay) and claims via `pier.panelTransfer.drop` with the
 *   placement Dockview itself resolved for that drop (`event.position` is
 *   the overlay quadrant the user saw — never re-derive it from geometry).
 * - Bounds channel (fallback, Path B): the SOURCE window's dragend calls
 *   `finishDrag`; main classifies the cursor against window bounds and
 *   claims managed/internal targets itself, resolving placement in the
 *   target renderer via `resolvePlacementFromClientPoint` (a mirror of
 *   Dockview's overlay activation model).
 *
 * `tryClaim` in main is single-claimant: whichever channel arrives first
 * wins, the other resolves against the existing claim (drop returns
 * `already_claimed`, finishDrag returns the claim's result or null).
 */

import { PANEL_TRANSFER_MIME } from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";
import { isPanelTransferMovable } from "./panel-transfer-adapters.ts";
import { resolvePlacementFromDidDrop } from "./workspace-panel-transfer-placement.ts";
import {
  type DidDropEventLike,
  isRealDragEvent,
  panelComponentOf,
  panelJsonParamsOf,
  panelParamsOf,
  panelTitleOf,
  pierPanelTransfer,
  readPanelTransferId,
  showPanelTransferFailure,
  stampMovableDataTransfer,
  type TabDragEventLike,
  type UnhandledDragOverEventLike,
  type WillDropEventLike,
} from "./workspace-panel-transfer-shared.ts";

export interface WorkspacePanelTransferHandlers {
  onDidDrop(event: DidDropEventLike): void;
  onDragEnd(transferId: string | null): void;
  onUnhandledDragOver(event: UnhandledDragOverEventLike): void;
  onWillDragPanel(event: TabDragEventLike): string | null;
  onWillDrop(event: WillDropEventLike): void;
}

interface TransferDragState {
  capability: "movable" | "unsupported";
  componentId: string;
  /**
   * Frozen dockview params at drag-start. prepareSource re-reads live params
   * first; this is a fallback when live params lose `source` mid-drag.
   */
  params: Readonly<Record<string, unknown>>;
  panelId: string;
  transferId: string;
}

let activeDrag: TransferDragState | null = null;

/** Frozen offer params for an in-flight transfer (by transferId). */
const frozenOfferParamsByTransferId = new Map<
  string,
  Readonly<Record<string, unknown>>
>();

export function setActiveDrag(state: TransferDragState | null): void {
  if (state) {
    frozenOfferParamsByTransferId.set(state.transferId, state.params);
  }
  activeDrag = state;
}

export function getActiveDrag(): TransferDragState | null {
  return activeDrag;
}

/**
 * Params captured at `onWillDragPanel` for this transferId. Survives past
 * dragend so prepareSource (which runs after drop/claim) can still fall back
 * when live dockview params are empty or corrupt.
 */
export function takeFrozenOfferParams(
  transferId: string
): Readonly<Record<string, unknown>> | null {
  const params = frozenOfferParamsByTransferId.get(transferId) ?? null;
  frozenOfferParamsByTransferId.delete(transferId);
  return params;
}

/** Drop freeze without reading (finishDrag null / terminal failure). */
export function discardFrozenOfferParams(transferId: string): void {
  frozenOfferParamsByTransferId.delete(transferId);
}

export function frozenOfferParamsSizeForTests(): number {
  return frozenOfferParamsByTransferId.size;
}

export function clearFrozenOfferParamsForTests(): void {
  frozenOfferParamsByTransferId.clear();
}

/**
 * Merge drag-start freeze under live dockview params for prepareSource and
 * the renderer source snapshot.
 *
 * - Defined live keys win over freeze.
 * - `undefined` live keys do not wipe freeze (partial updates).
 * - `source` uses freeze when live is missing/null/non-object; a live object
 *   (even schema-invalid) is kept so adapter/registry recovery can run.
 */
export function mergeDragStartPanelParams(
  live: Readonly<Record<string, unknown>>,
  frozen: Readonly<Record<string, unknown>> | null
): {
  params: Record<string, unknown>;
  usedFrozenSource: boolean;
} {
  if (frozen == null) {
    return { params: { ...live }, usedFrozenSource: false };
  }
  const params: Record<string, unknown> = { ...frozen };
  for (const [key, value] of Object.entries(live)) {
    if (value !== undefined) {
      params[key] = value;
    }
  }
  const liveSource = live.source;
  const frozenSource = frozen.source;
  const liveSourceUsable =
    liveSource !== undefined &&
    liveSource !== null &&
    typeof liveSource === "object";
  let usedFrozenSource = false;
  if (!liveSourceUsable) {
    if (frozenSource !== undefined && frozenSource !== null) {
      params.source = frozenSource;
      usedFrozenSource = true;
    } else if (liveSource === null) {
      // Explicit null and no freeze: keep null so adapters can treat as empty.
      params.source = null;
    }
  } else {
    params.source = liveSource;
  }
  return { params, usedFrozenSource };
}

function hasPanelTransferType(dataTransfer: DataTransfer): boolean {
  const types = dataTransfer.types;
  return types.includes(PANEL_TRANSFER_MIME) || types.includes("text/plain");
}

export function createWorkspacePanelTransferHandlers(
  getApi: () => DockviewApi | null
): WorkspacePanelTransferHandlers {
  return {
    onWillDragPanel(event) {
      const native = event.nativeEvent;
      if (!isRealDragEvent(native)) {
        return null;
      }
      const panel = event.panel;
      const component = panelComponentOf(panel);
      if (!component) {
        return null;
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
      const dragParams = panelParamsOf(panel);
      setActiveDrag({
        capability,
        componentId: component,
        params: dragParams,
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
      return transferId;
    },

    onUnhandledDragOver(event) {
      // Same-window active drag: Dockview owns reorder/split UX.
      if (getActiveDrag()) {
        return;
      }
      const native = event.nativeEvent;
      if (!(native instanceof DragEvent && native.dataTransfer)) {
        return;
      }
      if (!hasPanelTransferType(native.dataTransfer)) {
        return;
      }
      // Foreign Pier drag: accept so Dockview renders its drop overlay and
      // the OS reports a valid drop target.
      native.preventDefault();
      native.dataTransfer.dropEffect = "move";
      if (typeof event.accept === "function") {
        event.accept();
      }
    },

    onDidDrop(event) {
      // Same-window: never hijack Dockview reorder/split into a transfer.
      if (getActiveDrag()) {
        return;
      }
      const native = event.nativeEvent;
      if (!(native instanceof DragEvent && native.dataTransfer)) {
        return;
      }
      const transferId = readPanelTransferId(native.dataTransfer);
      if (!transferId) {
        return;
      }
      if (!getApi()) {
        return;
      }
      // WYSIWYG: Dockview already resolved which overlay it showed for this
      // drop; consuming the event state guarantees the claim matches it.
      const placement = resolvePlacementFromDidDrop(event);
      // Channel diagnostics: shows which claim path fired on real drags.
      console.info(
        "[panelTransfer] channel=html5-drop transfer=%s placement=%s",
        transferId,
        placement.kind
      );
      pierPanelTransfer()
        .drop({ placement, transferId })
        .then((result) => {
          if (!result || result.ok) {
            return;
          }
          if (result.code === "already_claimed") {
            // Bounds channel won the race — same outcome, stay silent.
            return;
          }
          showPanelTransferFailure(result).catch(() => undefined);
        })
        .catch((err) => {
          console.error("[panelTransfer] drop failed:", err);
        });
    },

    onWillDrop(event) {
      // dndOverlayMounting "absolute" arms a sticky overlay: dragleave keeps
      // the droptarget state, and dockview commits it when dragend reaches
      // the droptarget's element (root edge ring sits on the tab's ancestor
      // chain, so rip-out gestures that last crossed it hit this path). A
      // release OUTSIDE this window must not commit that stale in-window
      // move — the bounds channel (finishDrag) owns the outcome there
      // (another window or a new window). In-window releases keep dockview's
      // sticky-overlay drop.
      const native = event.nativeEvent;
      if (!(native instanceof DragEvent) || native.type !== "dragend") {
        return;
      }
      const { clientX, clientY } = native;
      const inside =
        clientX >= 0 &&
        clientY >= 0 &&
        clientX <= window.innerWidth &&
        clientY <= window.innerHeight;
      if (inside) {
        return;
      }
      event.preventDefault();
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
          // prepareSource only runs after a claim is accepted. When finishDrag
          // ends with no claim (null) or a terminal failure (not peer
          // already_claimed), drop the drag-start freeze so same-window
          // reorder/cancel cannot grow the map unbounded.
          // already_claimed / ok: claim path owns takeFrozenOfferParams.
          if (
            result == null ||
            (result && !result.ok && result.code !== "already_claimed")
          ) {
            discardFrozenOfferParams(id);
          }
          if (result) {
            console.info(
              "[panelTransfer] channel=bounds-finishDrag transfer=%s ok=%s",
              id,
              String(result.ok)
            );
          }
          if (result && !result.ok) {
            if (result.code === "already_claimed") {
              // HTML5 drop won during resolvePlacement await — same outcome.
              return;
            }
            showPanelTransferFailure(result).catch(() => undefined);
          }
        })
        .catch((err) => {
          discardFrozenOfferParams(id);
          console.error("[panelTransfer] finishDrag failed:", err);
        });
    },
  };
}
