import { utf8ByteOffsetToStringIndex } from "@shared/text/utf8-byte-offset.ts";
import { expect, it } from "vitest";

it("maps multi-byte UTF-8 offsets to string indices", () => {
  const text = "ab世界cd";
  expect(utf8ByteOffsetToStringIndex(text, 0)).toBe(0);
  expect(utf8ByteOffsetToStringIndex(text, 2)).toBe(2);
  // 世 is 3 bytes → offset 5 is start of 界
  expect(utf8ByteOffsetToStringIndex(text, 5)).toBe(3);
  expect(utf8ByteOffsetToStringIndex(text, 100)).toBe(text.length);
});
