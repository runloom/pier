import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createGitGutterExtension,
  gitGutterField,
  setGitGutterModel,
} from "@plugins/builtin/files/renderer/editor/git-gutter.ts";
import {
  fileChangePeekField,
  mountFileChangePeek,
} from "@plugins/builtin/files/renderer/git-changes/source-widget.ts";
import { afterEach, describe, expect, it } from "vitest";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
});
function editor() {
  const view = new EditorView({
    state: EditorState.create({
      doc: "one\ntwo\nthree\nfour",
      selection: { anchor: 2, head: 6 },
      extensions: [createGitGutterExtension()],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}
describe("inline source change peek", () => {
  it("inserts a block after the clicked line, preserves selection, and closes on edit", () => {
    const view = editor();
    const selection = view.state.selection.toJSON();
    const host = document.createElement("div");
    host.textContent = "diff excerpt";
    const close = mountFileChangePeek(view, 2, host);
    expect(view.state.selection.toJSON()).toEqual(selection);
    expect(view.state.field(fileChangePeekField).iter().from).toBe(
      view.state.doc.line(2).to
    );
    expect(host.isConnected).toBe(true);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(view.state.field(fileChangePeekField).size).toBe(0);
    close();
  });
  it("maps untouched markers through edits and disables stale hit ranges", () => {
    const view = editor();
    setGitGutterModel(view, {
      markers: new Map([[3, { count: 1, kind: "modified" }]]),
      ranges: [{ id: "1:0", newLineFrom: 3, newLineTo: 3, kind: "modified" }],
    });
    view.dispatch({ changes: { from: 0, insert: "prefix\n" } });
    expect(view.state.field(gitGutterField).markers.has(4)).toBe(true);
    expect(view.state.field(gitGutterField).ranges).toEqual([]);
    const line = view.state.doc.line(4);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "changed" },
    });
    expect(view.state.field(gitGutterField).markers.size).toBe(0);
  });
});
