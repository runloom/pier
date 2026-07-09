import type { GitStatus as PierreGitStatus } from "@pierre/trees";
import type * as React from "react";

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

/** 树内命令入口(inline rename / 树内查找 / 定位),由业务层经 ref 触发。 */
export interface PierFileTreeApi {
  focusSearchMatch: (direction: "next" | "previous") => void;
  getSearchMatchCount: () => number;
  /** 展开祖先并滚动定位到该路径(面包屑点击/外部 reveal 用)。 */
  revealPath: (path: string) => void;
  /** null = 关闭搜索并恢复完整投影。搜索 UI 由业务层自绘(不用库内置头)。 */
  setSearch: (value: string | null) => void;
  startRenaming: (path: string) => boolean;
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

export interface PierFileTreeScrollRestoreOptions {
  frames?: number;
  lock?: boolean;
}

export interface PierFileTreeScrollController {
  captureSnapshot: () => PierFileTreeScrollSnapshot | null;
  restoreSnapshot: (snapshot: PierFileTreeScrollSnapshot) => void;
  restoreSnapshotSoon: (
    snapshot: PierFileTreeScrollSnapshot | null,
    options?: PierFileTreeScrollRestoreOptions
  ) => void;
}

export interface PierFileTreeProps
  extends Omit<React.ComponentProps<"div">, "children" | "onSelect"> {
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  items: readonly PierFileTreeItem[];
  label: string;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  /** 树内拖拽完成(模型层已移动);业务方执行真实 fs move,失败自行刷新回滚。 */
  onMovePaths?: (moves: readonly PierFileTreeMove[]) => void;
  onOpenPath?: (path: string) => void;
  /** inline rename 提交;业务方执行 fs move。 */
  onRenamePath?: (move: PierFileTreeMove & { isFolder: boolean }) => void;
  onScrollSnapshotChange?: (snapshot: PierFileTreeScrollSnapshot) => void;
  onSelectPaths?: (paths: string[]) => void;
  /** 变化时把该路径滚动进视口并选中(auto-reveal 当前文件)。 */
  revealPath?: string | null;
  scrollControllerRef?: React.Ref<PierFileTreeScrollController>;
  stickyFolders?: boolean;
  treeApiRef?: React.Ref<PierFileTreeApi>;
}
