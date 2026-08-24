import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createGitGutterExtension } from "@plugins/builtin/files/renderer/editor/git-gutter.ts";
import {
  createMinimapExtension,
  isMinimapEligibleDoc,
} from "@plugins/builtin/files/renderer/editor/minimap.ts";
import { afterEach, describe, expect, it } from "vitest";

const views: EditorView[] = [];

function mountView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [createGitGutterExtension(), createMinimapExtension()],
    }),
  });
  views.push(view);
  return view;
}

function minimapDom(view: EditorView): HTMLElement | null {
  return view.dom.querySelector(".cm-minimap-gutter");
}

function replaceDocument(view: EditorView, contents: string): void {
  view.dispatch({
    changes: {
      from: 0,
      insert: contents,
      to: view.state.doc.length,
    },
  });
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

describe("minimap document-size gating", () => {
  it("mounts the minimap for normal documents", () => {
    const view = mountView("const a = 1;\nconst b = 2;\n");
    expect(minimapDom(view)).not.toBeNull();
  });

  it("skips the minimap for oversized single lines (minified bundles)", () => {
    // node_modules minified 文件：单行超长，fillText 会收到整段字符串。
    const minified = `!function(){"use strict";${"a".repeat(25_000)}}();`;
    const view = mountView(minified);
    expect(minimapDom(view)).toBeNull();
  });

  it("skips the minimap for oversized documents", () => {
    const line = "x".repeat(80);
    const contents = `${Array.from({ length: 60_000 }, () => line).join("\n")}`;
    expect(contents.length).toBeGreaterThan(1_500_000);
    const view = mountView(contents);
    expect(minimapDom(view)).toBeNull();
  });

  it("removes the minimap when the document is replaced with an oversized one", () => {
    const view = mountView("const a = 1;\n");
    expect(minimapDom(view)).not.toBeNull();
    replaceDocument(view, "x".repeat(30_000));
    expect(minimapDom(view)).toBeNull();
  });

  it("restores the minimap when an oversized document is replaced with a small one", () => {
    const view = mountView("x".repeat(30_000));
    expect(minimapDom(view)).toBeNull();
    replaceDocument(view, "const a = 1;\n");
    expect(minimapDom(view)).not.toBeNull();
  });

  it("removes the minimap when an incremental paste creates an oversized line", () => {
    const view = mountView("const a = 1;\nconst b = 2;\n");
    expect(minimapDom(view)).not.toBeNull();
    view.dispatch({ changes: { from: 0, insert: "x".repeat(30_000) } });
    expect(minimapDom(view)).toBeNull();
  });

  it("isMinimapEligibleDoc gates by length, lines, and longest line", () => {
    const normal = EditorState.create({ doc: "a\nb\n" }).doc;
    const singleMonster = EditorState.create({ doc: "x".repeat(30_000) }).doc;
    const manyLines = EditorState.create({
      doc: `${Array.from({ length: 60_000 }, () => "x").join("\n")}`,
    }).doc;
    const longDoc = EditorState.create({
      doc: `${Array.from({ length: 40_000 }, () => "x".repeat(50)).join("\n")}`,
    }).doc;

    expect(isMinimapEligibleDoc(normal)).toBe(true);
    expect(isMinimapEligibleDoc(singleMonster)).toBe(false);
    expect(isMinimapEligibleDoc(manyLines)).toBe(false);
    // 2MB total → 超过总量门槛，即使行数与行长都正常。
    expect(longDoc.length).toBeGreaterThan(1_500_000);
    expect(isMinimapEligibleDoc(longDoc)).toBe(false);
  });
});
