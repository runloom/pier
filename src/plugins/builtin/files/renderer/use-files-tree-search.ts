import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadFilesTreeForSearch } from "./files-tree-search-loader.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

interface UseFilesTreeSearchOptions {
  context: RendererPluginContext;
  fallbackError: string;
  list: FilesTreeList;
  root: string;
  searchFailedTitle: string;
  treeApiRef: RefObject<PierFileTreeApi | null>;
}

interface FilesTreeSearchMatchState {
  focusedMatchOpenable: boolean;
  matchCount: number;
}

const EMPTY_MATCH_STATE: FilesTreeSearchMatchState = {
  focusedMatchOpenable: false,
  matchCount: 0,
};

function modelSearchValue(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

function searchFailureBody(
  path: string,
  error: unknown,
  fallback: string
): string {
  let detail = fallback;
  if (error instanceof Error && error.message.length > 0) {
    detail = error.message;
  } else if (typeof error === "string" && error.length > 0) {
    detail = error;
  }
  return path.length > 0 ? `${path}: ${detail}` : detail;
}

export function useFilesTreeSearch({
  context,
  fallbackError,
  list,
  root,
  searchFailedTitle,
  treeApiRef,
}: UseFilesTreeSearchOptions) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const valueRef = useRef("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [matchState, setMatchState] = useState(EMPTY_MATCH_STATE);
  const [appliedSearch, setAppliedSearch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applySearch = useCallback((api: PierFileTreeApi, nextValue: string) => {
    const query = modelSearchValue(nextValue);
    api.setSearch(query);
    setAppliedSearch(query);
  }, []);
  const attachTreeApi = useCallback(
    (api: PierFileTreeApi | null) => {
      treeApiRef.current = api;
      if (api) {
        applySearch(api, valueRef.current);
      } else {
        setAppliedSearch(null);
        setMatchState(EMPTY_MATCH_STATE);
      }
    },
    [applySearch, treeApiRef]
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
    setLoading(false);
    treeApiRef.current?.setSearch(null);
    setAppliedSearch(null);
  }, [treeApiRef]);
  const changeSearch = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      valueRef.current = nextValue;
      const api = treeApiRef.current;
      if (api) {
        applySearch(api, nextValue);
      } else {
        setAppliedSearch(null);
        setMatchState(EMPTY_MATCH_STATE);
      }
    },
    [applySearch, treeApiRef]
  );
  const navigateSearch = useCallback(
    (direction: "next" | "previous") => {
      treeApiRef.current?.focusSearchMatch(direction);
    },
    [treeApiRef]
  );
  const openFocusedMatch = useCallback(
    () =>
      matchState.focusedMatchOpenable
        ? (treeApiRef.current?.activateFocusedSearchMatch() ?? false)
        : false,
    [matchState.focusedMatchOpenable, treeApiRef]
  );
  const updateMatchState = useCallback((next: FilesTreeSearchMatchState) => {
    setMatchState((current) =>
      current.focusedMatchOpenable === next.focusedMatchOpenable &&
      current.matchCount === next.matchCount
        ? current
        : next
    );
  }, []);

  useEffect(() => {
    if (!(open && value.trim().length > 0)) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    loadFilesTreeForSearch(root, list, fallbackError)
      .then(async ({ failures }) => {
        if (!active) {
          return;
        }
        setLoading(false);
        const failure = failures[0];
        if (failure) {
          await context.dialogs.alert({
            body: searchFailureBody(failure.path, failure.error, fallbackError),
            size: "default",
            title: searchFailedTitle,
          });
        }
      })
      .catch(async (error: unknown) => {
        if (!active) {
          return;
        }
        setLoading(false);
        await context.dialogs.alert({
          body: searchFailureBody("", error, fallbackError),
          size: "default",
          title: searchFailedTitle,
        });
      });
    return () => {
      active = false;
    };
  }, [context, fallbackError, list, open, root, searchFailedTitle, value]);

  return {
    attachTreeApi,
    changeSearch,
    closeSearch,
    focusSignal,
    loading,
    focusedMatchOpenable: matchState.focusedMatchOpenable,
    matchCount: matchState.matchCount,
    navigateSearch,
    open,
    openFocusedMatch,
    openSearch,
    queryApplied:
      treeApiRef.current != null && appliedSearch === modelSearchValue(value),
    updateMatchState,
    value,
  };
}
