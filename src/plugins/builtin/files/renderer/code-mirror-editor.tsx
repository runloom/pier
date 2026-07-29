import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { DEFAULT_FILES_LSP_HOVER_LABELS } from "./file-panel-markdown-labels.ts";
import { takeFilesPanelViewSeed } from "./files-panel-transfer-state.ts";
import {
  FILES_IN_FILE_SEARCH_BAR_CLASSNAME,
  FilesSearchBar,
} from "./files-search-bar.tsx";
import { useFilesInFileSearchEscape } from "./use-files-in-file-search-escape.ts";

export function CodeMirrorEditor({
  controller,
  documentId,
  editorSessionId,
  labels,
  onEditorContextMenu,
  openExternal,
  panelContext,
  readOnly = false,
  searchLabels,
  searchRequest,
  context,
}: FileEditorAdapterProps) {
  const contextMenuRef = useRef(onEditorContextMenu);
  const handledSearchRequestRef = useRef(searchRequest);
  const labelsRef = useRef(labels);
  const lastHostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const openExternalRef = useRef(openExternal);
  const notifyErrorRef = useRef<(message: string) => void>((message) => {
    context?.notifications.error(message);
  });
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
  notifyErrorRef.current = (message: string) => {
    context?.notifications.error(message);
  };
  labelsRef.current = labels;
  openExternalRef.current = openExternal;
  const sourceEditorLabel = labels?.sourceEditor ?? "Source editor";

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
      ariaLabel: labelsRef.current?.sourceEditor ?? "Source editor",
      getLspHoverLabels: () =>
        labelsRef.current?.lspHover ?? DEFAULT_FILES_LSP_HOVER_LABELS,
      notifyLspError: (message: string) => notifyErrorRef.current(message),
      openExternal: (url: string) => openExternalRef.current(url),
      onContextMenu: (
        event: MouseEvent,
        ranges: Parameters<
          NonNullable<FileEditorAdapterProps["onEditorContextMenu"]>
        >[1]
      ) => contextMenuRef.current?.(event, ranges),
      onOpenSearch: () => openSearchRef.current(),
      onSearchStateChange: setSearchState,
      readDocument: controller.readDocument,
    }),
    [controller.readDocument]
  );

  const bindEditorHost = useMemo(() => {
    let attachedHost: HTMLDivElement | null = null;
    return (parent: HTMLDivElement | null) => {
      if (parent) {
        attachedHost = parent;
        lastHostRef.current = parent;
        controller.attachView({
          documentId,
          editorSessionId,
          ...(panelContext ? { panelContext } : {}),
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
      const host = attachedHost;
      attachedHost = null;
      if (!host) {
        return;
      }
      if (lastHostRef.current === host) {
        lastHostRef.current = null;
      }
      controller.detachView(editorSessionId, host);
    };
  }, [controller, documentId, editorSessionId, panelContext, presentation]);

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

  useFilesInFileSearchEscape(searchOpen, closeSearch, surfaceRef);

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
    <div
      className="relative h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground"
      ref={surfaceRef}
    >
      {searchOpen ? (
        <FilesSearchBar
          className={FILES_IN_FILE_SEARCH_BAR_CLASSNAME}
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
