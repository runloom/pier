/**
 * Sidebar tree search: path query discovery + materialize into PierFileTree.
 * Keeps FilesSearchBar + setSearch / hide-non-matches UI (no result-list layer).
 *
 * Design: docs/superpowers/specs/2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md
 */
import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";
import { useFileTreeSearch } from "@pier/ui/use-file-tree-search.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
} from "../settings.ts";
import {
  createFilesPathQueryClient,
  type PathQuerySnapshot,
} from "./files-path-query-client.ts";
import { materializePathQueryHits } from "./files-path-query-materialize.ts";
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
  root: string;
  searchFailedTitle: string;
  treeApiRef: RefObject<PierFileTreeApi | null>;
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

function readExcludePatterns(context: RendererPluginContext): string {
  const value = context.configuration?.get?.<unknown>(
    FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY
  );
  // Empty string is intentional (no excludes); only non-string falls back.
  return typeof value === "string"
    ? value
    : FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
}

export function useFilesTreeSearch({
  context,
  fallbackError,
  instanceId,
  list,
  root,
  searchFailedTitle,
  treeApiRef,
}: UseFilesTreeSearchOptions) {
  const treeSearch = useFileTreeSearch({ treeApiRef });
  const [snapshot, setSnapshot] = useState<PathQuerySnapshot>(EMPTY_SNAPSHOT);
  const clientRef = useRef(createFilesPathQueryClient(context.files));
  const disposeSearchRef = useRef<(() => void) | null>(null);
  const materializeAbortRef = useRef<AbortController | null>(null);
  const ownerRef = useRef(`tree-search:${instanceId}`);
  const listRef = useRef(list);
  const valueRef = useRef(treeSearch.value);
  listRef.current = list;
  valueRef.current = treeSearch.value;

  useEffect(() => {
    ownerRef.current = `tree-search:${instanceId}`;
  }, [instanceId]);

  useEffect(() => {
    clientRef.current = createFilesPathQueryClient(context.files);
  }, [context.files]);

  const stopSearch = useCallback(() => {
    disposeSearchRef.current?.();
    disposeSearchRef.current = null;
    materializeAbortRef.current?.abort();
    materializeAbortRef.current = null;
  }, []);

  const openSearch = treeSearch.openSearch;

  const closeSearch = useCallback(() => {
    stopSearch();
    setSnapshot(EMPTY_SNAPSHOT);
    treeSearch.closeSearch();
  }, [stopSearch, treeSearch]);

  const changeSearch = treeSearch.changeSearch;

  useEffect(() => {
    if (!treeSearch.open) {
      stopSearch();
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    stopSearch();
    const materializeAbort = new AbortController();
    materializeAbortRef.current = materializeAbort;

    disposeSearchRef.current = clientRef.current.search({
      excludePatterns: readExcludePatterns(context),
      onUpdate: (next) => {
        setSnapshot(next);
        if (next.status === "error") {
          const body = next.errorMessage ?? fallbackError;
          context.dialogs
            .alert({
              body,
              size: "default",
              title: searchFailedTitle,
            })
            .catch(() => undefined);
          return;
        }

        if (next.status !== "loading" && next.status !== "done") {
          return;
        }

        const paths = next.items.map((item) => item.path);
        materializePathQueryHits({
          list: listRef.current,
          paths,
          root,
          signal: materializeAbort.signal,
        })
          .then((result) => {
            if (materializeAbort.signal.aborted) {
              return;
            }
            const current = valueRef.current;
            const query = current.trim().length > 0 ? current : null;
            treeApiRef.current?.setSearch(query);
            // Soft-fail: do not invent ghost nodes; empty match UI is fine if
            // materialize could not surface hits. Log only for diagnostics.
            if (
              result.failedDirectories.length > 0 ||
              result.missingPaths.length > 0
            ) {
              console.warn("[files-tree-search] materialize incomplete", {
                failedDirectories: result.failedDirectories,
                missingPaths: result.missingPaths,
              });
            }
          })
          .catch((error: unknown) => {
            if (materializeAbort.signal.aborted) {
              return;
            }
            console.warn("[files-tree-search] materialize failed", error);
          });
      },
      owner: ownerRef.current,
      query: treeSearch.value,
      root,
    });

    return () => {
      stopSearch();
    };
  }, [
    context,
    fallbackError,
    root,
    searchFailedTitle,
    stopSearch,
    treeApiRef,
    treeSearch.open,
    treeSearch.value,
  ]);

  const queryLoading = treeSearch.open && snapshot.status === "loading";
  const matchCount =
    treeSearch.open && treeSearch.value.trim().length > 0
      ? snapshot.items.length
      : treeSearch.matchCount;
  const truncated = snapshot.truncated && snapshot.status === "done";
  const matchText = treeSearch.open
    ? matchTextFor(
        snapshot.status === "idle" ? "idle" : snapshot.status,
        matchCount,
        truncated
      )
    : "";

  return useMemo(
    () => ({
      attachTreeApi: treeSearch.attachTreeApi,
      changeSearch,
      closeSearch,
      focusSignal: treeSearch.focusSignal,
      focusedMatchOpenable: treeSearch.focusedMatchOpenable,
      loading: queryLoading,
      matchCount,
      matchText,
      navigateSearch: treeSearch.navigateSearch,
      open: treeSearch.open,
      openFocusedMatch: treeSearch.openFocusedMatch,
      openSearch,
      queryApplied: treeSearch.queryApplied,
      truncated,
      updateMatchState: treeSearch.updateMatchState,
      value: treeSearch.value,
    }),
    [
      changeSearch,
      closeSearch,
      matchCount,
      matchText,
      openSearch,
      queryLoading,
      treeSearch.attachTreeApi,
      treeSearch.focusSignal,
      treeSearch.focusedMatchOpenable,
      treeSearch.navigateSearch,
      treeSearch.open,
      treeSearch.openFocusedMatch,
      treeSearch.queryApplied,
      treeSearch.updateMatchState,
      treeSearch.value,
      truncated,
    ]
  );
}
