import { syntaxHighlighting } from "@codemirror/language";
import {
  search as codeMirrorSearch,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { type EditorSelection, EditorState, Prec } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useCallback, useEffect, useRef, useState } from "react";
import { filesSyntaxHighlightStyle } from "./cm-highlight-style.ts";
import { cmLanguageExtension } from "./cm-language.ts";
import { EDITOR_THEME } from "./code-mirror-editor-theme.ts";
import {
  computeSearchState,
  createEditorSearchQuery,
  DEFAULT_SEARCH_OPTIONS,
  type EditorSearchOptionKey,
  type EditorSearchOptions,
  type EditorSearchState,
  getRestorableSelection,
} from "./code-mirror-search-state.ts";
import type {
  FileEditorAdapterProps,
  FilesDocumentLanguage,
} from "./files-document-types.ts";
import {
  clearFilesEditorViews,
  registerFilesEditorView,
} from "./files-editor-view-registry.ts";
import { FilesSearchBar } from "./files-search-bar.tsx";

const KNOWN_LANGUAGE_IDS: Record<FilesDocumentLanguage, true> = {
  cpp: true,
  css: true,
  go: true,
  html: true,
  java: true,
  javascript: true,
  json: true,
  kotlin: true,
  markdown: true,
  python: true,
  ruby: true,
  rust: true,
  shell: true,
  sql: true,
  swift: true,
  text: true,
  toml: true,
  typescript: true,
  xml: true,
  yaml: true,
};

interface EditorSessionSnapshot {
  documentId: string;
  selection: EditorSelection;
}

const editorSessionSnapshotsById = new Map<string, EditorSessionSnapshot>();

function normalizeLanguage(
  language: FilesDocumentLanguage | string
): FilesDocumentLanguage {
  return language in KNOWN_LANGUAGE_IDS
    ? (language as FilesDocumentLanguage)
    : "text";
}

export function clearCodeMirrorDocumentState(documentId?: string): void {
  clearFilesEditorViews(documentId);
  if (!documentId) {
    editorSessionSnapshotsById.clear();
    return;
  }
  for (const [editorSessionId, snapshot] of editorSessionSnapshotsById) {
    if (snapshot.documentId === documentId) {
      editorSessionSnapshotsById.delete(editorSessionId);
    }
  }
}

export function CodeMirrorEditor({
  documentId,
  editorSessionId,
  filePath,
  labels,
  language,
  onChange,
  onEditorContextMenu,
  readOnly = false,
  searchLabels,
  searchRequest,
  value,
}: FileEditorAdapterProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onContextMenuRef = useRef(onEditorContextMenu);
  const syncingExternalValueRef = useRef(false);
  const viewRef = useRef<EditorView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [searchOptions, setSearchOptions] = useState<EditorSearchOptions>(
    DEFAULT_SEARCH_OPTIONS
  );
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [searchState, setSearchState] = useState<EditorSearchState>({
    currentIndex: 0,
    total: 0,
  });
  const openSearchRef = useRef<() => void>(() => undefined);

  latestValueRef.current = value;
  onChangeRef.current = onChange;
  onContextMenuRef.current = onEditorContextMenu;

  const applySearchQuery = useCallback(
    (
      view: EditorView,
      search: string,
      replace: string,
      options: EditorSearchOptions,
      behavior: { navigate?: boolean } = {}
    ) => {
      const query = createEditorSearchQuery(search, replace, options);
      view.dispatch({ effects: setSearchQuery.of(query) });
      if (behavior.navigate && query.valid) {
        findNext(view);
      }
      setSearchState(computeSearchState(view, query));
    },
    []
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusSignal((signal) => signal + 1);
    const view = viewRef.current;
    if (view) {
      applySearchQuery(view, searchValue, replaceValue, searchOptions);
    }
  }, [applySearchQuery, replaceValue, searchOptions, searchValue]);
  openSearchRef.current = openSearch;

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: setSearchQuery.of(
          createEditorSearchQuery("", replaceValue, searchOptions)
        ),
      });
      setSearchState({ currentIndex: 0, total: 0 });
      view.focus();
    }
  }, [replaceValue, searchOptions]);

  const handleSearchChange = useCallback(
    (nextValue: string) => {
      setSearchValue(nextValue);
      const view = viewRef.current;
      if (view) {
        applySearchQuery(view, nextValue, replaceValue, searchOptions, {
          navigate: nextValue.length > 0,
        });
      }
    },
    [applySearchQuery, replaceValue, searchOptions]
  );

  const handleReplaceChange = useCallback(
    (nextValue: string) => {
      setReplaceValue(nextValue);
      const view = viewRef.current;
      if (view) {
        applySearchQuery(view, searchValue, nextValue, searchOptions);
      }
    },
    [applySearchQuery, searchOptions, searchValue]
  );

  const handleSearchOptionChange = useCallback(
    (key: EditorSearchOptionKey, pressed: boolean) => {
      const nextOptions = { ...searchOptions, [key]: pressed };
      setSearchOptions(nextOptions);
      const view = viewRef.current;
      if (view) {
        applySearchQuery(view, searchValue, replaceValue, nextOptions);
      }
    },
    [applySearchQuery, replaceValue, searchOptions, searchValue]
  );

  const handleReplace = useCallback(() => {
    const view = viewRef.current;
    const query = view ? getSearchQuery(view.state) : null;
    if (!view || readOnly || !query?.valid) {
      return;
    }
    replaceNext(view);
    setSearchState(computeSearchState(view, getSearchQuery(view.state)));
  }, [readOnly]);

  const handleReplaceAll = useCallback(() => {
    const view = viewRef.current;
    const query = view ? getSearchQuery(view.state) : null;
    if (!view || readOnly || !query?.valid) {
      return;
    }
    replaceAll(view);
    setSearchState(computeSearchState(view, getSearchQuery(view.state)));
  }, [readOnly]);

  const handleSelectAllMatches = useCallback(() => {
    const view = viewRef.current;
    const query = view ? getSearchQuery(view.state) : null;
    if (!(view && query?.valid)) {
      return;
    }
    selectMatches(view);
    setSearchState(computeSearchState(view, getSearchQuery(view.state)));
  }, []);

  const handleSearchNavigate = useCallback((direction: "next" | "previous") => {
    const view = viewRef.current;
    const query = view ? getSearchQuery(view.state) : null;
    if (!(view && query?.valid)) {
      return;
    }
    if (direction === "next") {
      findNext(view);
    } else {
      findPrevious(view);
    }
    setSearchState(computeSearchState(view, query));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const languageId = normalizeLanguage(language);
    const extensions = [
      Prec.highest(
        EditorView.domEventHandlers({
          // Cmd/Ctrl+F 打开项目规范搜索栏。高优先级 DOM handler 装在
          // basicSetup 前,稳定压过默认 openSearchPanel。
          keydown: (event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              !event.shiftKey &&
              event.key.toLowerCase() === "f"
            ) {
              event.preventDefault();
              openSearchRef.current();
              return true;
            }
            return false;
          },
        })
      ),
      codeMirrorSearch(),
      basicSetup,
      EditorView.contentAttributes.of({
        "aria-label": labels?.sourceEditor ?? "Source editor",
      }),
      EditorView.editorAttributes.of({ class: "h-full" }),
      EDITOR_THEME,
      // 语法高亮 palette 优先于 basicSetup 里的 defaultHighlightStyle(fallback:true)
      // 生效,不需要显式把 default 剔除。
      syntaxHighlighting(filesSyntaxHighlightStyle),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        setSearchState(
          computeSearchState(update.view, getSearchQuery(update.state))
        );
        if (syncingExternalValueRef.current) {
          return;
        }
        onChangeRef.current?.(update.state.doc.toString());
      }),
      // contextmenu 挂在 editor DOM 上 —— shell 事件冒到宿主,拿 selection 拼
      // metadata 转发给上层 popup。preventDefault 拒绝 Electron 默认菜单;
      // 无外接 handler 时不拦截,继续走浏览器默认。
      EditorView.domEventHandlers({
        contextmenu: (event, view) => {
          const handler = onContextMenuRef.current;
          if (!handler) {
            return false;
          }
          const ranges = view.state.selection.ranges.map((range) => {
            const startLine = view.state.doc.lineAt(range.from);
            const endLine = view.state.doc.lineAt(range.to);
            return {
              from: range.from,
              to: range.to,
              startLine: startLine.number,
              endLine: endLine.number,
              startCol: range.from - startLine.from + 1,
              endCol: range.to - endLine.from + 1,
            };
          });
          handler(event, ranges);
          return true;
        },
      }),
      EditorView.editable.of(!readOnly),
    ];

    const languageExtension = cmLanguageExtension(languageId, filePath);
    if (languageExtension) {
      extensions.push(languageExtension);
    }

    const mountedDocumentId = documentId;
    const mountedEditorSessionId = editorSessionId;
    const cachedSnapshot =
      mountedDocumentId == null || mountedEditorSessionId == null
        ? undefined
        : editorSessionSnapshotsById.get(mountedEditorSessionId);
    const selectionSnapshot =
      cachedSnapshot && cachedSnapshot.documentId === mountedDocumentId
        ? getRestorableSelection(
            cachedSnapshot.selection,
            latestValueRef.current.length
          )
        : undefined;
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: latestValueRef.current,
        extensions,
        ...(selectionSnapshot ? { selection: selectionSnapshot } : {}),
      }),
    });
    viewRef.current = view;
    const unregisterView =
      mountedDocumentId && mountedEditorSessionId
        ? registerFilesEditorView({
            documentId: mountedDocumentId,
            editorSessionId: mountedEditorSessionId,
            view,
          })
        : undefined;

    return () => {
      unregisterView?.();
      if (mountedDocumentId && mountedEditorSessionId) {
        editorSessionSnapshotsById.set(mountedEditorSessionId, {
          documentId: mountedDocumentId,
          selection: view.state.selection,
        });
      }
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
  }, [
    documentId,
    editorSessionId,
    filePath,
    labels?.sourceEditor,
    language,
    readOnly,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    syncingExternalValueRef.current = true;
    view.dispatch({
      changes: { from: 0, insert: value, to: currentValue.length },
    });
    syncingExternalValueRef.current = false;
  }, [value]);

  // 单调递增的 searchRequest —— 每次值变更(chrome 里点 Search 图标)就打开
  // 项目规范搜索栏。0 = 初始未触发,不 open。
  useEffect(() => {
    if (!searchRequest) {
      return;
    }
    openSearchRef.current();
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
        ref={containerRef}
      />
    </div>
  );
}
