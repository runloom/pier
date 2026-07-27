import { expect, it } from "vitest";
import { documentOffsetAtLineChar } from "../../../src/plugins/builtin/files/renderer/files-content-search-open.ts";

it("maps line+char onto LF-normalized document offsets", () => {
  const text = "first\nsecond\nthird";
  expect(documentOffsetAtLineChar(text, 1, 0)).toBe(0);
  expect(documentOffsetAtLineChar(text, 1, 2)).toBe(2);
  // line 2 starts after "first\n" (6)
  expect(documentOffsetAtLineChar(text, 2, 0)).toBe(6);
  expect(documentOffsetAtLineChar(text, 2, 3)).toBe(9);
  expect(documentOffsetAtLineChar(text, 3, 0)).toBe(13);
});

it("clamps past end of document", () => {
  const text = "ab\ncd";
  expect(documentOffsetAtLineChar(text, 99, 0)).toBe(text.length);
  expect(documentOffsetAtLineChar(text, 1, 100)).toBe(2);
});
