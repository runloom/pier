import type { SortAgentIndexEntriesOptions } from "@shared/contracts/agent-runtime-index.ts";
import { currentElectronWindowId } from "@/lib/agent-runtime/current-window-id.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { terminalPanelContext } from "@/stores/workspace-panel-helpers.ts";

/** 打开列表 / focusWaiting 共用的同窗 + 当前工作区加权参数。 */
export function preferredAgentIndexSortOptions(): SortAgentIndexEntriesOptions {
  const preferredWindowId = currentElectronWindowId();
  const activePanelId = useKeybindingScope.getState().activePanelId;
  const projectRootPath = activePanelId
    ? terminalPanelContext(activePanelId)?.projectRootPath
    : undefined;
  return {
    ...(preferredWindowId ? { preferredWindowId } : {}),
    ...(projectRootPath ? { preferredProjectRootPath: projectRootPath } : {}),
  };
}
