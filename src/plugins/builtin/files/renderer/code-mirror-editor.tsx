import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SEARCH_OPTIONS,
  type EditorSearchOptionKey,
  type EditorSearchOptions,
  type EditorSearchState,
  EMPTY_EDITOR_SEARCH_STATE,
} from "./code-mirror-search-state.ts";
import type { FileEditorAdapterProps } from "./file-editor-adapter-types.ts";
import { takeFilesPanelViewSeed } from "./files-panel-transfer-state.ts";
import { FilesSearchBar } from "./files-search-bar.tsx";

export function CodeMirrorEditor({
  controller,
  documentId,
  editorSessionId,
  labels,
  onEditorContextMenu,
  readOnly = false,
  searchLabels,
  searchRequest,
}: FileEditorAdapterProps) {
  const contextMenuRef = useRef(onEditorContextMenu);
  const handledSearchRequestRef = useRef(searchRequest);
  const labelRef = useRef(labels?.sourceEditor ?? "Source editor");
  const lastHostRef = useRef<HTMLDivElement | null>(null);
  const openSearchRef = useRef<() => void>(() => undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [searchOptions, setSearchOptions] = useState<EditorSearchOptions>(
    DEFAULT_SEARCH_OPTIONS
  );
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [searchState, setSearchState] = useState<EditorSearchState>(
    EMPTY_EDITOR_SEARCH_STATE
  );

  contextMenuRef.current = onEditorContextMenu;
  const sourceEditorLabel = labels?.sourceEditor ?? "Source editor";
  labelRef.current = sourceEditorLabel;

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusSignal((signal) => signal + 1);
    setSearchState(
      controller.applySearchQuery(
        editorSessionId,
        searchValue,
        replaceValue,
        searchOptions
      )
    );
  }, [controller, editorSessionId, replaceValue, searchOptions, searchValue]);
  openSearchRef.current = openSearch;

  const presentation = useCallback(
    () => ({
      ariaLabel: labelRef.current,
      onContextMenu: (
        event: MouseEvent,
        ranges: Parameters<
          NonNullable<FileEditorAdapterProps["onEditorContextMenu"]>
        >[1]
      ) => contextMenuRef.current?.(event, ranges),
      onOpenSearch: () => openSearchRef.current(),
      onSearchStateChange: setSearchState,
    }),
    []
  );

  const bindEditorHost = useCallback(
    (parent: HTMLDivElement | null) => {
      if (parent) {
        lastHostRef.current = parent;
        controller.attachView({
          documentId,
          editorSessionId,
          parent,
          presentation: presentation(),
        });
        const seed = takeFilesPanelViewSeed({ documentId });
        if (seed?.selection || seed?.scroll) {
          controller.applyViewSnapshot(editorSessionId, {
            ...(seed.selection ? { selection: seed.selection } : {}),
            ...(seed.scroll ? { scroll: seed.scroll } : {}),
          });
        }
        return;
      }
      // 仅当 view 仍挂在本 host 时销毁；已 reparent 到新 group 的 view 跳过。
      const host = lastHostRef.current;
      lastHostRef.current = null;
      controller.detachView(editorSessionId, host ?? undefined);
    },
    [controller, documentId, editorSessionId, presentation]
  );

  useLayoutEffect(() => {
    controller.updateViewPresentation(editorSessionId, {
      ...presentation(),
      ariaLabel: sourceEditorLabel,
    });
  }, [controller, editorSessionId, presentation, sourceEditorLabel]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchState(
      controller.clearSearch(editorSessionId, replaceValue, searchOptions)
    );
  }, [controller, editorSessionId, replaceValue, searchOptions]);

  const handleSearchChange = useCallback(
    (nextValue: string) => {
      setSearchValue(nextValue);
      setSearchState(
        controller.applySearchQuery(
          editorSessionId,
          nextValue,
          replaceValue,
          searchOptions,
          nextValue.length > 0
        )
      );
    },
    [controller, editorSessionId, replaceValue, searchOptions]
  );

  const handleReplaceChange = useCallback(
    (nextValue: string) => {
      setReplaceValue(nextValue);
      setSearchState(
        controller.applySearchQuery(
          editorSessionId,
          searchValue,
          nextValue,
          searchOptions
        )
      );
    },
    [controller, editorSessionId, searchOptions, searchValue]
  );

  const handleSearchOptionChange = useCallback(
    (key: EditorSearchOptionKey, pressed: boolean) => {
      const nextOptions = { ...searchOptions, [key]: pressed };
      setSearchOptions(nextOptions);
      setSearchState(
        controller.applySearchQuery(
          editorSessionId,
          searchValue,
          replaceValue,
          nextOptions
        )
      );
    },
    [controller, editorSessionId, replaceValue, searchOptions, searchValue]
  );

  const handleReplace = useCallback(() => {
    if (!readOnly) {
      setSearchState(controller.replaceSearch(editorSessionId, false));
    }
  }, [controller, editorSessionId, readOnly]);

  const handleReplaceAll = useCallback(() => {
    if (!readOnly) {
      setSearchState(controller.replaceSearch(editorSessionId, true));
    }
  }, [controller, editorSessionId, readOnly]);

  const handleSelectAllMatches = useCallback(() => {
    setSearchState(controller.selectAllMatches(editorSessionId));
  }, [controller, editorSessionId]);

  const handleSearchNavigate = useCallback(
    (direction: "next" | "previous") => {
      setSearchState(controller.navigateSearch(editorSessionId, direction));
    },
    [controller, editorSessionId]
  );

  useEffect(() => {
    if (handledSearchRequestRef.current === searchRequest) {
      return;
    }
    handledSearchRequestRef.current = searchRequest;
    if (searchRequest) {
      openSearchRef.current();
    }
  }, [searchRequest]);

  const matchText = (() => {
    if (!searchOpen || searchValue.length === 0) {
      return "";
    }
    if (searchState.total <= 0) {
      return searchLabels?.noMatches ?? "0";
    }
    const index = searchState.currentIndex > 0 ? searchState.currentIndex : 1;
    return `${index}/${searchState.total}`;
  })();

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {searchOpen ? (
        <FilesSearchBar
          className="absolute top-2 right-3 z-20 max-w-[calc(100%-1.5rem)]"
          focusSignal={searchFocusSignal}
          labels={{
            close: searchLabels?.close ?? "Close",
            matchCase: searchLabels?.matchCase ?? "Match case",
            next: searchLabels?.next ?? "Next match",
            placeholder: searchLabels?.placeholder ?? "Find",
            previous: searchLabels?.previous ?? "Previous match",
            regexp: searchLabels?.regexp ?? "Regexp",
            replace: searchLabels?.replace ?? "Replace",
            replaceAll: searchLabels?.replaceAll ?? "Replace all",
            replacePlaceholder: searchLabels?.replacePlaceholder ?? "Replace",
            selectAll: searchLabels?.selectAll ?? "Select all matches",
            wholeWord: searchLabels?.wholeWord ?? "Whole word",
          }}
          matchAnnouncement={
            searchState.total <= 0
              ? (searchLabels?.noMatches ?? "No matches")
              : (searchLabels?.matchAnnouncement.replace(
                  "{{count}}",
                  matchText
                ) ?? `Matches: ${matchText}`)
          }
          matchText={matchText}
          onChange={handleSearchChange}
          onClose={closeSearch}
          onNavigate={handleSearchNavigate}
          onOptionChange={handleSearchOptionChange}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onReplaceChange={handleReplaceChange}
          onSelectAll={handleSelectAllMatches}
          options={searchOptions}
          readOnly={readOnly}
          replaceValue={replaceValue}
          testId="files-editor-search-bar"
          value={searchValue}
        />
      ) : null}
      <div
        className="h-full min-h-0 flex-1"
        data-testid="files-code-mirror-editor"
        ref={bindEditorHost}
      />
    </div>
  );
}
