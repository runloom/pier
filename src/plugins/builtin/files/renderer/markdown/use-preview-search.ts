import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFilesInFileSearchEscape } from "../search/use-in-file-search-escape.ts";
import type { MarkdownPagination } from "./runtime.ts";
import {
  findMarkdownSearchMatches,
  type MarkdownSearchMatch,
} from "./search.ts";

export interface MarkdownPreviewSearchLabels {
  close: string;
  matchAnnouncement: string;
  next: string;
  noMatches: string;
  placeholder: string;
  previous: string;
}

export const DEFAULT_MARKDOWN_PREVIEW_SEARCH_LABELS: MarkdownPreviewSearchLabels =
  {
    close: "Close",
    matchAnnouncement: "Matches: {{count}}",
    next: "Next match",
    noMatches: "No matches",
    placeholder: "Find",
    previous: "Previous match",
  };

const EMPTY_SEARCH_MATCHES: readonly MarkdownSearchMatch[] = [];

export function useMarkdownPreviewSearch({
  labels,
  pagination,
  scrollRoot,
  searchRequest,
  surfaceRef,
}: {
  labels: MarkdownPreviewSearchLabels;
  pagination: MarkdownPagination | null;
  scrollRoot: HTMLElement | null;
  searchRequest: number | undefined;
  surfaceRef: RefObject<HTMLElement | null>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const handledSearchRequestRef = useRef(searchRequest);

  const searchMatches = useMemo(
    () =>
      searchOpen &&
      deferredSearchValue &&
      deferredSearchValue === searchValue &&
      pagination
        ? findMarkdownSearchMatches(pagination, deferredSearchValue)
        : EMPTY_SEARCH_MATCHES,
    [deferredSearchValue, pagination, searchOpen, searchValue]
  );

  const activeSearchMatch = searchMatches[activeSearchIndex];
  const searchMatchText = (() => {
    if (!searchValue) return "";
    if (deferredSearchValue !== searchValue) return "";
    if (searchMatches.length === 0) return labels.noMatches;
    return `${activeSearchIndex + 1}/${searchMatches.length}`;
  })();

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusSignal((current) => current + 1);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  useFilesInFileSearchEscape(searchOpen, closeSearch, surfaceRef);

  useEffect(() => {
    if (handledSearchRequestRef.current === searchRequest) return;
    handledSearchRequestRef.current = searchRequest;
    if (searchRequest) {
      openSearch();
    }
  }, [openSearch, searchRequest]);

  useEffect(() => {
    if (activeSearchIndex >= searchMatches.length) setActiveSearchIndex(0);
  }, [activeSearchIndex, searchMatches.length]);

  const navigateSearch = useCallback(
    (direction: "next" | "previous") => {
      if (searchMatches.length === 0) return;
      setActiveSearchIndex((current) =>
        direction === "next"
          ? (current + 1) % searchMatches.length
          : (current - 1 + searchMatches.length) % searchMatches.length
      );
    },
    [searchMatches.length]
  );

  const handleSearchChange = useCallback((next: string) => {
    setSearchValue(next);
    setActiveSearchIndex(0);
  }, []);

  // Align with CodeMirror source: Cmd/Ctrl+F opens the in-preview find bar.
  const handlePreviewKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
      }
    },
    [openSearch]
  );

  // Primary-button down on non-interactive prose focuses the scrollport so
  // ⌘F / keyboard scroll land on the overflow surface.
  const handlePreviewPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          "a, button, input, textarea, select, [contenteditable='true'], [role='textbox']"
        )
      ) {
        return;
      }
      scrollRoot?.focus({ preventScroll: true });
    },
    [scrollRoot]
  );

  return {
    activeSearchMatch,
    closeSearch,
    handlePreviewKeyDown,
    handlePreviewPointerDown,
    handleSearchChange,
    navigateSearch,
    searchFocusSignal,
    searchMatchText,
    searchMatches,
    searchOpen,
    searchValue,
  };
}
