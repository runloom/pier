import { patchTaskMarker } from "@plugins/builtin/files/renderer/markdown/task-patch.ts";
import { describe, expect, it } from "vitest";

describe("patchTaskMarker", () => {
  const doc = "- [ ] alpha\n- [x] beta\n- [X] gamma";

  it("checks an unchecked item within range", () => {
    expect(patchTaskMarker(doc, { start: 0, end: 11 }, true)).toBe(
      "- [x] alpha\n- [x] beta\n- [X] gamma"
    );
  });

  it("unchecks checked items (lowercase x)", () => {
    expect(patchTaskMarker(doc, { start: 12, end: 23 }, false)).toBe(
      "- [ ] alpha\n- [ ] beta\n- [X] gamma"
    );
  });

  it("normalizes uppercase X when checking then unchecking", () => {
    const patched = patchTaskMarker(doc, { start: 24, end: 37 }, false);
    expect(patched.split("\n")[2]).toBe("- [ ] gamma");
  });

  it("preserves CRLF documents", () => {
    const crlf = "- [ ] one\r\n- [ ] two";
    expect(patchTaskMarker(crlf, { start: 12, end: 20 }, true)).toBe(
      "- [ ] one\r\n- [x] two"
    );
  });

  it("returns original when no marker found (nested edge)", () => {
    expect(patchTaskMarker("> quoted", { start: 0, end: 8 }, true)).toBe(
      "> quoted"
    );
  });

  it("multi-byte characters before the marker do not shift the patch", () => {
    // mdast offset 是 UTF-16 code unit，与 String.slice 语义一致。
    expect(patchTaskMarker("- [ ] é☕ t", { start: 0, end: 11 }, true)).toBe(
      "- [x] é☕ t"
    );
  });

  it("already-target-state marker is an identity no-op", () => {
    expect(patchTaskMarker("- [x] a", { start: 0, end: 7 }, true)).toBe(
      "- [x] a"
    );
  });
});
