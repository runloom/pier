import { SearchQuery } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "codemirror";

const SEARCH_MATCH_SCAN_LIMIT = 5000;

export interface EditorSearchState {
  currentIndex: number;
  total: number;
}

export interface EditorSearchOptions {
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export type EditorSearchOptionKey = keyof EditorSearchOptions;

export const DEFAULT_SEARCH_OPTIONS: EditorSearchOptions = {
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
};

export function createEditorSearchQuery(
  search: string,
  replace: string,
  options: EditorSearchOptions
): SearchQuery {
  return new SearchQuery({
    caseSensitive: options.caseSensitive,
    regexp: options.regexp,
    replace,
    search,
    wholeWord: options.wholeWord,
  });
}

export function computeSearchState(
  view: EditorView,
  query: SearchQuery
): EditorSearchState {
  if (!query.valid) {
    return { currentIndex: 0, total: 0 };
  }
  const cursor = query.getCursor(view.state);
  const main = view.state.selection.main;
  let total = 0;
  let currentIndex = 0;
  while (total < SEARCH_MATCH_SCAN_LIMIT) {
    const step = cursor.next();
    if (step.done) {
      break;
    }
    total += 1;
    if (step.value.from === main.from && step.value.to === main.to) {
      currentIndex = total;
    }
  }
  return { currentIndex, total };
}

function clampPositionToDocument(pos: number, documentLength: number): number {
  return Math.max(0, Math.min(pos, documentLength));
}

export function getRestorableSelection(
  selection: EditorSelection,
  documentLength: number
): EditorSelection {
  const isSelectionInsideDocument = selection.ranges.every(
    (range) => range.from <= documentLength && range.to <= documentLength
  );
  if (isSelectionInsideDocument) {
    return selection;
  }
  return EditorSelection.single(
    clampPositionToDocument(selection.main.head, documentLength)
  );
}
