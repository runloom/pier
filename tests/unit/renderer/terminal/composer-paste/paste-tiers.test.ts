import { describe, expect, it } from "vitest";
import {
  classifyPlainPaste,
  countPasteLines,
  PASTE_LARGE_MIN_CHARS,
  PASTE_SMALL_MAX_CHARS,
  PASTE_SMALL_MAX_LINES,
} from "@/panel-kits/terminal/structured-composer/paste-tiers.ts";

describe("countPasteLines", () => {
  it("counts empty as 0", () => {
    expect(countPasteLines("")).toBe(0);
  });

  it("counts single line without trailing newline", () => {
    expect(countPasteLines("hello")).toBe(1);
  });

  it("does not count trailing single newline as an extra line", () => {
    expect(countPasteLines("a\nb\n")).toBe(2);
  });

  it("counts interior blank lines", () => {
    expect(countPasteLines("a\n\nb")).toBe(3);
  });
});

describe("classifyPlainPaste", () => {
  it("classifies short single-line as small", () => {
    expect(classifyPlainPaste("hi")).toBe("small");
    expect(classifyPlainPaste("x".repeat(PASTE_SMALL_MAX_CHARS - 1))).toBe(
      "small"
    );
  });

  it("classifies at small char boundary as medium", () => {
    expect(classifyPlainPaste("x".repeat(PASTE_SMALL_MAX_CHARS))).toBe(
      "medium"
    );
  });

  it("classifies over small line limit as medium even if short", () => {
    const lines = Array.from(
      { length: PASTE_SMALL_MAX_LINES + 1 },
      (_, i) => `L${i}`
    ).join("\n");
    expect(lines.length).toBeLessThan(PASTE_SMALL_MAX_CHARS);
    expect(classifyPlainPaste(lines)).toBe("medium");
  });

  it("classifies at large threshold as large", () => {
    expect(classifyPlainPaste("x".repeat(PASTE_LARGE_MIN_CHARS))).toBe("large");
    expect(classifyPlainPaste("x".repeat(PASTE_LARGE_MIN_CHARS - 1))).toBe(
      "medium"
    );
  });

  it("keeps large tier min at 10_000", () => {
    expect(PASTE_LARGE_MIN_CHARS).toBe(10_000);
  });
});
