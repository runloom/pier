/**
 * Active Git review tree expand/collapse hooks (panel-local).
 * Context-menu actions call through this (no toolbar, no default shortcuts).
 */

type TreeFolderAction = (rootPath?: string) => void;

let activeCollapseAll: TreeFolderAction | null = null;
let activeExpandAll: TreeFolderAction | null = null;

/** Register the active panel's expand/collapse handlers (not command IDs). */
export function registerGitReviewTreeFolderHandlers(options: {
  collapseAll: TreeFolderAction;
  expandAll: TreeFolderAction;
}): () => void {
  const { collapseAll, expandAll } = options;
  activeCollapseAll = collapseAll;
  activeExpandAll = expandAll;
  return () => {
    if (activeCollapseAll === collapseAll) {
      activeCollapseAll = null;
    }
    if (activeExpandAll === expandAll) {
      activeExpandAll = null;
    }
  };
}

export function collapseGitReviewTreeFolders(rootPath?: string): boolean {
  if (!activeCollapseAll) {
    return false;
  }
  activeCollapseAll(rootPath);
  return true;
}

export function expandGitReviewTreeFolders(rootPath?: string): boolean {
  if (!activeExpandAll) {
    return false;
  }
  activeExpandAll(rootPath);
  return true;
}
