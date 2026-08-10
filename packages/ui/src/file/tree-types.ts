import type { GitStatus as PierreGitStatus } from "@pierre/trees";
import type * as React from "react";
import type { TreeExpansionSeed } from "./tree-expansion-apply.ts";
import type {
  TreeExpansionAuthority,
  TreeExpansionIntent,
} from "./tree-expansion-authority.ts";

export type { TreeExpansionSeed } from "./tree-expansion-apply.ts";
export type {
  TreeExpansionAuthority,
  TreeExpansionIntent,
} from "./tree-expansion-authority.ts";

export type PierDirectoryLoadState =
  | "unloaded"
  | "loading"
  | "loaded"
  | "dirty"
  | "empty"
  | "error";

export type PierFileTreeGitStatus = PierreGitStatus;

export interface PierFileTreeItem {
  gitStatus?: PierFileTreeGitStatus;
  hasChildren?: boolean | "unknown";
  kind: "directory" | "file";
  loadState?: PierDirectoryLoadState;
  path: string;
  trailingDecoration?: React.ReactNode;
}

export interface PierFileTreeMove {
  from: string;
  to: string;
}

export interface PierFileTreeContextMenuItem {
  kind: "directory" | "file";
  path: string;
}

export interface PierFileTreeContextMenuPoint {
  x: number;
  y: number;
}

/** 树内命令入口(inline rename / 树内查找 / 定位),由业务层经 ref 触发。 */
export interface PierFileTreeApi {
  /** 打开当前聚焦的文件搜索匹配；无可打开文件时返回 false。 */
  activateFocusedSearchMatch: () => boolean;
  /**
   * 回滚一次库已先行应用的重命名/拖拽（业务侧磁盘操作失败时）：
   * 从模型移除幽灵路径并恢复原路径，一步 batch 完成。
   */
  applyPathRollback: (
    removedPaths: readonly string[],
    restoredPaths: readonly string[]
  ) => void;
  /**
   * Collapse directories. With `rootPath`, only that folder and descendants;
   * otherwise the whole tree.
   */
  collapseAll: (options?: PierFileTreeCollapseAllOptions) => void;
  /**
   * Expand folders (BFS + lazy load). With `rootPath`, only that folder and
   * descendants; otherwise the whole tree. Never collapses unrelated folders.
   */
  expandAll: (options?: PierFileTreeExpandAllOptions) => void;
  /**
   * @deprecated Prefer expandAll. Same as expandAll({ recursive: false }) when
   * recursive is omitted as false; default recursive matches Expand All.
   */
  expandKnownDirectories: (options?: PierFileTreeExpandAllOptions) => void;
  focusSearchMatch: (direction: "next" | "previous") => void;
  getExpansionIntent: () => TreeExpansionIntent | null;
  getSearchMatchCount: () => number;
  /** 从模型移除路径(新建落盘失败回滚幽灵节点用)。 */
  removePaths: (paths: readonly string[]) => void;
  /**
   * VS Code-like reveal: expand ancestors, expand folder targets, select+focus
   * (focus ring), then scroll. Does not open files.
   * @returns true when the path was selectable immediately; false keeps a pending retry.
   */
  revealPath: (path: string, options?: PierFileTreeRevealOptions) => boolean;
  /** null = 关闭搜索并恢复完整投影。搜索 UI 由业务层自绘(不用库内置头)。 */
  setSearch: (value: string | null) => void;
  /**
   * 进入 inline rename。`removeIfCanceled: true` 时 Esc/空提交会从模型移除该路径
   * （新建占位流用）。
   */
  startRenaming: (
    path: string,
    options?: { removeIfCanceled?: boolean }
  ) => boolean;
}

/** Safety caps for Expand All (performance-bounded). */
export interface PierFileTreeExpandAllOptions {
  /** Max concurrent onLoadDirectory calls. Default 8. */
  maxConcurrentLists?: number;
  /** Absolute path segment depth from repo root. Default 64. */
  maxDepth?: number;
  /** Max directories to expand in one run. Default 2000. */
  maxDirectoryExpands?: number;
  /**
   * Max folder levels relative to expand root. Default 3.
   * 1 = only open the start folder; 3 = start + two nested levels.
   */
  maxExpandLevels?: number;
  /**
   * When true (default), BFS into newly listed children (within level cap).
   * When false, only expand directories already in the current path set.
   */
  recursive?: boolean;
  /**
   * Scope expand to this directory and its descendants.
   * Omit / empty = whole tree (background menu).
   */
  rootPath?: string;
}

export interface PierFileTreeCollapseAllOptions {
  /**
   * Scope collapse to this directory and its descendants.
   * Omit / empty = whole tree.
   */
  rootPath?: string;
}

/**
 * Scroll alignment for reveal.
 * - `nearest` / `center` / `top`: passed to `@pierre/trees` scrollToPath
 * - `none`: select + focus only (autoReveal `select`, inspect)
 */
export type PierFileTreeRevealScroll = "nearest" | "center" | "top" | "none";

/**
 * Why this reveal ran. Defaults come from `resolveRevealPolicy` (single owner).
 * - explicit / search: user action → center
 * - active-file: follow editor → nearest | select | off
 * - root: project root → top
 * - inspect: context-menu inspect (not full reveal pipeline)
 */
export type PierFileTreeRevealIntent =
  | "explicit"
  | "active-file"
  | "root"
  | "search"
  | "inspect";

/** Active-file auto-reveal mode (VS Code explorer.autoReveal analogue). */
export type PierFileTreeAutoRevealMode = "on" | "select" | "off";

export interface PierFileTreeRevealOptions {
  /** Expand the target when it is a directory. Policy default depends on intent. */
  expandTarget?: boolean;
  /**
   * Reveal intent. When omitted, empty path → `root`, else `explicit`
   * (API / breadcrumb). Active-file prop always passes `active-file`.
   */
  intent?: PierFileTreeRevealIntent;
  /**
   * Keep DOM focus where it is; select + scroll without pulling the focus ring.
   *
   * Reveal normally focuses the row because trees only paints the ring when the
   * row button holds DOM focus, and it re-focuses across a microtask and two
   * frames to win against re-renders. That focus grab is correct for tree-driven
   * reveals but wrong when the user is still typing somewhere else: the search
   * bar navigates on Enter and stays open, so a following Escape would land on
   * the tree instead of closing the bar.
   */
  preserveFocus?: boolean;
  /**
   * Scroll alignment. Defaults from `resolveRevealPolicy(intent)` when omitted.
   * Prefer leaving unset so policy stays the single owner.
   */
  scroll?: PierFileTreeRevealScroll;
}

export type PierFileTreeScrollSnapshot =
  | {
      fallbackScrollTop: number;
      kind: "anchor";
      path: string;
      topOffset: number;
    }
  | {
      fallbackScrollTop: number;
      kind: "position";
    };

export interface PierFileTreeScrollController {
  /** @deprecated Alias of beginReveal */
  beginProgrammaticScroll: () => void;
  /**
   * Enter reveal intent: suppress path-sync layout compensate and abort
   * in-flight compensate so scrollToPath sticks.
   */
  beginReveal: () => void;
  captureSnapshot: () => PierFileTreeScrollSnapshot | null;
  /** @deprecated Alias of endReveal */
  endProgrammaticScroll: () => void;
  endReveal: () => void;
  /**
   * Path-sync layout compensate entry (condition checked by caller via
   * shouldCompensateScroll). Aborted by user gesture / reveal.
   */
  requestLayoutCompensate: (
    snapshot: PierFileTreeScrollSnapshot | null,
    options?: { readonly settleFrames?: number }
  ) => void;
  restoreSnapshot: (snapshot: PierFileTreeScrollSnapshot) => void;
}

export interface PierFileTreeProps
  extends Omit<React.ComponentProps<"div">, "children" | "onSelect"> {
  /**
   * Active-file auto-reveal mode when `revealPath` changes.
   * Default `"on"` (select + nearest scroll). Explicit `revealPath` API ignores this.
   */
  autoReveal?: PierFileTreeAutoRevealMode;
  /** 目录读取失败时的本地化行内标记；详细错误仍由业务层反馈。 */
  directoryErrorLabel?: string;
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  /**
   * Optional expansion authority. When set, refresh/reset and Collapse All
   * re-apply this intent instead of guessing from the path set.
   */
  expansionAuthority?: TreeExpansionAuthority;
  /**
   * Seed policy when paths have no explicit intent.
   * - `none` (default): start collapsed except explicit expanded + compact chain
   * - `file-ancestors`: open ancestors of files (Git review cold start)
   */
  expansionSeed?: TreeExpansionSeed;
  /**
   * Collapse single-child directory chains into one row (pierre default true).
   */
  flattenEmptyDirectories?: boolean;
  /**
   * Minimum node depth eligible to start a flatten chain (pierre patch).
   * Root=0, top-level paths=1. Git review uses 2 so group roots stay separate
   * while nested path folders still compress.
   */
  flattenMinDepth?: number;
  /**
   * 宿主判定 path 是否已是当前打开的审查目标（B-Select）。
   * 为 true 时右键强制 Command（即使树 L-Select 暂时丢了）。
   */
  isActiveOpenPath?: (path: string) => boolean;
  /**
   * When true for a path, active-file auto-reveal is skipped (exclude globs).
   * Explicit API reveal ignores this. Default: never excluded.
   */
  isAutoRevealExcluded?: (path: string) => boolean;
  items: readonly PierFileTreeItem[];
  label: string;
  /**
   * 原生菜单会话 begin/end：宿主可冻结 CodeView raw scrollTop。
   * intent: inspect=未选中打开一次；command=已选中仅菜单。
   */
  onContextMenuSession?: (
    phase: "begin" | "end",
    detail: {
      readonly intent: "inspect" | "command";
      readonly path: string;
    }
  ) => void;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  /** 模型层因 Esc/空提交 removeIfCanceled 删除路径时回调(caller path)。 */
  onModelPathsRemoved?: (paths: readonly string[]) => void;
  /** 树内拖拽完成(模型层已移动);业务方执行真实 fs move,失败自行刷新回滚。 */
  onMovePaths?: (moves: readonly PierFileTreeMove[]) => void;
  /**
   * 由树模型解析真实行目标后触发，兼容压缩目录、Shadow DOM 与键盘菜单键。
   * 可返回 Promise（如 Electron 菜单 popup）；settle 后结束菜单会话（unfreeze / 清 suppress）。
   */
  onOpenItemContextMenu?: (
    item: PierFileTreeContextMenuItem,
    point: PierFileTreeContextMenuPoint
  ) => void | Promise<void>;
  onOpenPath?: (path: string) => void;
  /**
   * inline rename 提交;业务方执行 fs move 或新建落盘。
   * 同名确认(basename 未改)也会回调,便于新建占位直接采用默认名。
   */
  onRenamePath?: (move: PierFileTreeMove & { isFolder: boolean }) => void;
  onScrollSnapshotChange?: (snapshot: PierFileTreeScrollSnapshot) => void;
  /** 回传直接匹配数及当前聚焦项能否作为文件打开。 */
  onSearchMatchStateChange?: (state: {
    focusedMatchOpenable: boolean;
    matchCount: number;
  }) => void;
  onSelectPaths?: (paths: string[]) => void;
  /** 变化时把该路径滚动进视口并选中(auto-reveal 当前文件)。 */
  revealPath?: string | null;
  scrollControllerRef?: React.Ref<PierFileTreeScrollController>;
  stickyFolders?: boolean;
  treeApiRef?: React.Ref<PierFileTreeApi>;
}
