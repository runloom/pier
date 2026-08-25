import { togglePanelSidebarCollapsed } from "@pier/ui/use-panel-sidebar-preference.tsx";

/** Must match `usePanelSidebarCollapsed` prefix in changes-panel. */
export const REVIEW_TREE_COLLAPSED_STORAGE_PREFIX =
  "pier.git.review.treeCollapsed:";

/** Toggle the git review changed-files tree sidebar. Returns false if no root. */
export function toggleGitReviewTreeSidebar(
  gitRootPath: string | null
): boolean {
  return (
    togglePanelSidebarCollapsed(
      REVIEW_TREE_COLLAPSED_STORAGE_PREFIX,
      gitRootPath
    ) !== null
  );
}
