import {
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchCursor,
  selectMatches,
  selectNextOccurrence,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";
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
import { applyFileEditorScrollTop } from "./view-scroll.ts";

export type FileEditorCommand = "copy" | "cut" | "paste" | "selectAll";

export type FileEditorViewCommand = (view: EditorView) => boolean;

export function runEditorViewCommand(
  view: EditorView | null,
  command: FileEditorViewCommand
): boolean {
  return view ? command(view) : false;
}

/**
 * VS Code `⌘D` uses `revealRangeInCenterIfOutsideViewport`.
 * Do not consult CodeMirror `visibleRanges` / `viewport`: those include ~1000px
 * of overscan, so a match below the fold still looks "on screen" and
 * `y: "nearest"` parks it on the last visible line.
 */
export function occurrenceRevealY(input: {
  matchBottom: number;
  matchTop: number;
  viewportBottom: number;
  viewportTop: number;
}): "center" | "nearest" {
  return input.matchTop >= input.viewportTop &&
    input.matchBottom <= input.viewportBottom
    ? "nearest"
    : "center";
}

function occurrenceScrollY(
  view: EditorView,
  pos: number
): "center" | "nearest" {
  const coords = view.coordsAtPos(pos);
  if (!coords) {
    return "center";
  }
  const scroller = view.scrollDOM;
  const viewportTop = scroller.getBoundingClientRect().top;
  return occurrenceRevealY({
    matchBottom: coords.bottom,
    matchTop: coords.top,
    viewportBottom: viewportTop + scroller.clientHeight,
    viewportTop,
  });
}

export function selectNextEditorOccurrence(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.some((range) => range.empty)) {
    return selectNextOccurrence(view);
  }
  const query = state.sliceDoc(
    state.selection.main.from,
    state.selection.main.to
  );
  if (
    state.selection.ranges.some(
      (range) => state.sliceDoc(range.from, range.to) !== query
    )
  ) {
    return false;
  }
  const next = findNextOccurrenceRange(state, query);
  if (!next) {
    return false;
  }
  const y = occurrenceScrollY(view, next.from);
  const selection = state.selection.addRange(
    EditorSelection.range(next.from, next.to),
    false
  );
  if (y === "nearest") {
    view.dispatch({
      effects: EditorView.scrollIntoView(next.from, { y: "nearest" }),
      selection,
    });
    return true;
  }
  view.dispatch({ selection });
  centerOccurrenceInScroller(view, next.from);
  return true;
}

function centerOccurrenceInScroller(view: EditorView, pos: number): void {
  const height = view.scrollDOM.clientHeight;
  if (height <= 0) {
    return;
  }
  const block = view.lineBlockAt(pos);
  applyFileEditorScrollTop(view, (block.top + block.bottom) / 2 - height / 2);
}

export function selectAllEditorOccurrences(view: EditorView): boolean {
  if (
    view.state.selection.ranges.some((range) => range.empty) &&
    !selectNextOccurrence(view)
  ) {
    return false;
  }
  const { state } = view;
  const query = state.sliceDoc(
    state.selection.main.from,
    state.selection.main.to
  );
  if (
    query.length === 0 ||
    state.selection.ranges.some(
      (range) => state.sliceDoc(range.from, range.to) !== query
    )
  ) {
    return false;
  }
  const matchWholeWord = rangeIsWholeWord(
    state,
    state.selection.main.from,
    state.selection.main.to
  );
  const ranges: SelectionRange[] = [];
  const cursor = new SearchCursor(state.doc, query);
  for (;;) {
    cursor.next();
    if (cursor.done) {
      break;
    }
    const match = cursor.value;
    if (matchWholeWord && !rangeIsWholeWord(state, match.from, match.to)) {
      continue;
    }
    ranges.push(EditorSelection.range(match.from, match.to));
    if (ranges.length > 1000) {
      return false;
    }
  }
  if (ranges.length === 0) {
    return false;
  }
  const mainFrom = state.selection.main.from;
  const mainIndex = Math.max(
    0,
    ranges.findIndex((range) => range.from === mainFrom)
  );
  view.dispatch({
    selection: EditorSelection.create(ranges, mainIndex),
  });
  return true;
}

export function addEditorCursorAbove(view: EditorView): boolean {
  return addEditorCursorVertically(view, false);
}

export function addEditorCursorBelow(view: EditorView): boolean {
  return addEditorCursorVertically(view, true);
}

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

function findNextOccurrenceRange(
  state: EditorState,
  query: string
): { from: number; to: number } | null {
  const { main, ranges } = state.selection;
  const last = ranges.at(-1);
  if (!last) {
    return null;
  }
  const matchWholeWord = rangeIsWholeWord(state, main.from, main.to);
  let wrapped = false;
  let cursor = new SearchCursor(state.doc, query, last.to);
  for (;;) {
    cursor.next();
    if (cursor.done) {
      if (wrapped) {
        return null;
      }
      cursor = new SearchCursor(
        state.doc,
        query,
        0,
        Math.max(0, last.from - 1)
      );
      wrapped = true;
      continue;
    }
    const match = cursor.value;
    if (wrapped && ranges.some((range) => range.from === match.from)) {
      continue;
    }
    if (matchWholeWord && !rangeIsWholeWord(state, match.from, match.to)) {
      continue;
    }
    return match;
  }
}

function rangeIsWholeWord(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const word = state.wordAt(from);
  return word !== null && word.from === from && word.to === to;
}

function addEditorCursorVertically(
  view: EditorView,
  forward: boolean
): boolean {
  const { state } = view;
  const ranges = state.selection.ranges.slice();
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (!(forward ? line.to < state.doc.length : line.from > 0)) {
      continue;
    }
    let current = range;
    for (;;) {
      const next = view.moveVertically(current, forward);
      if (next.head < line.from || next.head > line.to) {
        if (!ranges.some((candidate) => candidate.head === next.head)) {
          ranges.push(next);
        }
        break;
      }
      if (next.head === current.head) {
        break;
      }
      current = next;
    }
  }
  if (ranges.length === state.selection.ranges.length) {
    return false;
  }
  view.dispatch({
    selection: EditorSelection.create(ranges, ranges.length - 1),
  });
  return true;
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
