import { EditorState, RangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  clearGitGutterMarkers,
  createGitGutterExtension,
  gitGutterField,
  markersToMinimapGutter,
  resolveScmDiffColors,
  setGitGutterMarkers,
} from "@plugins/builtin/files/renderer/editor/git-gutter.ts";
import { createMinimapExtension } from "@plugins/builtin/files/renderer/editor/minimap.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function firstGutterFrom(ranges: RangeSet<unknown>): number | null {
  const cursor = ranges.iter();
  if (!cursor.value) {
    return null;
  }
  return cursor.from;
}

describe("markersToMinimapGutter", () => {
  const colors = {
    added: "rgb(1, 2, 3)",
    deleted: "rgb(4, 5, 6)",
    modified: "rgb(7, 8, 9)",
  };

  it("returns empty object for empty markers", () => {
    expect(markersToMinimapGutter(new Map(), colors)).toEqual({});
  });

  it("maps each kind to its resolved color", () => {
    const markers = new Map([
      [2, { count: 1, kind: "added" as const }],
      [5, { count: 1, kind: "modified" as const }],
      [9, { count: 3, kind: "deleted" as const }],
    ]);
    expect(markersToMinimapGutter(markers, colors)).toEqual({
      2: "rgb(1, 2, 3)",
      5: "rgb(7, 8, 9)",
      9: "rgb(4, 5, 6)",
    });
  });

  it("skips out-of-range lines when maxLine is set", () => {
    const markers = new Map([
      [1, { count: 1, kind: "added" as const }],
      [10, { count: 1, kind: "added" as const }],
    ]);
    expect(markersToMinimapGutter(markers, colors, { maxLine: 5 })).toEqual({
      1: "rgb(1, 2, 3)",
    });
  });

  it("skips kinds whose color token resolved empty", () => {
    const markers = new Map([
      [1, { count: 1, kind: "added" as const }],
      [2, { count: 1, kind: "modified" as const }],
    ]);
    expect(
      markersToMinimapGutter(markers, {
        added: "",
        deleted: "red",
        modified: "blue",
      })
    ).toEqual({ 2: "blue" });
  });
});

describe("resolveScmDiffColors", () => {
  it("reads product diff CSS variables from the scope element", () => {
    const el = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => {
        if (name === "--diff-addition-fg") {
          return "  #0dbe4e ";
        }
        if (name === "--diff-deletion-fg") {
          return "#ff2e3f";
        }
        if (name === "--diff-modification-fg") {
          return "#009fff";
        }
        return "";
      },
    } as CSSStyleDeclaration);

    expect(resolveScmDiffColors(el)).toEqual({
      added: "#0dbe4e",
      deleted: "#ff2e3f",
      modified: "#009fff",
    });
  });
});

describe("git gutter + minimap field wiring", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent?.remove();
    }
    views.length = 0;
    vi.restoreAllMocks();
  });

  function mountView(doc = "a\nb\nc\nd\ne\n"): EditorView {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => {
        if (name === "--diff-addition-fg") {
          return "#00ff00";
        }
        if (name === "--diff-deletion-fg") {
          return "#ff0000";
        }
        if (name === "--diff-modification-fg") {
          return "#0000ff";
        }
        return "";
      },
    } as CSSStyleDeclaration);

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

  it("setGitGutterMarkers writes markers and minimap gutter colors", () => {
    const view = mountView();
    setGitGutterMarkers(
      view,
      new Map([
        [1, { count: 1, kind: "added" }],
        [3, { count: 1, kind: "modified" }],
        [5, { count: 2, kind: "deleted" }],
      ])
    );
    const state = view.state.field(gitGutterField);
    expect(state.markers.size).toBe(3);
    expect(state.minimapGutter).toEqual({
      1: "#00ff00",
      3: "#0000ff",
      5: "#ff0000",
    });
  });

  it("skips marker lines beyond document length in minimap gutter", () => {
    const view = mountView("only\ntwo\n");
    setGitGutterMarkers(
      view,
      new Map([
        [1, { count: 1, kind: "added" }],
        [99, { count: 1, kind: "added" }],
      ])
    );
    expect(view.state.field(gitGutterField).minimapGutter).toEqual({
      1: "#00ff00",
    });
  });

  it("clearGitGutterMarkers empties both surfaces", () => {
    const view = mountView();
    setGitGutterMarkers(view, new Map([[2, { count: 1, kind: "added" }]]));
    clearGitGutterMarkers(view);
    const state = view.state.field(gitGutterField);
    expect(state.markers.size).toBe(0);
    expect(state.minimapGutter).toEqual({});
  });

  it("is a no-op when markers and colors are unchanged", () => {
    const view = mountView();
    const markers = new Map([[1, { count: 1, kind: "added" as const }]]);
    setGitGutterMarkers(view, markers);
    const afterFirst = view.state;
    setGitGutterMarkers(view, markers);
    expect(view.state).toBe(afterFirst);
  });

  it("rebuilds left gutter ranges after doc edit even when marker content matches", () => {
    const view = mountView("a\nb\nc\n");
    const markerPayload = { count: 1, kind: "added" as const };
    setGitGutterMarkers(view, new Map([[2, markerPayload]]));
    const before = view.state.field(gitGutterField).gutterMarkers;
    const fromBefore = firstGutterFrom(before);
    expect(fromBefore).toBe(view.state.doc.line(2).from);

    // 插入文首行后，field 不 map RangeSet（历史行为）；重放同语义 markers 必须重建锚点。
    view.dispatch({ changes: { from: 0, insert: "NEW\n" } });
    expect(view.state.field(gitGutterField).gutterMarkers).toBe(before);

    setGitGutterMarkers(view, new Map([[2, markerPayload]]));
    const after = view.state.field(gitGutterField).gutterMarkers;
    expect(RangeSet.eq([before], [after])).toBe(false);
    expect(firstGutterFrom(after)).toBe(view.state.doc.line(2).from);
  });

  it("theme resync microtask does not revive markers cleared before flush", async () => {
    const view = mountView();
    setGitGutterMarkers(
      view,
      new Map([[1, { count: 1, kind: "added" as const }]])
    );
    expect(view.state.field(gitGutterField).markers.size).toBe(1);

    // MutationObserver 以 microtask 投递；下一拍清场，再等 resync 的 queueMicrotask。
    document.documentElement.classList.add("pier-scm-theme-resync-test");
    await Promise.resolve();
    clearGitGutterMarkers(view);
    expect(view.state.field(gitGutterField).markers.size).toBe(0);
    await Promise.resolve();
    expect(view.state.field(gitGutterField).markers.size).toBe(0);
    expect(view.state.field(gitGutterField).minimapGutter).toEqual({});

    document.documentElement.classList.remove("pier-scm-theme-resync-test");
  });

  it("theme class change re-resolves minimap colors without changing markers", async () => {
    let addition = "#00ff00";
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => {
        if (name === "--diff-addition-fg") {
          return addition;
        }
        if (name === "--diff-deletion-fg") {
          return "#ff0000";
        }
        if (name === "--diff-modification-fg") {
          return "#0000ff";
        }
        return "";
      },
    } as CSSStyleDeclaration);

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "a\nb\n",
        extensions: [createGitGutterExtension(), createMinimapExtension()],
      }),
    });
    views.push(view);

    const markers = new Map([[1, { count: 1, kind: "added" as const }]]);
    setGitGutterMarkers(view, markers);
    expect(view.state.field(gitGutterField).minimapGutter).toEqual({
      1: "#00ff00",
    });

    addition = "#abcdef";
    document.documentElement.classList.add("pier-scm-theme-color-test");
    await Promise.resolve();
    await Promise.resolve();

    expect(view.state.field(gitGutterField).markers).toBe(markers);
    expect(view.state.field(gitGutterField).minimapGutter).toEqual({
      1: "#abcdef",
    });

    document.documentElement.classList.remove("pier-scm-theme-color-test");
  });
});
