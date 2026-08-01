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

/** Normalize roots for equality (trailing slashes). */
export function normalizeFileRootPath(path: string): string {
  if (path.length <= 1) {
    return path;
  }
  return path.replace(/\/+$/, "");
}

export function fileRootsEqual(left: string, right: string): boolean {
  return normalizeFileRootPath(left) === normalizeFileRootPath(right);
}

/**
 * Active-file path for tree reveal: disk source under the same project root
 * as the sidebar (trailing-slash tolerant).
 */
export function activeFilePathForTree(options: {
  root: string | null | undefined;
  source:
    | { kind: "disk"; path: string; root: string }
    | { kind: string }
    | null
    | undefined;
}): string | null {
  const { root, source } = options;
  if (!(root && source && source.kind === "disk")) {
    return null;
  }
  if (!("path" in source && "root" in source)) {
    return null;
  }
  if (!fileRootsEqual(source.root, root)) {
    return null;
  }
  return source.path;
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
