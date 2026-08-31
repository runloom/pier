import { EditorSelection, EditorState } from "@codemirror/state";
import {
  addEditorCursorBelow,
  editorStateCurrentLine,
  editorStateRanges,
  editorStateSelectionLines,
  occurrenceRevealY,
  selectAllEditorOccurrences,
  selectNextEditorOccurrence,
} from "@plugins/builtin/files/renderer/editor/view-operations.ts";
import { EditorView } from "codemirror";
import { afterEach, describe, expect, it } from "vitest";

const DOC = "one\ntwo\nthree\n";

function stateWithSelection(
  selection: EditorSelection | { anchor: number; head?: number }
): EditorState {
  return EditorState.create({
    doc: DOC,
    extensions: EditorState.allowMultipleSelections.of(true),
    selection,
  });
}

describe("editor selection line ranges", () => {
  it("treats a caret as a single line", () => {
    const state = stateWithSelection({ anchor: 4 });

    expect(editorStateCurrentLine(state)).toBe(2);
    expect(editorStateSelectionLines(state)).toEqual({
      endLine: 2,
      startLine: 2,
    });
  });

  it("drops the exclusive end line when the range ends at the next line start", () => {
    const state = stateWithSelection({ anchor: 0, head: 8 });

    expect(editorStateSelectionLines(state)).toEqual({
      endLine: 2,
      startLine: 1,
    });
    expect(editorStateRanges(state)[0]).toMatchObject({
      endCol: 4,
      endLine: 2,
      startCol: 1,
      startLine: 1,
    });
  });

  it("keeps a partial last line when the exclusive end is mid-line", () => {
    const state = stateWithSelection({ anchor: 0, head: 10 });

    expect(editorStateSelectionLines(state)).toEqual({
      endLine: 3,
      startLine: 1,
    });
  });

  it("uses the main selection instead of the first range", () => {
    const state = stateWithSelection(
      EditorSelection.create(
        [EditorSelection.range(0, 4), EditorSelection.range(8, 10)],
        1
      )
    );

    expect(editorStateCurrentLine(state)).toBe(3);
    expect(editorStateSelectionLines(state)).toEqual({
      endLine: 3,
      startLine: 3,
    });
    expect(editorStateRanges(state).map((range) => range.startLine)).toEqual([
      1, 3,
    ]);
  });

  it("returns null without an editor state", () => {
    expect(editorStateCurrentLine(null)).toBeNull();
    expect(editorStateSelectionLines(undefined)).toBeNull();
  });
});

describe("editor occurrence and cursor commands", () => {
  const hosts: HTMLElement[] = [];
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views) {
      view.destroy();
    }
    views.length = 0;
    for (const host of hosts) {
      host.remove();
    }
    hosts.length = 0;
  });

  function createView(
    doc: string,
    selection: { anchor: number; head?: number }
  ): EditorView {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const view = new EditorView({
      doc,
      parent: host,
      extensions: EditorState.allowMultipleSelections.of(true),
      selection,
    });
    views.push(view);
    return view;
  }

  it("adds the next matching word to the selection", () => {
    const view = createView("foo bar foo", { anchor: 0, head: 3 });

    expect(selectNextEditorOccurrence(view)).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(view.state.selection.ranges.map((range) => range.from)).toEqual([
      0, 8,
    ]);
  });

  it("selects the current word then every occurrence", () => {
    const view = createView("foo bar foo", { anchor: 1 });

    expect(selectAllEditorOccurrences(view)).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(view.state.selection.ranges.map((range) => range.from)).toEqual([
      0, 8,
    ]);
  });

  it("selects remaining whole-word matches after a few next-occurrence steps", () => {
    const view = createView("foo foobar foo foo", { anchor: 0, head: 3 });

    expect(selectNextEditorOccurrence(view)).toBe(true);
    expect(selectAllEditorOccurrences(view)).toBe(true);
    expect(
      view.state.selection.ranges.map((range) => range.from).toSorted()
    ).toEqual([0, 11, 15]);
  });

  it("centers a match that is off-screen and leaves an on-screen match in place", () => {
    expect(
      occurrenceRevealY({
        matchBottom: 520,
        matchTop: 500,
        viewportBottom: 400,
        viewportTop: 0,
      })
    ).toBe("center");
    expect(
      occurrenceRevealY({
        matchBottom: 120,
        matchTop: 100,
        viewportBottom: 400,
        viewportTop: 0,
      })
    ).toBe("nearest");
    expect(
      occurrenceRevealY({
        matchBottom: 410,
        matchTop: 390,
        viewportBottom: 400,
        viewportTop: 0,
      })
    ).toBe("center");
  });

  it("wraps to the first match after the last occurrence", () => {
    const view = createView("foo bar foo", { anchor: 8, head: 11 });

    expect(selectNextEditorOccurrence(view)).toBe(true);
    expect(
      view.state.selection.ranges.map((range) => range.from).toSorted()
    ).toEqual([0, 8]);
  });

  it("adds a cursor on the line below", () => {
    const view = createView("foo\nbar\nbaz", { anchor: 1 });

    expect(addEditorCursorBelow(view)).toBe(true);
    const heads = view.state.selection.ranges.map((range) => range.head);
    expect(heads).toHaveLength(2);
    expect(heads).toContain(1);
    expect(heads.some((head) => head > 1)).toBe(true);
  });
});
