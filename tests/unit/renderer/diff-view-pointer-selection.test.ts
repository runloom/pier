import { describe, expect, it } from "vitest";
import { selectionFromPointerDrag } from "../../../packages/ui/src/diff-view-pointer-selection.ts";

describe("selectionFromPointerDrag", () => {
  it("builds a same-side range from anchor to current", () => {
    expect(
      selectionFromPointerDrag(
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 11,
          side: "additions",
        },
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 17,
          side: "additions",
        }
      )
    ).toEqual({
      id: "file-a",
      range: {
        end: 17,
        side: "additions",
        start: 11,
      },
    });
  });

  it("returns null when dragging across different items", () => {
    expect(
      selectionFromPointerDrag(
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 3,
          side: "additions",
        },
        {
          fromNumberColumn: false,
          id: "file-b",
          lineNumber: 5,
          side: "additions",
        }
      )
    ).toBeNull();
  });

  it("pins to anchor side when current side differs", () => {
    expect(
      selectionFromPointerDrag(
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 8,
          side: "additions",
        },
        {
          fromNumberColumn: false,
          id: "file-a",
          lineNumber: 12,
          side: "deletions",
        }
      )
    ).toEqual({
      id: "file-a",
      range: {
        end: 8,
        side: "additions",
        start: 8,
      },
    });
  });
});
