/**
 * Cross-window panel transfer orchestration (renderer side).
 *
 * Dual-trigger claim (see `workspace-panel-transfer-dnd.ts`):
 *   1. On `onWillDragPanel` (real DragEvent + DataTransfer), stamps the Pier
 *      MIME + `text/plain` prefix + `effectAllowed=move` for movable panels,
 *      and calls `window.pier.panelTransfer.offer(...)` asynchronously.
 *      Unsupported panels offer `capability: "unsupported"` and write no token.
 *   2. Same-window reorder/split stays with Dockview (no Pier claim).
 *   3. HTML5 channel: the target window's `onDidDrop` claims with the
 *      placement Dockview resolved for the drop (WYSIWYG with the overlay).
 *   4. Bounds channel (Path B fallback): `dragend` → `finishDrag`; main
 *      classifies the cursor against window bounds, and managed targets
 *      receive `panelTransfer.resolvePlacement` with client coordinates.
 *      Escape/system cancel is detected in main via
 *      `isLeftMouseButtonDown()` (button still down at dragend).
 *      The window dragend listener is CAPTURE-phase: dockview droptargets
 *      stopPropagation() when committing a sticky overlay on dragend.
 *   5. Outside-release guard: `onWillDrop` preventDefault()s dockview's
 *      sticky-overlay dragend commit when the release point is outside the
 *      window viewport, so rip-out drags never phantom-move in-window.
 *   6. Live overlay (Path B): main polls the cursor and broadcasts
 *      `panel-transfer:overlay-preview`. Source hide is a dockview-core
 *      patch (document `dragleave` clears the absolute overlay). The hovered
 *      foreign window drives Dockview `contentDropTarget.showOverlay`.
 *      Tear-off: leaving all Pier windows hides the source tab so dragend
 *      cannot snap it back; capture-phase dragend also hides using the
 *      release point. The new window's native chrome is revealed at claim
 *      time (`revealHost`), not after renderer boot.
 *
 * The `panelTransfer.*` renderer commands (prepareSource / stageTarget /
 * releaseSource / finalize / resolvePlacement) are implemented in
 * `runPanelTransferRendererCommand` and wired into the renderer command
 * listener.
 *
 * Implementation is split across:
 * - `workspace-panel-transfer-dnd.ts` — drag handlers
 * - `workspace-panel-transfer-placement.ts` — drop event / client-point → placement
 * - `workspace-panel-transfer-commands.ts` — prepare/stage/release/finalize
 * - `workspace-panel-transfer-shared.ts` — shared helpers
 */

import {
  clearFrozenOfferParamsForTests,
  discardFrozenOfferParams,
  frozenOfferParamsSizeForTests,
  getActiveDrag,
  mergeDragStartPanelParams,
  setActiveDrag,
  takeFrozenOfferParams,
} from "./dnd.ts";
import {
  positionToDirection,
  resolvePlacementFromDidDrop,
} from "./placement.ts";
import {
  isPanelRelocationSuppressed,
  setPanelRelocationSuppressed,
} from "./runtime.ts";

export type { BootstrapPendingTransfer } from "./commands.ts";
export {
  bootstrapPendingTransfers,
  runPanelTransferRendererCommand,
} from "./commands.ts";
export type { WorkspacePanelTransferHandlers } from "./dnd.ts";
export {
  createWorkspacePanelTransferHandlers,
  mergeDragStartPanelParams,
} from "./dnd.ts";
export {
  resolvePlacementFromClientPoint,
  resolvePlacementFromDidDrop,
} from "./placement.ts";
export {
  canCopyPanelToWindow,
  canMovePanelToWindow,
  copyPanelToNewWindow,
  copyPanelToOtherWindow,
  copyPanelToWindow,
  movePanelToNewWindow,
  movePanelToOtherWindow,
  movePanelToWindow,
  relocatePanel,
  resolveRelocatePanelId,
} from "./relocate.ts";

// Exported for tests.
export const __panelTransferInternals = {
  setActiveDrag,
  getActiveDrag,
  takeFrozenOfferParams,
  discardFrozenOfferParams,
  frozenOfferParamsSizeForTests,
  clearFrozenOfferParamsForTests,
  mergeDragStartPanelParams,
  resolvePlacementFromDidDrop,
  positionToDirection,
  setPanelRelocationSuppressed,
  isPanelRelocationSuppressed,
};
