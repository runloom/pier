/**
 * Cross-window panel transfer orchestration (renderer side).
 *
 * Path B: target identification is main-mediated. The renderer:
 *   1. On `onWillDragPanel` (real DragEvent + DataTransfer), stamps the Pier
 *      MIME + `text/plain` prefix + `effectAllowed=move` for movable panels,
 *      and calls `window.pier.panelTransfer.offer(...)` asynchronously.
 *      Unsupported panels offer `capability: "unsupported"` and write no token.
 *   2. On `onUnhandledDragOver`, if the drag carries the Pier MIME,
 *      `preventDefault` + `dropEffect=move` and call `event.accept()` if
 *      present. This lets Dockview show its drop overlay for same-window
 *      reorder/split AND lets main route a cross-window drop back here.
 *   3. On `onDidDrop`, compute placement (center+group → end tab; edge → split;
 *      no group → root) and call `window.pier.panelTransfer.drop(...)`. For
 *      same-window Dockview drags, Dockview has already moved the panel — the
 *      main `drop` will classify the source window and return `null` to the
 *      source's `finishDrag`.
 *   4. `dragend` → `finishDrag`; Escape → `cancel`.
 *
 * The four `panelTransfer.*` renderer commands (prepareSource / stageTarget /
 * releaseSource / finalize) are implemented in
 * `runPanelTransferRendererCommand` and wired into the renderer command
 * listener. They use `useWorkspaceStore.getState().api` and the
 * `panel-transfer-runtime` module for relocation suppression / frozen
 * snapshots / finalize idempotency.
 *
 * Implementation is split across:
 * - `workspace-panel-transfer-dnd.ts` — drag handlers + placement
 * - `workspace-panel-transfer-commands.ts` — prepare/stage/release/finalize
 * - `workspace-panel-transfer-shared.ts` — shared helpers
 */

import {
  isPanelRelocationSuppressed,
  setPanelRelocationSuppressed,
} from "./panel-transfer-runtime.ts";
import {
  computePlacementFromDrop,
  getActiveDrag,
  positionToDirection,
  setActiveDrag,
} from "./workspace-panel-transfer-dnd.ts";

export type { BootstrapPendingTransfer } from "./workspace-panel-transfer-commands.ts";
export {
  bootstrapPendingTransfers,
  runPanelTransferRendererCommand,
} from "./workspace-panel-transfer-commands.ts";
export type { WorkspacePanelTransferHandlers } from "./workspace-panel-transfer-dnd.ts";
export { createWorkspacePanelTransferHandlers } from "./workspace-panel-transfer-dnd.ts";

// Exported for tests.
export const __panelTransferInternals = {
  setActiveDrag,
  getActiveDrag,
  computePlacementFromDrop,
  positionToDirection,
  setPanelRelocationSuppressed,
  isPanelRelocationSuppressed,
};
