import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { FilePathQueryItem } from "@shared/contracts/file-query.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createFilesPathQueryClient,
  type PathQuerySnapshot,
} from "./files-path-query-client.ts";
import { recordFilesPathMru } from "./files-quick-open-mru.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";
import {
  ensureAncestorDirectoryEntries,
  loadFilesTreeDirectory,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

const EMPTY_SNAPSHOT: PathQuerySnapshot = {
  items: [],
  status: "idle",
  truncated: false,
};

interface UseFilesTreeSearchOptions {
  context: RendererPluginContext;
  fallbackError: string;
  instanceId: string;
  list: FilesTreeList;
  onOpenFile: (entry: FileEntry, options?: { pinned?: boolean }) => void;
  root: string;
  searchFailedTitle: string;
  treeApiRef: RefObject<PierFileTreeApi | null>;
}

let ownerCounter = 0;

function nextOwner(): string {
  ownerCounter += 1;
  return `tree-search:${ownerCounter}`;
}

function ancestorDirectoryPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }
  const ancestors: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function matchTextFor(
  status: PathQuerySnapshot["status"],
  itemCount: number,
  truncated: boolean
): string {
  if (status === "idle") {
    return "";
  }
  if (status === "loading" && itemCount === 0) {
    return "";
  }
  if (truncated && itemCount > 0) {
    return `${itemCount}+`;
  }
  return String(itemCount);
}

export function useFilesTreeSearch({
  context,
  fallbackError,
  instanceId,
  list,
  onOpenFile,
  root,
  searchFailedTitle,
  treeApiRef,
}: UseFilesTreeSearchOptions) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [snapshot, setSnapshot] = useState<PathQuerySnapshot>(EMPTY_SNAPSHOT);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const ownerRef = useRef(nextOwner());
  const clientRef = useRef(createFilesPathQueryClient(context.files));
  const disposeSearchRef = useRef<(() => void) | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;

  // Keep Pierre setSearch cleared so hide-non-matches is not the primary engine.
  const attachTreeApi = useCallback(
    (api: PierFileTreeApi | null) => {
      treeApiRef.current = api;
      api?.setSearch(null);
    },
    [treeApiRef]
  );

  const stopSearch = useCallback(() => {
    disposeSearchRef.current?.();
    disposeSearchRef.current = null;
  }, []);

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusSignal((signal) => signal + 1);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setValue("");
    setSnapshot(EMPTY_SNAPSHOT);
    setSelectedIndex(0);
    stopSearch();
    treeApiRef.current?.setSearch(null);
  }, [stopSearch, treeApiRef]);

  const changeSearch = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      treeApiRef.current?.setSearch(null);
    },
    [treeApiRef]
  );

  useEffect(() => {
    clientRef.current = createFilesPathQueryClient(context.files);
  }, [context.files]);

  useEffect(() => {
    if (!open) {
      stopSearch();
      setSnapshot(EMPTY_SNAPSHOT);
      setSelectedIndex(0);
      return;
    }

    stopSearch();
    setSelectedIndex(0);
    disposeSearchRef.current = clientRef.current.search({
      onUpdate: (next) => {
        setSnapshot(next);
        setSelectedIndex((current) => {
          if (next.items.length === 0) {
            return 0;
          }
          return Math.min(current, next.items.length - 1);
        });
        if (next.status === "error") {
          const body = next.errorMessage ?? fallbackError;
          context.dialogs
            .alert({
              body,
              size: "default",
              title: searchFailedTitle,
            })
            .catch(() => undefined);
        }
      },
      owner: ownerRef.current,
      query: value,
      root,
    });

    return () => {
      stopSearch();
    };
  }, [
    context.dialogs,
    fallbackError,
    open,
    root,
    searchFailedTitle,
    stopSearch,
    value,
  ]);

  const items = snapshot.items;
  const loading = open && snapshot.status === "loading";
  const showResultLayer = open;
  const hasNoResults = open && snapshot.status === "done" && items.length === 0;
  const truncated = snapshot.truncated && snapshot.status === "done";
  const matchCount = items.length;
  const focusedItem: FilePathQueryItem | null =
    items[selectedIndex] ?? items[0] ?? null;
  const focusedMatchOpenable = focusedItem != null;
  const queryApplied = open;

  const matchText = open
    ? matchTextFor(snapshot.status, matchCount, truncated)
    : "";

  const navigateSearch = useCallback(
    (direction: "next" | "previous") => {
      if (items.length === 0) {
        return;
      }
      setSelectedIndex((current) => {
        if (direction === "next") {
          return (current + 1) % items.length;
        }
        return (current - 1 + items.length) % items.length;
      });
    },
    [items.length]
  );

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length) {
        return;
      }
      setSelectedIndex(index);
    },
    [items.length]
  );

  const openPathResult = useCallback(
    async (path: string) => {
      if (path.length === 0) {
        return false;
      }
      const currentList = listRef.current;
      ensureAncestorDirectoryEntries(root, path);
      for (const ancestor of ancestorDirectoryPaths(path)) {
        await loadFilesTreeDirectory(root, ancestor, currentList);
      }
      onOpenFileRef.current({ kind: "file", path, root }, undefined);
      recordFilesPathMru(root, path);
      treeApiRef.current?.revealPath(path);
      revealFilesTreePath({ instanceId, path, root });
      return true;
    },
    [instanceId, root, treeApiRef]
  );

  const openFocusedMatch = useCallback(async () => {
    if (!focusedItem) {
      return false;
    }
    return await openPathResult(focusedItem.path);
  }, [focusedItem, openPathResult]);

  // updateMatchState kept for PierFileTree prop compatibility (no-op).
  const updateMatchState = useCallback(
    (_next: { focusedMatchOpenable: boolean; matchCount: number }) => {
      // Path query owns match state; Pierre hide-non-matches is unused.
    },
    []
  );

  return useMemo(
    () => ({
      attachTreeApi,
      changeSearch,
      closeSearch,
      focusSignal,
      focusedIndex: selectedIndex,
      focusedItem,
      focusedMatchOpenable,
      hasNoResults,
      items,
      loading,
      matchCount,
      matchText,
      navigateSearch,
      open,
      openFocusedMatch,
      openPathResult,
      openSearch,
      queryApplied,
      selectIndex,
      showResultLayer,
      status: snapshot.status,
      truncated,
      updateMatchState,
      value,
    }),
    [
      attachTreeApi,
      changeSearch,
      closeSearch,
      focusSignal,
      focusedItem,
      focusedMatchOpenable,
      hasNoResults,
      items,
      loading,
      matchCount,
      matchText,
      navigateSearch,
      open,
      openFocusedMatch,
      openPathResult,
      openSearch,
      queryApplied,
      selectIndex,
      selectedIndex,
      showResultLayer,
      snapshot.status,
      truncated,
      updateMatchState,
      value,
    ]
  );
}
