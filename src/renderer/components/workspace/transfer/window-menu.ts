/**
 * Dispatch encoded tab-menu relocate actions (`pier.panel.moveToWindow:<id>`).
 * Template expansion lives in lib/context-menu/expand-window-relocate.ts so
 * the menu popup path does not import relocate (cycle via terminal panel).
 */

import type { ActionInvocation } from "@/lib/actions/types.ts";
import { parseWindowRelocateMenuAction } from "@/lib/context-menu/expand-window-relocate.ts";
import {
  copyPanelToWindow,
  movePanelToWindow,
  resolveRelocatePanelId,
} from "./relocate.ts";

export {
  COPY_TO_WINDOW_ACTION_ID,
  expandWindowRelocateMenu,
  formatWindowMenuLabel,
  MOVE_TO_WINDOW_ACTION_ID,
  parseWindowRelocateMenuAction,
  type WindowRelocateKind,
} from "@/lib/context-menu/expand-window-relocate.ts";

export async function dispatchWindowRelocateMenuAction(
  actionId: string,
  invocation?: ActionInvocation
): Promise<boolean> {
  const parsed = parseWindowRelocateMenuAction(actionId);
  if (!parsed) {
    return false;
  }
  const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
  if (!panelId) {
    return true;
  }
  if (parsed.kind === "move") {
    await movePanelToWindow(panelId, parsed.windowId);
  } else {
    await copyPanelToWindow(panelId, parsed.windowId);
  }
  return true;
}
