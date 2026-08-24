import type { PanelContext } from "@shared/contracts/panel.ts";

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function sameReviewProject(
  source: PanelContext,
  contextId: string,
  gitRootPath: string
): boolean {
  if (source.contextId === contextId) {
    return true;
  }
  return (
    source.gitRoot === gitRootPath ||
    source.worktreeRoot === gitRootPath ||
    source.projectRootPath === gitRootPath ||
    source.cwd === gitRootPath
  );
}

/**
 * Build a terminal-ready PanelContext when opening files from git Review.
 *
 * Review metadata only carries contextId + gitRootPath. Without cwd /
 * worktree anchors, the opened file panel keeps projectRootPath but new
 * terminals/agents resolve shell cwd as empty. Prefer a full source panel
 * context when it maps to the same review project; always fill cwd.
 */
export function panelContextFromReviewGitRoot(options: {
  readonly contextId: string;
  readonly gitRootPath: string;
  readonly now?: () => number;
  readonly sourcePanelContext?: PanelContext | null;
}): PanelContext {
  const now = options.now ?? Date.now;
  const root = options.gitRootPath;
  const source = options.sourcePanelContext;

  if (source && sameReviewProject(source, options.contextId, root)) {
    const projectRoot =
      nonEmpty(source.projectRootPath) ??
      nonEmpty(source.worktreeRoot) ??
      nonEmpty(source.gitRoot) ??
      root;
    const cwd =
      nonEmpty(source.cwd) ??
      nonEmpty(source.worktreeRoot) ??
      nonEmpty(source.gitRoot) ??
      projectRoot;
    const worktreeRoot =
      nonEmpty(source.worktreeRoot) ?? nonEmpty(source.gitRoot) ?? root;
    return {
      ...source,
      contextId: nonEmpty(source.contextId) ?? options.contextId,
      cwd,
      gitRoot: nonEmpty(source.gitRoot) ?? root,
      projectRootPath: projectRoot,
      source: source.source ?? "panel",
      updatedAt: now(),
      worktreeKey:
        nonEmpty(source.worktreeKey) ??
        nonEmpty(source.worktreeRoot) ??
        nonEmpty(source.gitRoot) ??
        root,
      worktreeRoot,
    };
  }

  return {
    contextId: options.contextId,
    cwd: root,
    gitRoot: root,
    projectRootPath: root,
    source: "panel",
    updatedAt: now(),
    worktreeKey: root,
    worktreeRoot: root,
  };
}
