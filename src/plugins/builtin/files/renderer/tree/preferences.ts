import {
  usePanelSidebarCollapsed,
  writePanelSidebarCollapsed,
} from "@pier/ui/use-panel-sidebar-preference.tsx";
import type { PanelContext } from "@shared/contracts/panel.ts";

const TREE_COLLAPSED_STORAGE_PREFIX = "pier.files.filePanel.treeCollapsed:";

export function filePanelProjectRoot(
  context: PanelContext | null | undefined
): string | null {
  return (
    context?.projectRootPath ??
    context?.worktreeRoot ??
    context?.gitRoot ??
    context?.cwd ??
    context?.openedPath ??
    null
  );
}

export function projectNameFromRoot(root: string): string {
  return root.split("/").filter(Boolean).at(-1) ?? root;
}
export function ensureProjectFileTreeExpanded(root: string): void {
  writePanelSidebarCollapsed(TREE_COLLAPSED_STORAGE_PREFIX, root, false);
}

export function useProjectFileTreeCollapsed(
  root: string | null
): [boolean, (collapsed: boolean) => void] {
  return usePanelSidebarCollapsed(TREE_COLLAPSED_STORAGE_PREFIX, root);
}
