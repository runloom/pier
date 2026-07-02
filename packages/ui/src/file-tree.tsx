import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeRowDecoration,
  FileTreeSelectionChangeListener,
  GitStatusEntry,
  GitStatus as PierreGitStatus,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import * as React from "react";
import { cn } from "./utils.ts";

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

export interface PierFileTreeProps
  extends Omit<React.ComponentProps<"div">, "children" | "onSelect"> {
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  items: readonly PierFileTreeItem[];
  label: string;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  onOpenPath?: (path: string) => void;
  onSelectPaths?: (paths: string[]) => void;
}

interface FileTreeRefs {
  decorationsByPath: ReadonlyMap<string, React.ReactNode>;
  directoryLoadStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>;
  loadableDirectoryPaths: ReadonlyMap<string, string>;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  onOpenPath?: (path: string) => void;
  onSelectPaths?: (paths: string[]) => void;
}

type PierFileTreeStyle = React.CSSProperties & {
  "--trees-scrollbar-gutter-override"?: string;
  "--trees-scrollbar-thumb-override"?: string;
};

const EMPTY_REFS: FileTreeRefs = {
  decorationsByPath: new Map(),
  directoryLoadStatesByPath: new Map(),
  itemsByPath: new Map(),
  loadableDirectoryPaths: new Map(),
};

function toOfficialPath(item: PierFileTreeItem): string {
  return item.kind === "directory" && !item.path.endsWith("/")
    ? `${item.path}/`
    : item.path;
}

function getDefaultDirectoryLoadState(
  item: PierFileTreeItem
): PierDirectoryLoadState | undefined {
  if (item.hasChildren === true || item.hasChildren === "unknown") {
    return "unloaded";
  }

  return;
}

function resolveDirectoryLoadState(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): PierDirectoryLoadState | undefined {
  if (item.kind !== "directory") {
    return;
  }

  if (item.hasChildren === false) {
    return "empty";
  }

  return (
    directoryStates?.get(item.path) ??
    directoryStates?.get(toOfficialPath(item)) ??
    item.loadState ??
    getDefaultDirectoryLoadState(item)
  );
}

function shouldAutoExpandDirectory(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): boolean {
  return resolveDirectoryLoadState(item, directoryStates) == null;
}

function toDirectoryLoadDecoration(
  loadState: PierDirectoryLoadState | undefined
): React.ReactNode {
  switch (loadState) {
    case "loading":
      return "Loading";
    case "error":
      return "Error";
    case "empty":
      return "Empty";
    default:
      return null;
  }
}

function buildRowDecoration(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): React.ReactNode {
  const parts: string[] = [];

  if (
    typeof item.trailingDecoration === "string" ||
    typeof item.trailingDecoration === "number"
  ) {
    parts.push(String(item.trailingDecoration));
  }

  const loadDecoration = toDirectoryLoadDecoration(
    resolveDirectoryLoadState(item, directoryStates)
  );

  if (typeof loadDecoration === "string") {
    parts.push(loadDecoration);
  }

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return item.trailingDecoration ?? null;
}

function toOfficialDecoration(
  decoration: React.ReactNode
): FileTreeRowDecoration | null {
  if (typeof decoration === "string" || typeof decoration === "number") {
    return { text: String(decoration) };
  }

  return null;
}

function collectExpandedDirectoryPaths(
  items: readonly PierFileTreeItem[],
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): string[] {
  const expandedPaths = new Set<string>();

  for (const item of items) {
    const segments = item.path.split("/").filter(Boolean);
    const shouldIncludeOwnDirectory =
      item.kind === "directory" &&
      shouldAutoExpandDirectory(item, directoryStates);
    const directorySegmentCount =
      item.kind === "directory"
        ? segments.length - (shouldIncludeOwnDirectory ? 0 : 1)
        : segments.length - 1;

    for (let index = 1; index <= directorySegmentCount; index += 1) {
      expandedPaths.add(segments.slice(0, index).join("/"));
    }
  }

  return [...expandedPaths];
}

function isDirectoryHandle(
  itemHandle: FileTreeItemHandle | null
): itemHandle is FileTreeDirectoryHandle {
  return itemHandle?.isDirectory() === true;
}

export function PierFileTree({
  directoryStates,
  items,
  label,
  onLoadDirectory,
  onOpenPath,
  onSelectPaths,
  className,
  style,
  ...props
}: PierFileTreeProps) {
  const refs = React.useRef<FileTreeRefs>(EMPTY_REFS);
  const expandedDirectoriesRef = React.useRef(new Map<string, boolean>());
  const requestedLoadDirectoriesRef = React.useRef(new Set<string>());
  const didMountRef = React.useRef(false);
  const paths = React.useMemo(() => items.map(toOfficialPath), [items]);
  const gitStatus = React.useMemo<GitStatusEntry[]>(
    () =>
      items.flatMap((item) =>
        item.gitStatus == null
          ? []
          : [{ path: toOfficialPath(item), status: item.gitStatus }]
      ),
    [items]
  );
  const initialExpandedPaths = React.useMemo(
    () => collectExpandedDirectoryPaths(items, directoryStates),
    [directoryStates, items]
  );

  refs.current = React.useMemo<FileTreeRefs>(() => {
    const decorationsByPath = new Map<string, React.ReactNode>();
    const directoryLoadStatesByPath = new Map<string, PierDirectoryLoadState>();
    const itemsByPath = new Map<string, PierFileTreeItem>();
    const loadableDirectoryPaths = new Map<string, string>();

    for (const item of items) {
      const officialPath = toOfficialPath(item);

      itemsByPath.set(item.path, item);
      itemsByPath.set(officialPath, item);

      const directoryLoadState = resolveDirectoryLoadState(
        item,
        directoryStates
      );
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
      ...(onLoadDirectory ? { onLoadDirectory } : {}),
      ...(onOpenPath ? { onOpenPath } : {}),
      ...(onSelectPaths ? { onSelectPaths } : {}),
    };
  }, [directoryStates, items, onLoadDirectory, onOpenPath, onSelectPaths]);

  const fileTreeStyle = React.useMemo<PierFileTreeStyle>(
    () => ({
      "--trees-scrollbar-gutter-override":
        "var(--shell-scrollbar-width-legacy)",
      "--trees-scrollbar-thumb-override": "var(--shell-scrollbar-thumb)",
      ...style,
    }),
    [style]
  );

  const handleSelectionChange =
    React.useCallback<FileTreeSelectionChangeListener>((selectedPaths) => {
      const nextSelectedPaths = [...selectedPaths];
      const selectedPath = nextSelectedPaths.at(-1);
      const selectedItem =
        selectedPath == null
          ? undefined
          : refs.current.itemsByPath.get(selectedPath);
      const outwardSelectedPaths = nextSelectedPaths.map(
        (path) => refs.current.itemsByPath.get(path)?.path ?? path
      );

      refs.current.onSelectPaths?.(outwardSelectedPaths);

      if (selectedItem?.kind === "file") {
        refs.current.onOpenPath?.(selectedItem.path);
      }
    }, []);

  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpandedPaths,
    onSelectionChange: handleSelectionChange,
    paths,
    renderRowDecoration: ({ item }) =>
      toOfficialDecoration(refs.current.decorationsByPath.get(item.path)),
  });

  React.useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  const syncDirectoryExpansionState = React.useCallback(
    (notifyOnExpand: boolean) => {
      const loadableDirectoryPaths = refs.current.loadableDirectoryPaths;

      for (const trackedPath of expandedDirectoriesRef.current.keys()) {
        if (!loadableDirectoryPaths.has(trackedPath)) {
          expandedDirectoriesRef.current.delete(trackedPath);
        }
      }

      for (const requestedPath of requestedLoadDirectoriesRef.current) {
        if (
          !loadableDirectoryPaths.has(requestedPath) ||
          refs.current.directoryLoadStatesByPath.get(requestedPath) !==
            "unloaded"
        ) {
          requestedLoadDirectoriesRef.current.delete(requestedPath);
        }
      }

      for (const [officialPath, callerPath] of loadableDirectoryPaths) {
        const itemHandle = model.getItem(officialPath);
        let isExpanded = false;

        if (isDirectoryHandle(itemHandle)) {
          isExpanded = itemHandle.isExpanded();
        }

        const wasExpanded =
          expandedDirectoriesRef.current.get(officialPath) ?? false;
        expandedDirectoriesRef.current.set(officialPath, isExpanded);

        if (!(notifyOnExpand && isExpanded) || wasExpanded) {
          continue;
        }

        const onLoadDirectory = refs.current.onLoadDirectory;

        if (
          onLoadDirectory == null ||
          refs.current.directoryLoadStatesByPath.get(officialPath) !==
            "unloaded" ||
          requestedLoadDirectoriesRef.current.has(officialPath)
        ) {
          continue;
        }

        requestedLoadDirectoriesRef.current.add(officialPath);
        onLoadDirectory(callerPath);
      }
    },
    [model]
  );

  React.useEffect(() => {
    syncDirectoryExpansionState(false);
    return model.subscribe(() => {
      syncDirectoryExpansionState(true);
    });
  }, [model, syncDirectoryExpansionState]);

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    const expandedPaths = new Set(initialExpandedPaths);

    for (const [officialPath, callerPath] of refs.current
      .loadableDirectoryPaths) {
      const itemHandle = model.getItem(officialPath);

      if (isDirectoryHandle(itemHandle) && itemHandle.isExpanded()) {
        expandedPaths.add(callerPath);
      }
    }

    model.resetPaths(paths, { initialExpandedPaths: [...expandedPaths] });
  }, [initialExpandedPaths, model, paths]);

  return (
    <PierreFileTree
      aria-label={label}
      className={cn("h-full min-h-0 w-full", className)}
      data-slot="pier-file-tree"
      model={model}
      style={fileTreeStyle}
      {...props}
    />
  );
}
