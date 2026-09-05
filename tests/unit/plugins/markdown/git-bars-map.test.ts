import {
  clipBoxToGitRange,
  mapGitRangesToPreviewBars,
} from "@plugins/builtin/files/renderer/markdown/git-bars/map.ts";
import {
  markdownGitBarBoxesEqual,
  selectGitBarSourceElements,
} from "@plugins/builtin/files/renderer/markdown/git-bars/measure.ts";
import { describe, expect, it } from "vitest";

describe("mapGitRangesToPreviewBars", () => {
  it("keeps a deletion in a lazy page off earlier rendered blocks, including EOF", () => {
    for (const line of [400, 501]) {
      expect(
        mapGitRangesToPreviewBars({
          blocks: [{ startLine: 1, endLine: 40, top: 0, height: 400 }],
          unrenderedPages: [{ startLine: 41, endLine: 500 }],
          ranges: [
            {
              id: "lazy-delete",
              kind: "deleted",
              newLineFrom: line,
              newLineTo: line,
            },
          ],
        })
      ).toEqual([]);
    }
  });
  it("clips overlapping source boxes to the change-range line span", () => {
    const segments = mapGitRangesToPreviewBars({
      blocks: [
        { endLine: 4, height: 40, startLine: 1, top: 10 },
        { endLine: 8, height: 20, startLine: 5, top: 60 },
        { endLine: 20, height: 80, startLine: 9, top: 100 },
      ],
      ranges: [
        {
          id: "0:0",
          kind: "added",
          newLineFrom: 3,
          newLineTo: 7,
        },
      ],
    });
    expect(segments).toEqual([
      {
        height: 45,
        id: "0:0",
        kind: "added",
        newLineFrom: 3,
        newLineTo: 7,
        top: 30,
      },
    ]);
  });

  it("does not paint a whole outer box for a one-line edit", () => {
    const segments = mapGitRangesToPreviewBars({
      blocks: [{ endLine: 8, height: 100, startLine: 4, top: 0 }],
      ranges: [{ id: "0:0", kind: "modified", newLineFrom: 5, newLineTo: 5 }],
    });
    expect(segments).toEqual([
      {
        height: 20,
        id: "0:0",
        kind: "modified",
        newLineFrom: 5,
        newLineTo: 5,
        top: 20,
      },
    ]);
  });

  it("skips ranges that miss every rendered box", () => {
    expect(
      mapGitRangesToPreviewBars({
        blocks: [{ endLine: 4, height: 40, startLine: 1, top: 0 }],
        ranges: [
          {
            id: "1:0",
            kind: "modified",
            newLineFrom: 20,
            newLineTo: 22,
          },
        ],
      })
    ).toEqual([]);
  });

  it("paints modified above added above deleted", () => {
    const segments = mapGitRangesToPreviewBars({
      blocks: [{ endLine: 10, height: 50, startLine: 1, top: 0 }],
      ranges: [
        { id: "d", kind: "deleted", newLineFrom: 1, newLineTo: 1 },
        { id: "m", kind: "modified", newLineFrom: 2, newLineTo: 3 },
        { id: "a", kind: "added", newLineFrom: 4, newLineTo: 5 },
      ],
    });
    expect(segments.map((segment) => segment.kind)).toEqual([
      "deleted",
      "added",
      "modified",
    ]);
  });

  it("uses the minimum bar height when a box has no pixels", () => {
    const segments = mapGitRangesToPreviewBars({
      blocks: [{ endLine: 1, height: 0, startLine: 1, top: 8 }],
      ranges: [{ id: "0:0", kind: "added", newLineFrom: 1, newLineTo: 1 }],
    });
    expect(segments[0]?.height).toBe(3);
    expect(segments[0]?.top).toBe(8);
  });
});

describe("clipBoxToGitRange", () => {
  it("returns null when the box misses the range", () => {
    expect(
      clipBoxToGitRange(
        { endLine: 4, height: 40, startLine: 1, top: 0 },
        { newLineFrom: 10, newLineTo: 12 }
      )
    ).toBeNull();
  });
});

describe("selectGitBarSourceElements", () => {
  it("uses the page itself when no inner source-line nodes exist", () => {
    const page = document.createElement("section");
    page.dataset.slot = "markdown-page";
    page.dataset.markdownPageRendered = "true";
    page.dataset.sourceLine = "1";
    page.dataset.sourceEndLine = "12";
    expect(selectGitBarSourceElements(page)).toEqual([page]);
  });

  it("skips unrendered lazy pages so estimated height is not painted", () => {
    const page = document.createElement("section");
    page.dataset.slot = "markdown-page";
    page.dataset.markdownPageRendered = "false";
    page.dataset.sourceLine = "1";
    page.dataset.sourceEndLine = "80";
    page.style.minHeight = "1600px";
    expect(selectGitBarSourceElements(page)).toEqual([]);
  });

  it("keeps innermost source-line nodes and skips outer lists", () => {
    const page = document.createElement("section");
    page.dataset.slot = "markdown-page";
    page.dataset.markdownPageRendered = "true";
    page.dataset.sourceLine = "1";
    page.dataset.sourceEndLine = "20";
    page.innerHTML = `
      <p data-source-line="1" data-source-end-line="3">outer</p>
      <ul data-source-line="4" data-source-end-line="8">
        <li data-source-line="5" data-source-end-line="6">nested</li>
      </ul>
    `;
    const selected = selectGitBarSourceElements(page);
    expect(selected.map((node) => node.tagName)).toEqual(["P", "LI"]);
  });
});

describe("markdownGitBarBoxesEqual", () => {
  it("treats sub-pixel jitter as equal", () => {
    const box = { endLine: 4, height: 40, startLine: 1, top: 10 };
    expect(
      markdownGitBarBoxesEqual([box], [{ ...box, height: 40.2, top: 10.4 }])
    ).toBe(true);
    expect(
      markdownGitBarBoxesEqual([box], [{ ...box, height: 41, top: 10 }])
    ).toBe(false);
  });
});
