import { type RefObject, useCallback, useRef, useState } from "react";
import type { PierFileTreeApi, PierFileTreeProps } from "./tree.tsx";
import type {
  PierFileTreeCollapseAllOptions,
  PierFileTreeExpandAllOptions,
} from "./tree-types.ts";

type FileTreeSearchMatchState = Parameters<
  NonNullable<PierFileTreeProps["onSearchMatchStateChange"]>
>[0];

const EMPTY_MATCH_STATE: FileTreeSearchMatchState = {
  focusedMatchOpenable: false,
  matchCount: 0,
};

function modelSearchValue(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

/**
 * `PierFileTreeApi` 的纯搜索桥。它不读取目录、不创建过滤副本，也不持有业务数据。
 */
export function useFileTreeSearch({
  treeApiRef,
}: {
  treeApiRef?: RefObject<PierFileTreeApi | null>;
} = {}) {
  const internalTreeApiRef = useRef<PierFileTreeApi | null>(null);
  const resolvedTreeApiRef = treeApiRef ?? internalTreeApiRef;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const valueRef = useRef("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [matchState, setMatchState] = useState(EMPTY_MATCH_STATE);
  const [appliedSearch, setAppliedSearch] = useState<string | null>(null);

  const applySearch = useCallback((api: PierFileTreeApi, nextValue: string) => {
    const query = modelSearchValue(nextValue);
    api.setSearch(query);
    setAppliedSearch(query);
  }, []);

  const attachTreeApi = useCallback(
    (api: PierFileTreeApi | null) => {
      resolvedTreeApiRef.current = api;
      if (api) {
        applySearch(api, valueRef.current);
      } else {
        setAppliedSearch(null);
        setMatchState(EMPTY_MATCH_STATE);
      }
    },
    [applySearch, resolvedTreeApiRef]
  );

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusSignal((signal) => signal + 1);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setValue("");
    valueRef.current = "";
    setMatchState(EMPTY_MATCH_STATE);
    resolvedTreeApiRef.current?.setSearch(null);
    setAppliedSearch(null);
  }, [resolvedTreeApiRef]);

  const toggleSearch = useCallback(() => {
    if (open) {
      closeSearch();
      return;
    }
    openSearch();
  }, [closeSearch, open, openSearch]);

  const changeSearch = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      valueRef.current = nextValue;
      const api = resolvedTreeApiRef.current;
      if (api) {
        applySearch(api, nextValue);
      } else {
        setAppliedSearch(null);
        setMatchState(EMPTY_MATCH_STATE);
      }
    },
    [applySearch, resolvedTreeApiRef]
  );

  const navigateSearch = useCallback(
    (direction: "next" | "previous") => {
      resolvedTreeApiRef.current?.focusSearchMatch(direction);
    },
    [resolvedTreeApiRef]
  );

  const openFocusedMatch = useCallback(
    () =>
      matchState.focusedMatchOpenable
        ? (resolvedTreeApiRef.current?.activateFocusedSearchMatch() ?? false)
        : false,
    [matchState.focusedMatchOpenable, resolvedTreeApiRef]
  );

  const updateMatchState = useCallback((next: FileTreeSearchMatchState) => {
    setMatchState((current) =>
      current.focusedMatchOpenable === next.focusedMatchOpenable &&
      current.matchCount === next.matchCount
        ? current
        : next
    );
  }, []);

  const collapseAllFolders = useCallback(
    (options?: PierFileTreeCollapseAllOptions) => {
      resolvedTreeApiRef.current?.collapseAll(options);
    },
    [resolvedTreeApiRef]
  );

  const expandAllFolders = useCallback(
    (options?: PierFileTreeExpandAllOptions) => {
      resolvedTreeApiRef.current?.expandAll(options);
    },
    [resolvedTreeApiRef]
  );

  return {
    attachTreeApi,
    changeSearch,
    closeSearch,
    collapseAllFolders,
    expandAllFolders,
    /** @deprecated Prefer expandAllFolders */
    expandKnownFolders: expandAllFolders,
    focusSignal,
    focusedMatchOpenable: matchState.focusedMatchOpenable,
    matchCount: matchState.matchCount,
    navigateSearch,
    open,
    openFocusedMatch,
    openSearch,
    toggleSearch,
    /**
     * Prefer this object ref for PierFileTree.treeApiRef.
     * Callback `attachTreeApi` can miss useImperativeHandle in some paths.
     */
    treeApiRef: resolvedTreeApiRef,
    queryApplied:
      resolvedTreeApiRef.current != null &&
      appliedSearch === modelSearchValue(value),
    updateMatchState,
    value,
  };
}
