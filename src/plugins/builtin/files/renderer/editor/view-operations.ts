import {
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import type { EditorRange } from "../document/types.ts";
import {
  computeSearchState,
  createEditorSearchQuery,
  DEFAULT_SEARCH_OPTIONS,
  type EditorSearchOptions,
  type EditorSearchState,
  EMPTY_EDITOR_SEARCH_STATE,
} from "./cm-search-state.ts";

export type FileEditorCommand = "copy" | "cut" | "paste" | "selectAll";

export function applyEditorSearchQuery(
  view: EditorView | null,
  search: string,
  replace: string,
  options: EditorSearchOptions,
  navigate = false
): EditorSearchState {
  if (!view) {
    return EMPTY_EDITOR_SEARCH_STATE;
  }
  const query = createEditorSearchQuery(search, replace, options);
  view.dispatch({ effects: setSearchQuery.of(query) });
  if (navigate && query.valid) {
    findNext(view);
  }
  return computeSearchState(view, query);
}

export function clearEditorSearch(
  view: EditorView | null,
  replace: string,
  options: EditorSearchOptions
): EditorSearchState {
  if (!view) {
    return EMPTY_EDITOR_SEARCH_STATE;
  }
  view.dispatch({
    effects: setSearchQuery.of(createEditorSearchQuery("", replace, options)),
  });
  view.focus();
  return EMPTY_EDITOR_SEARCH_STATE;
}

export function navigateEditorSearch(
  view: EditorView | null,
  direction: "next" | "previous"
): EditorSearchState {
  const query = view ? getSearchQuery(view.state) : null;
  if (!(view && query?.valid)) {
    return EMPTY_EDITOR_SEARCH_STATE;
  }
  if (direction === "next") {
    findNext(view);
  } else {
    findPrevious(view);
  }
  return computeSearchState(view, query);
}

export function replaceEditorSearch(
  view: EditorView | null,
  all: boolean
): EditorSearchState {
  const query = view ? getSearchQuery(view.state) : null;
  if (!(view && query?.valid && isEditorViewEditable(view))) {
    return EMPTY_EDITOR_SEARCH_STATE;
  }
  if (all) {
    replaceAll(view);
  } else {
    replaceNext(view);
  }
  return computeSearchState(view, getSearchQuery(view.state));
}

export function selectAllEditorMatches(
  view: EditorView | null
): EditorSearchState {
  const query = view ? getSearchQuery(view.state) : null;
  if (!(view && query?.valid)) {
    return EMPTY_EDITOR_SEARCH_STATE;
  }
  selectMatches(view);
  return computeSearchState(view, getSearchQuery(view.state));
}

export function currentEditorSearchState(
  view: EditorView | null
): EditorSearchState {
  const query = view ? getSearchQuery(view.state) : null;
  return view && query?.valid
    ? computeSearchState(view, query)
    : EMPTY_EDITOR_SEARCH_STATE;
}

export function resetEditorSearch(view: EditorView): void {
  view.dispatch({
    effects: setSearchQuery.of(
      createEditorSearchQuery("", "", DEFAULT_SEARCH_OPTIONS)
    ),
  });
}

export async function executeEditorViewCommand(
  view: EditorView | null,
  command: FileEditorCommand
): Promise<void> {
  if (!view) {
    return;
  }
  if (command === "selectAll") {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
    return;
  }
  if (command === "paste") {
    if (!isEditorViewEditable(view)) {
      return;
    }
    const text = await navigator.clipboard.readText();
    if (text.length > 0) {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    }
    return;
  }

  const { text, usedLineFallback } = selectionText(view);
  await navigator.clipboard.writeText(text);
  if (command === "cut" && isEditorViewEditable(view)) {
    if (usedLineFallback) {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      view.dispatch({
        changes: {
          from: line.from,
          to: Math.min(line.to + 1, view.state.doc.length),
        },
      });
    } else {
      view.dispatch(view.state.replaceSelection(""));
    }
  }
  view.focus();
}

export function editorStateRanges(state: EditorState): EditorRange[] {
  return state.selection.ranges.map((range) =>
    editorRangeFromOffsets(state, range.from, range.to)
  );
}

export function editorViewRanges(view: EditorView): EditorRange[] {
  return editorStateRanges(view.state);
}

export function editorStateCurrentLine(
  state: EditorState | null | undefined
): number | null {
  return state ? state.doc.lineAt(state.selection.main.head).number : null;
}

export function editorViewCurrentLine(view: EditorView): number {
  return editorStateCurrentLine(view.state) ?? 1;
}

export function editorStateSelectionLines(
  state: EditorState | null | undefined
): { endLine: number; startLine: number } | null {
  if (!state) {
    return null;
  }
  const range = editorRangeFromOffsets(
    state,
    state.selection.main.from,
    state.selection.main.to
  );
  return { endLine: range.endLine, startLine: range.startLine };
}

export function editorViewSelectionLines(
  view: EditorView
): { endLine: number; startLine: number } | null {
  return editorStateSelectionLines(view.state);
}

function editorRangeFromOffsets(
  state: EditorState,
  from: number,
  to: number
): EditorRange {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const startLine = state.doc.lineAt(start);
  let endLine = state.doc.lineAt(end);
  let endCol = end - endLine.from + 1;
  // CodeMirror `to` is exclusive. A non-empty range ending at the next line
  // start should not count that following line (VS Code end.character === 0).
  if (end > start && end === endLine.from && endLine.number > 1) {
    endLine = state.doc.line(endLine.number - 1);
    endCol = endLine.length + 1;
  }
  return {
    endCol,
    endLine: endLine.number,
    from,
    startCol: start - startLine.from + 1,
    startLine: startLine.number,
    to,
  };
}

function isEditorViewEditable(view: EditorView): boolean {
  return view.state.facet(EditorView.editable);
}

function selectionText(view: EditorView): {
  text: string;
  usedLineFallback: boolean;
} {
  const { state } = view;
  const hasSelection = state.selection.ranges.some((range) => !range.empty);
  if (hasSelection) {
    return {
      text: state.selection.ranges
        .filter((range) => !range.empty)
        .map((range) => state.sliceDoc(range.from, range.to))
        .join("\n"),
      usedLineFallback: false,
    };
  }
  const line = state.doc.lineAt(state.selection.main.head);
  return { text: `${line.text}\n`, usedLineFallback: true };
}
