import type { GitStatusEntry } from "@pierre/trees";
import type * as React from "react";
import {
  buildRowDecoration,
  resolveDirectoryLoadState,
  toOfficialPath,
} from "./file-tree-model.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
  PierFileTreeMove,
} from "./file-tree-types.ts";

export interface FileTreeRefs {
  decorationsByPath: ReadonlyMap<string, React.ReactNode>;
  directoryLoadStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>;
  loadableDirectoryPaths: ReadonlyMap<string, string>;
  onLoadDirectory: ((path: string) => Promise<void> | void) | undefined;
  onModelPathsRemoved: ((paths: readonly string[]) => void) | undefined;
  onMovePaths: ((moves: readonly PierFileTreeMove[]) => void) | undefined;
  onOpenPath: ((path: string) => void) | undefined;
  onRenamePath:
    | ((move: PierFileTreeMove & { isFolder: boolean }) => void)
    | undefined;
  onSelectPaths: ((paths: string[]) => void) | undefined;
}

export const EMPTY_REFS: FileTreeRefs = {
  decorationsByPath: new Map(),
  directoryLoadStatesByPath: new Map(),
  itemsByPath: new Map(),
  loadableDirectoryPaths: new Map(),
  onLoadDirectory: undefined,
  onModelPathsRemoved: undefined,
  onMovePaths: undefined,
  onOpenPath: undefined,
  onRenamePath: undefined,
  onSelectPaths: undefined,
};

export interface RenameViewState {
  getPath: () => string | null;
  isActive: () => boolean;
}

/** @pierre/trees 用 unique symbol 暴露 rename view,未进包 public exports。 */
export function readRenameView(model: object): RenameViewState | null {
  const proto = Object.getPrototypeOf(model) as object | null;
  if (!proto) {
    return null;
  }
  for (const symbol of Object.getOwnPropertySymbols(proto)) {
    if (String(symbol) !== "Symbol(FILE_TREE_RENAME_VIEW)") {
      continue;
    }
    const getter = (
      model as Record<symbol, (() => RenameViewState) | undefined>
    )[symbol];
    return typeof getter === "function" ? getter.call(model) : null;
  }
  return null;
}

/**
 * 从 items + directoryStates 构造 FileTreeRefs 的派生索引(decorations /
 * loadStates / itemsByPath / loadableDirectoryPaths)。回调字段留 undefined,
 * 由组件在每次 render 直接赋值最新 props。
 */
export function buildFileTreeRefs(
  items: readonly PierFileTreeItem[],
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined
): FileTreeRefs {
  const decorationsByPath = new Map<string, React.ReactNode>();
  const directoryLoadStatesByPath = new Map<string, PierDirectoryLoadState>();
  const itemsByPath = new Map<string, PierFileTreeItem>();
  const loadableDirectoryPaths = new Map<string, string>();

  for (const item of items) {
    const officialPath = toOfficialPath(item);

    itemsByPath.set(item.path, item);
    itemsByPath.set(officialPath, item);

    const directoryLoadState = resolveDirectoryLoadState(item, directoryStates);
    if (directoryLoadState != null) {
      directoryLoadStatesByPath.set(item.path, directoryLoadState);
      directoryLoadStatesByPath.set(officialPath, directoryLoadState);
      loadableDirectoryPaths.set(officialPath, item.path);
    }

    const decoration = buildRowDecoration(item, directoryStates);
    if (decoration != null) {
      decorationsByPath.set(item.path, decoration);
      decorationsByPath.set(officialPath, decoration);
    }
  }

  return {
    decorationsByPath,
    directoryLoadStatesByPath,
    itemsByPath,
    loadableDirectoryPaths,
    onLoadDirectory: undefined,
    onModelPathsRemoved: undefined,
    onMovePaths: undefined,
    onOpenPath: undefined,
    onRenamePath: undefined,
    onSelectPaths: undefined,
  };
}

/** 供组件 gitStatus useMemo 复用:items → 官方 path + status 数组。 */
export function itemsToGitStatusEntries(
  items: readonly PierFileTreeItem[]
): GitStatusEntry[] {
  return items.flatMap((item) =>
    item.gitStatus == null
      ? []
      : [{ path: toOfficialPath(item), status: item.gitStatus }]
  );
}
