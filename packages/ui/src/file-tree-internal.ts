import type { FileTreeCompositionOptions, GitStatusEntry } from "@pierre/trees";
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
  readonly decorationsByPath: ReadonlyMap<string, React.ReactNode>;
  readonly directoryLoadStatesByPath: ReadonlyMap<
    string,
    PierDirectoryLoadState
  >;
  readonly directoryPaths: ReadonlyMap<string, string>;
  readonly itemsByPath: ReadonlyMap<string, PierFileTreeItem>;
  readonly loadableDirectoryPaths: ReadonlyMap<string, string>;
  readonly onLoadDirectory:
    | ((path: string) => Promise<void> | void)
    | undefined;
  readonly onModelPathsRemoved:
    | ((paths: readonly string[]) => void)
    | undefined;
  readonly onMovePaths:
    | ((moves: readonly PierFileTreeMove[]) => void)
    | undefined;
  readonly onOpenItemContextMenu:
    | ((
        item: { kind: "directory" | "file"; path: string },
        point: { x: number; y: number }
      ) => void)
    | undefined;
  readonly onOpenPath: ((path: string) => void) | undefined;
  readonly onRenamePath:
    | ((move: PierFileTreeMove & { isFolder: boolean }) => void)
    | undefined;
  readonly onSelectPaths: ((paths: string[]) => void) | undefined;
}

export const EMPTY_REFS: FileTreeRefs = {
  decorationsByPath: new Map(),
  directoryPaths: new Map(),
  directoryLoadStatesByPath: new Map(),
  itemsByPath: new Map(),
  loadableDirectoryPaths: new Map(),
  onLoadDirectory: undefined,
  onModelPathsRemoved: undefined,
  onMovePaths: undefined,
  onOpenItemContextMenu: undefined,
  onOpenPath: undefined,
  onRenamePath: undefined,
  onSelectPaths: undefined,
};

function fileTreeContextMenuComposition(refs: {
  current: FileTreeRefs;
}): NonNullable<FileTreeCompositionOptions["contextMenu"]> {
  return {
    enabled: true,
    onOpen: (item, context) => {
      const callerItem = refs.current.itemsByPath.get(item.path);
      context.close({ restoreFocus: false });
      if (!callerItem) {
        return;
      }
      refs.current.onOpenItemContextMenu?.(
        { kind: callerItem.kind, path: callerItem.path },
        { x: context.anchorRect.x, y: context.anchorRect.y }
      );
    },
    triggerMode: "right-click",
  };
}

export function updateFileTreeContextMenuComposition(
  composition: FileTreeCompositionOptions | undefined,
  enabled: boolean,
  refs: { current: FileTreeRefs }
): FileTreeCompositionOptions {
  return {
    ...(enabled ? { contextMenu: fileTreeContextMenuComposition(refs) } : {}),
    ...(composition?.header ? { header: { ...composition.header } } : {}),
  };
}

export function fileTreeContextMenuOption(
  enabled: boolean,
  refs: { current: FileTreeRefs }
): { composition: FileTreeCompositionOptions } | Record<string, never> {
  if (!enabled) {
    return {};
  }
  return {
    composition: updateFileTreeContextMenuComposition(undefined, true, refs),
  };
}

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
 * loadStates / itemsByPath / loadableDirectoryPaths)。回调字段留 undefined，
 * 由组件在 layout effect 提交完整快照，避免并发 render 改写已提交对象。
 */
export function buildFileTreeRefs(
  items: readonly PierFileTreeItem[],
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined,
  directoryErrorLabel?: string
): FileTreeRefs {
  const decorationsByPath = new Map<string, React.ReactNode>();
  const directoryPaths = new Map<string, string>();
  const directoryLoadStatesByPath = new Map<string, PierDirectoryLoadState>();
  const itemsByPath = new Map<string, PierFileTreeItem>();
  const loadableDirectoryPaths = new Map<string, string>();

  for (const item of items) {
    const officialPath = toOfficialPath(item);

    itemsByPath.set(item.path, item);
    itemsByPath.set(officialPath, item);

    if (item.kind === "directory") {
      directoryPaths.set(officialPath, item.path);
    }

    const directoryLoadState = resolveDirectoryLoadState(item, directoryStates);
    if (directoryLoadState != null) {
      directoryLoadStatesByPath.set(item.path, directoryLoadState);
      directoryLoadStatesByPath.set(officialPath, directoryLoadState);
      loadableDirectoryPaths.set(officialPath, item.path);
    }

    const decoration = buildRowDecoration(
      item,
      directoryStates,
      directoryErrorLabel
    );
    if (decoration != null) {
      decorationsByPath.set(item.path, decoration);
      decorationsByPath.set(officialPath, decoration);
    }
  }

  return {
    decorationsByPath,
    directoryPaths,
    directoryLoadStatesByPath,
    itemsByPath,
    loadableDirectoryPaths,
    onLoadDirectory: undefined,
    onModelPathsRemoved: undefined,
    onMovePaths: undefined,
    onOpenItemContextMenu: undefined,
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
