import type { FileTreeCompositionOptions, GitStatusEntry } from "@pierre/trees";
import type * as React from "react";
import {
  buildRowDecoration,
  resolveDirectoryLoadState,
  stripTrailingSlash,
  toOfficialPath,
} from "./tree-model.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
  PierFileTreeMove,
} from "./tree-types.ts";

/** 右键菜单需要的最小 model 面（select / focus），由 PierFileTree 注入。 */
export interface FileTreeContextMenuModel {
  readonly focusPath: (path: string) => void;
  readonly getSelectedPaths: () => readonly string[];
  readonly selectOnlyPath: (path: string) => void;
}

/**
 * 树右键会话：Inspect（未选中 file → 选中并 open 一次）vs
 * Command（已选中 → 仅菜单，禁 open / 禁导航滚动）。
 */
export type FileTreeContextMenuSessionPhase = "begin" | "end";

export interface FileTreeRefs {
  readonly decorationsByPath: ReadonlyMap<string, React.ReactNode>;
  readonly directoryLoadStatesByPath: ReadonlyMap<
    string,
    PierDirectoryLoadState
  >;
  readonly directoryPaths: ReadonlyMap<string, string>;
  readonly fileTreeModel: FileTreeContextMenuModel | null;
  readonly isActiveOpenPath: ((path: string) => boolean) | undefined;
  readonly itemsByPath: ReadonlyMap<string, PierFileTreeItem>;
  readonly loadableDirectoryPaths: ReadonlyMap<string, string>;
  /**
   * 原生菜单会话：begin 在 popup 前、end 在 popup settle 后。
   * 宿主用 raw scrollTop 冻结 CodeView 等，禁止 item scrollTo。
   */
  readonly onContextMenuSession:
    | ((
        phase: FileTreeContextMenuSessionPhase,
        detail: {
          readonly intent: "inspect" | "command";
          readonly path: string;
        }
      ) => void)
    | undefined;
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
      ) => void | Promise<void>)
    | undefined;
  readonly onOpenPath: ((path: string) => void) | undefined;
  readonly onRenamePath:
    | ((move: PierFileTreeMove & { isFolder: boolean }) => void)
    | undefined;
  readonly onSelectPaths: ((paths: string[]) => void) | undefined;
  /**
   * Owner-backed menu pin (user claim aborts). Injected by PierFileTree.
   * Falls back to no-op when unset (tests without scroll owner).
   */
  pinContextMenuScroll:
    | ((anchor: Element | null | undefined) => () => void)
    | undefined;
  /**
   * Command / 菜单会话期间：禁止 selection→onOpenPath。
   * 生命周期 = 菜单打开到 close settle，不是 one-shot consume。
   */
  suppressOpenPathFromContextMenu: boolean;
}

export const EMPTY_REFS: FileTreeRefs = {
  decorationsByPath: new Map(),
  directoryPaths: new Map(),
  directoryLoadStatesByPath: new Map(),
  fileTreeModel: null,
  itemsByPath: new Map(),
  loadableDirectoryPaths: new Map(),
  onLoadDirectory: undefined,
  onModelPathsRemoved: undefined,
  onMovePaths: undefined,
  onOpenItemContextMenu: undefined,
  onOpenPath: undefined,
  isActiveOpenPath: undefined,
  onRenamePath: undefined,
  onSelectPaths: undefined,
  onContextMenuSession: undefined,
  pinContextMenuScroll: undefined,
  suppressOpenPathFromContextMenu: false,
};

function isOfficialPathSelected(
  model: FileTreeContextMenuModel,
  officialPath: string
): boolean {
  const normalized = stripTrailingSlash(officialPath);
  return model
    .getSelectedPaths()
    .some((path) => stripTrailingSlash(path) === normalized);
}

/**
 * 右键目标 path 可能与 items 索引写法略有出入（尾斜杠 / 组前缀）。
 * 用 pierre 给出的 item.path 优先，再尝试 caller 官方 path。
 * Inspect：只 select，不 focus（focus 会 sticky scrollIntoView）。
 */
function selectContextMenuTarget(
  model: FileTreeContextMenuModel,
  pierrePath: string,
  callerItem: PierFileTreeItem | undefined
): string | null {
  const candidates = [
    pierrePath,
    stripTrailingSlash(pierrePath),
    pierrePath.endsWith("/") ? pierrePath.slice(0, -1) : `${pierrePath}/`,
    ...(callerItem
      ? [
          toOfficialPath(callerItem),
          callerItem.path,
          stripTrailingSlash(callerItem.path),
        ]
      : []),
  ];
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.length === 0 || tried.has(candidate)) {
      continue;
    }
    tried.add(candidate);
    model.selectOnlyPath(candidate);
    if (isOfficialPathSelected(model, candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCallerItem(
  refs: FileTreeRefs,
  pierrePath: string
): PierFileTreeItem | undefined {
  return (
    refs.itemsByPath.get(pierrePath) ??
    refs.itemsByPath.get(stripTrailingSlash(pierrePath)) ??
    refs.itemsByPath.get(
      pierrePath.endsWith("/") ? pierrePath.slice(0, -1) : `${pierrePath}/`
    )
  );
}

function endContextMenuSession(
  refs: { current: FileTreeRefs },
  detail: { readonly intent: "inspect" | "command"; readonly path: string },
  unpinTree: () => void
): void {
  refs.current.suppressOpenPathFromContextMenu = false;
  unpinTree();
  refs.current.onContextMenuSession?.("end", detail);
  // 菜单关闭后：只保证 selected；不 focusPath（会 sticky scrollIntoView 带动布局）。
  // 若 selected 被冲掉，在 suppress 下补选且不 open。
  const liveModel = refs.current.fileTreeModel;
  if (!liveModel) {
    return;
  }
  if (!isOfficialPathSelected(liveModel, detail.path)) {
    refs.current.suppressOpenPathFromContextMenu = true;
    liveModel.selectOnlyPath(detail.path);
    queueMicrotask(() => {
      refs.current.suppressOpenPathFromContextMenu = false;
    });
  }
}

function fileTreeContextMenuComposition(refs: {
  current: FileTreeRefs;
}): NonNullable<FileTreeCompositionOptions["contextMenu"]> {
  return {
    enabled: true,
    onOpen: (item, context) => {
      // Capture before close: pierre may still scrollIntoView in a later layout
      // effect of this commit (stickyFolders + focus). Restore before paint.
      const unpinTree =
        refs.current.pinContextMenuScroll?.(context.anchorElement) ??
        (() => undefined);
      const snapshot = refs.current;
      const callerItem = resolveCallerItem(snapshot, item.path);
      const model = snapshot.fileTreeModel;
      let targetPath =
        callerItem === undefined ? item.path : toOfficialPath(callerItem);
      // Command = 树已选中 或 宿主 B-Select 已打开该 path；Inspect = 否则。
      const treeSelected =
        model !== null &&
        (isOfficialPathSelected(model, item.path) ||
          (callerItem !== undefined &&
            isOfficialPathSelected(model, toOfficialPath(callerItem))));
      const hostOpen =
        callerItem !== undefined &&
        snapshot.isActiveOpenPath?.(callerItem.path) === true;
      const alreadySelected = treeSelected || hostOpen;
      const intent: "inspect" | "command" = alreadySelected
        ? "command"
        : "inspect";

      // 整段菜单会话 suppress open（非 one-shot consume）。
      refs.current.suppressOpenPathFromContextMenu = true;

      if (model) {
        if (intent === "command") {
          // Command：保持 L-Select；不 focusPath（避免 sticky 滚树/抖布局）。
        } else {
          // Inspect：select；open 在下方显式调用。
          targetPath =
            selectContextMenuTarget(model, item.path, callerItem) ?? targetPath;
        }
      }

      // Electron 原生菜单会抢 web 焦点；库内菜单态立刻关掉且不 restore。
      context.close({ restoreFocus: false });
      const menuItem = callerItem
        ? { kind: callerItem.kind, path: callerItem.path }
        : {
            kind:
              item.kind === "directory"
                ? ("directory" as const)
                : ("file" as const),
            path: item.path,
          };

      // Inspect file：显式 open 一次（允许 scrollToItem）。
      // 必须在 Freeze begin 之前，否则 end 会把导航后的 scrollTop 钉回旧值。
      if (
        intent === "inspect" &&
        menuItem.kind === "file" &&
        snapshot.onOpenPath
      ) {
        snapshot.onOpenPath(menuItem.path);
      }

      // Freeze：Command 钉当前视口；Inspect 钉 open 之后的视口（菜单期间保持）。
      snapshot.onContextMenuSession?.("begin", { intent, path: targetPath });

      const menuResult = snapshot.onOpenItemContextMenu?.(menuItem, {
        x: context.anchorRect.x,
        y: context.anchorRect.y,
      });
      Promise.resolve(menuResult)
        .catch(() => undefined)
        .finally(() => {
          endContextMenuSession(refs, { intent, path: targetPath }, unpinTree);
        });
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
      proto as Record<symbol, (() => RenameViewState) | undefined>
    )[symbol];
    if (typeof getter !== "function") {
      continue;
    }
    try {
      const view = getter.call(model);
      if (
        view &&
        typeof view.getPath === "function" &&
        typeof view.isActive === "function"
      ) {
        return view;
      }
    } catch {
      // ignore
    }
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
    fileTreeModel: null,
    itemsByPath,
    loadableDirectoryPaths,
    onLoadDirectory: undefined,
    onModelPathsRemoved: undefined,
    onMovePaths: undefined,
    onOpenItemContextMenu: undefined,
    onOpenPath: undefined,
    isActiveOpenPath: undefined,
    onRenamePath: undefined,
    onSelectPaths: undefined,
    onContextMenuSession: undefined,
    pinContextMenuScroll: undefined,
    suppressOpenPathFromContextMenu: false,
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
