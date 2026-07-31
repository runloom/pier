import type { PanelContext } from "@shared/contracts/panel.ts";

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

const LINKED_WORKTREE_GIT_DIR_RE = /\/\.git\/worktrees\/[^/]+$/u;
const WORKTREES_PATH_SEGMENT_RE = /\/\.git\/worktrees\//u;

/**
 * Conservative linked-worktree detection.
 * Prefer gitDir vs gitCommonDir. When gitDir is missing (stale panel context),
 * fall back to other signals so worktreesEnabled:false is not bypassed.
 */
export function detectFilesLspIsWorktree(
  panelContext: PanelContext | null | undefined,
  rootPath: string
): boolean {
  if (!panelContext) {
    return false;
  }
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  const common = panelContext.gitCommonDir
    ? normalizeWorkspacePath(panelContext.gitCommonDir)
    : null;
  const gitDir = panelContext.gitDir
    ? normalizeWorkspacePath(panelContext.gitDir)
    : null;

  if (common && gitDir && common !== gitDir) {
    return true;
  }
  if (gitDir && LINKED_WORKTREE_GIT_DIR_RE.test(gitDir)) {
    return true;
  }
  if (
    panelContext.gitRoot &&
    panelContext.worktreeRoot &&
    normalizeWorkspacePath(panelContext.gitRoot) !==
      normalizeWorkspacePath(panelContext.worktreeRoot)
  ) {
    return true;
  }
  // Stale contexts may omit gitDir while still carrying commonDir / path shape.
  if (common && !gitDir) {
    if (WORKTREES_PATH_SEGMENT_RE.test(common)) {
      return true;
    }
    if (
      panelContext.worktreeKey &&
      panelContext.gitRoot &&
      normalizeWorkspacePath(panelContext.worktreeKey) !==
        normalizeWorkspacePath(panelContext.gitRoot)
    ) {
      return true;
    }
    if (
      normalizedRoot !== common.replace(/\/\.git$/u, "") &&
      panelContext.projectRootPath &&
      panelContext.gitRoot &&
      normalizeWorkspacePath(panelContext.projectRootPath) !==
        normalizeWorkspacePath(panelContext.gitRoot)
    ) {
      return true;
    }
  }
  return false;
}

export function filesLspWorkspaceIdentity(
  panelContext: PanelContext | null | undefined,
  rootPath: string
): { isWorktree: boolean; workspaceKey: string } {
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  const isWorktree = detectFilesLspIsWorktree(panelContext, normalizedRoot);
  return {
    isWorktree,
    workspaceKey: isWorktree
      ? `wt:${normalizeWorkspacePath(panelContext?.worktreeKey ?? normalizedRoot)}`
      : `main:${normalizedRoot}`,
  };
}
