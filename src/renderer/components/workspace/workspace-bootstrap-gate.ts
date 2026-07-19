/**
 * Bootstrap gate: when a pending cross-window transfer is being restored into
 * this window, block workspace mutations (shortcuts, plugin add-close, user
 * scheduler) while transfer commands (stageTarget / releaseSource / finalize
 * + explicit flush) still run.
 *
 * The gate is set when `handleReady` finds pending transfers in
 * `window.pier.panelTransfer.bootstrap()` and released after either:
 *   - rollback completes (transfer aborted), or
 *   - target reaches `target-active` (transfer committed + active).
 *
 * The gate is a simple boolean flag stored here; the workspace-host reads it
 * via `isWorkspaceBootstrapGateActive()` to short-circuit keybinding handlers,
 * plugin lifecycle barriers, and the layout-save scheduler. Transfer renderer
 * commands bypass the gate.
 */

import { isWorkspaceBootstrapGateActive as runtimeGateActive } from "./panel-transfer-runtime.ts";

export function isWorkspaceBootstrapGateActive(): boolean {
  return runtimeGateActive();
}

export {
  getWorkspaceBootstrapGate,
  releaseWorkspaceBootstrapGate,
  setWorkspaceBootstrapGate,
} from "./panel-transfer-runtime.ts";
