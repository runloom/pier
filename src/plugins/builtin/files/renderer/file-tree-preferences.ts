import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useEffect, useState } from "react";

const TREE_COLLAPSED_STORAGE_PREFIX = "pier.files.filePanel.treeCollapsed:";

function treePreferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function treePreferenceKey(root: string): string {
  return `${TREE_COLLAPSED_STORAGE_PREFIX}${root}`;
}

function readTreeCollapsed(root: string | null): boolean {
  if (!root) {
    return false;
  }
  return treePreferenceStorage()?.getItem(treePreferenceKey(root)) === "true";
}

function writeTreeCollapsed(root: string, collapsed: boolean): void {
  treePreferenceStorage()?.setItem(treePreferenceKey(root), String(collapsed));
}

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

export function useProjectFileTreeCollapsed(
  root: string | null
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() =>
    readTreeCollapsed(root)
  );

  useEffect(() => {
    setCollapsedState(readTreeCollapsed(root));
  }, [root]);

  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      setCollapsedState(nextCollapsed);
      if (root) {
        writeTreeCollapsed(root, nextCollapsed);
      }
    },
    [root]
  );

  return [collapsed, setCollapsed];
}
