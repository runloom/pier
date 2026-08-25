import {
  COMPOSER_TEXT_PREVIEW_MAX_CHARS,
  COMPOSER_TEXT_PREVIEW_MAX_LINES,
  clipComposerTextPreview,
  looksLikeComposerBinaryPreviewBytes,
  shouldAttemptComposerTextPreview,
} from "@shared/composer-attachment-kind.ts";
import { describe, expect, it } from "vitest";

describe("clipComposerTextPreview", () => {
  it("skips leading blank lines and keeps indentation", () => {
    expect(clipComposerTextPreview("\n\n  const x = 1;\n  return x;\n")).toBe(
      "  const x = 1;\n  return x;"
    );
  });

  it("caps at the max line count", () => {
    const lines = Array.from(
      { length: COMPOSER_TEXT_PREVIEW_MAX_LINES + 3 },
      (_, index) => `line-${index + 1}`
    );
    expect(clipComposerTextPreview(lines.join("\n"))).toBe(
      lines.slice(0, COMPOSER_TEXT_PREVIEW_MAX_LINES).join("\n")
    );
  });

  it("caps at the max character count on a single line", () => {
    const text = "a".repeat(COMPOSER_TEXT_PREVIEW_MAX_CHARS + 40);
    const clipped = clipComposerTextPreview(text);
    expect(clipped.length).toBe(COMPOSER_TEXT_PREVIEW_MAX_CHARS);
    expect(clipped.startsWith("aaa")).toBe(true);
  });

  it("returns empty for whitespace-only input", () => {
    expect(clipComposerTextPreview("  \n\n\t")).toBe("");
  });

  it("treats CRLF as a single line break", () => {
    expect(clipComposerTextPreview("first\r\nsecond\r\nthird")).toBe(
      "first\nsecond"
    );
  });

  it("does not scan past the first content lines of a long paste", () => {
    const prefix = "\n".repeat(20_000);
    const rest = "z".repeat(8000);
    expect(clipComposerTextPreview(`${prefix}hello\nworld\n${rest}`)).toBe(
      "hello\nworld"
    );
  });
});

describe("shouldAttemptComposerTextPreview", () => {
  it("skips directories, images, and known binaries", () => {
    expect(
      shouldAttemptComposerTextPreview({ isDirectory: true, name: "src" })
    ).toBe(false);
    expect(shouldAttemptComposerTextPreview({ name: "shot.png" })).toBe(false);
    expect(shouldAttemptComposerTextPreview({ name: "notes.pdf" })).toBe(false);
    expect(shouldAttemptComposerTextPreview({ name: "app.dylib" })).toBe(false);
  });

  it("attempts readable source, config, and extensionless names", () => {
    expect(shouldAttemptComposerTextPreview({ name: "main.ts" })).toBe(true);
    expect(shouldAttemptComposerTextPreview({ name: "notes.txt" })).toBe(true);
    expect(shouldAttemptComposerTextPreview({ name: "Makefile" })).toBe(true);
  });
});

describe("looksLikeComposerBinaryPreviewBytes", () => {
  it("treats NUL as binary and printable UTF-8 as text", () => {
    expect(looksLikeComposerBinaryPreviewBytes(Uint8Array.from([0, 65]))).toBe(
      true
    );
    expect(
      looksLikeComposerBinaryPreviewBytes(new TextEncoder().encode("hello"))
    ).toBe(false);
  });
});
