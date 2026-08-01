import * as React from "react";
import {
  buildFileTreeRefs,
  EMPTY_REFS,
  type FileTreeRefs,
} from "./tree-internal.ts";
import type { PierFileTreeProps } from "./tree-types.ts";

interface FileTreeRefOptions {
  directoryErrorLabel: PierFileTreeProps["directoryErrorLabel"];
  directoryStates: PierFileTreeProps["directoryStates"];
  isActiveOpenPath: PierFileTreeProps["isActiveOpenPath"];
  items: PierFileTreeProps["items"];
  onContextMenuSession: PierFileTreeProps["onContextMenuSession"];
  onLoadDirectory: PierFileTreeProps["onLoadDirectory"];
  onModelPathsRemoved: PierFileTreeProps["onModelPathsRemoved"];
  onMovePaths: PierFileTreeProps["onMovePaths"];
  onOpenItemContextMenu: PierFileTreeProps["onOpenItemContextMenu"];
  onOpenPath: PierFileTreeProps["onOpenPath"];
  onRenamePath: PierFileTreeProps["onRenamePath"];
  onSelectPaths: PierFileTreeProps["onSelectPaths"];
}

export function useFileTreeRefs(options: FileTreeRefOptions): {
  readRefs: () => FileTreeRefs;
  nextRefs: FileTreeRefs;
  refs: React.RefObject<FileTreeRefs>;
} {
  const {
    directoryErrorLabel,
    directoryStates,
    items,
    onLoadDirectory,
    onModelPathsRemoved,
    onMovePaths,
    onOpenItemContextMenu,
    onOpenPath,
    isActiveOpenPath,
    onContextMenuSession,
    onRenamePath,
    onSelectPaths,
  } = options;
  const refs = React.useRef<FileTreeRefs>(EMPTY_REFS);
  const nextRefs = React.useMemo<FileTreeRefs>(
    () => ({
      ...buildFileTreeRefs(items, directoryStates, directoryErrorLabel),
      onLoadDirectory,
      onModelPathsRemoved,
      onMovePaths,
      onOpenItemContextMenu,
      onOpenPath,
      isActiveOpenPath,
      onContextMenuSession,
      onRenamePath,
      onSelectPaths,
    }),
    [
      directoryErrorLabel,
      directoryStates,
      items,
      onLoadDirectory,
      onModelPathsRemoved,
      onMovePaths,
      onOpenItemContextMenu,
      onOpenPath,
      isActiveOpenPath,
      onContextMenuSession,
      onRenamePath,
      onSelectPaths,
    ]
  );
  React.useLayoutEffect(() => {
    // 保留 context-menu 抑制位与 model 注入：nextRefs 重建时不能清掉。
    const suppressOpenPathFromContextMenu =
      refs.current.suppressOpenPathFromContextMenu;
    const fileTreeModel = refs.current.fileTreeModel;
    refs.current = {
      ...nextRefs,
      fileTreeModel,
      suppressOpenPathFromContextMenu,
    };
  }, [nextRefs]);
  const readRefs = React.useCallback(() => refs.current, []);
  return { nextRefs, readRefs, refs };
}
