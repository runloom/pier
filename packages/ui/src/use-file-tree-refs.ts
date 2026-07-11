import * as React from "react";
import {
  buildFileTreeRefs,
  EMPTY_REFS,
  type FileTreeRefs,
} from "./file-tree-internal.ts";
import type { PierFileTreeProps } from "./file-tree-types.ts";

interface FileTreeRefOptions {
  directoryErrorLabel: PierFileTreeProps["directoryErrorLabel"];
  directoryStates: PierFileTreeProps["directoryStates"];
  items: PierFileTreeProps["items"];
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
      onRenamePath,
      onSelectPaths,
    ]
  );
  React.useLayoutEffect(() => {
    refs.current = nextRefs;
  }, [nextRefs]);
  const readRefs = React.useCallback(() => refs.current, []);
  return { nextRefs, readRefs, refs };
}
