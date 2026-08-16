import { EditorSelection, EditorState } from "@codemirror/state";
import {
  editorStateCurrentLine,
  editorStateRanges,
  editorStateSelectionLines,
} from "@plugins/builtin/files/renderer/editor/view-operations.ts";
import { describe, expect, it } from "vitest";

const DOC = "one\ntwo\nthree\n";

function stateWithSelection(selection: EditorSelection): EditorState {
  return EditorState.create({
    doc: DOC,
    extensions: EditorState.allowMultipleSelections.of(true),
    selection,
  });
}

describe("editor selection line ranges", () => {
  it("treats a caret as a single line", () => {
    const state = stateWithSelection(EditorSelection.cursor(4));

    expect(editorStateCurrentLine(state)).toBe(2);
    expect(editorStateSelectionLines(state)).toEqual({
      endLine: 2,
      startLine: 2,
    });
  });

  it("drops the exclusive end line when the range ends at the next line start", () => {
    const state = stateWithSelection(EditorSelection.range(0, 8));

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
    const state = stateWithSelection(EditorSelection.range(0, 10));

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
