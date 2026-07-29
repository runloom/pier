import {
  FILES_LSP_HOVER_CONTENT_LIMIT,
  normalizeLspHoverContents,
} from "@plugins/builtin/files/renderer/files-lsp-hover-content.ts";
import { describe, expect, it } from "vitest";

const EMPTY_HOVER_CONTENT = {
  documentation: [],
  signatures: [],
  totalCodeUnits: 0,
  truncated: false,
};

describe("normalizeLspHoverContents", () => {
  it("treats a single MarkedString string as markdown documentation", () => {
    expect(normalizeLspHoverContents("**Documented** symbol")).toEqual({
      documentation: [{ kind: "markdown", value: "**Documented** symbol" }],
      signatures: [],
      totalCodeUnits: 21,
      truncated: false,
    });
  });

  it("treats a MarkedString object as code rather than documentation", () => {
    expect(
      normalizeLspHoverContents({
        language: "typescript",
        value: "const answer: number",
      })
    ).toEqual({
      documentation: [],
      signatures: [{ language: "typescript", value: "const answer: number" }],
      totalCodeUnits: 20,
      truncated: false,
    });
  });

  it("normalizes every legal entry in a MarkedString array in server order", () => {
    expect(
      normalizeLspHoverContents([
        "First paragraph",
        { language: "typescript", value: "function first(): void" },
        "Second paragraph",
        { language: "json", value: '{ "enabled": true }' },
      ])
    ).toEqual({
      documentation: [
        { kind: "markdown", value: "First paragraph" },
        { kind: "markdown", value: "Second paragraph" },
      ],
      signatures: [
        { language: "typescript", value: "function first(): void" },
        { language: "json", value: '{ "enabled": true }' },
      ],
      totalCodeUnits:
        "First paragraph".length +
        "function first(): void".length +
        "Second paragraph".length +
        '{ "enabled": true }'.length,
      truncated: false,
    });
  });

  it.each([
    ["markdown", "# Heading\n\nDocumentation"],
    ["plaintext", "Literal <b>text</b>"],
  ] as const)("preserves MarkupContent kind %s", (kind, value) => {
    expect(normalizeLspHoverContents({ kind, value })).toEqual({
      documentation: [{ kind, value }],
      signatures: [],
      totalCodeUnits: value.length,
      truncated: false,
    });
  });

  it("filters empty legal entries without changing non-empty content", () => {
    expect(
      normalizeLspHoverContents([
        "",
        " \t\n ",
        { language: "typescript", value: "" },
        { language: "typescript", value: "  \n" },
        "  kept with surrounding space  ",
      ])
    ).toEqual({
      documentation: [
        { kind: "markdown", value: "  kept with surrounding space  " },
      ],
      signatures: [],
      totalCodeUnits: "  kept with surrounding space  ".length,
      truncated: false,
    });

    expect(
      normalizeLspHoverContents({ kind: "markdown", value: " \n\t" })
    ).toEqual(EMPTY_HOVER_CONTENT);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["boolean", true],
    ["nested array", [["documentation"]]],
    ["unknown object", { value: "missing discriminator" }],
    ["invalid markup kind", { kind: "html", value: "unsafe" }],
    ["non-string markup value", { kind: "markdown", value: 7 }],
    ["missing MarkedString language", { value: "const missing = true" }],
    ["non-string MarkedString language", { language: 7, value: "code" }],
    ["non-string MarkedString value", { language: "typescript", value: 7 }],
  ])("ignores malformed top-level %s content", (_name, contents) => {
    expect(normalizeLspHoverContents(contents)).toEqual(EMPTY_HOVER_CONTENT);
  });

  it("filters malformed MarkedString array entries while retaining legal entries", () => {
    expect(
      normalizeLspHoverContents([
        null,
        1,
        false,
        ["nested"],
        { kind: "markdown", value: "not legal inside MarkedString[]" },
        { language: "typescript" },
        { language: "typescript", value: 9 },
        "Documentation",
        { language: "typescript", value: "const valid = true" },
      ])
    ).toEqual({
      documentation: [{ kind: "markdown", value: "Documentation" }],
      signatures: [{ language: "typescript", value: "const valid = true" }],
      totalCodeUnits: "Documentation".length + "const valid = true".length,
      truncated: false,
    });
  });

  it("applies one content budget across categories in original encounter order", () => {
    const documentation = "d".repeat(FILES_LSP_HOVER_CONTENT_LIMIT - 3);

    expect(
      normalizeLspHoverContents([
        documentation,
        { language: "typescript", value: "code" },
        "later documentation",
        { language: "rust", value: "later code" },
      ])
    ).toEqual({
      documentation: [{ kind: "markdown", value: documentation }],
      signatures: [{ language: "typescript", value: "cod" }],
      totalCodeUnits:
        documentation.length +
        "code".length +
        "later documentation".length +
        "later code".length,
      truncated: true,
    });
  });

  it("measures the 128 Ki limit in UTF-16 code units", () => {
    const emojiCount = FILES_LSP_HOVER_CONTENT_LIMIT / 2 + 1;
    const value = "😀".repeat(emojiCount);
    const normalized = normalizeLspHoverContents(value);

    expect(FILES_LSP_HOVER_CONTENT_LIMIT).toBe(128 * 1024);
    expect(value.length).toBe(FILES_LSP_HOVER_CONTENT_LIMIT + 2);
    expect(normalized).toEqual({
      documentation: [{ kind: "markdown", value: "😀".repeat(emojiCount - 1) }],
      signatures: [],
      totalCodeUnits: FILES_LSP_HOVER_CONTENT_LIMIT + 2,
      truncated: true,
    });
  });

  it("does not report truncation at the exact content limit", () => {
    const value = "x".repeat(FILES_LSP_HOVER_CONTENT_LIMIT);

    expect(normalizeLspHoverContents(value)).toEqual({
      documentation: [{ kind: "markdown", value }],
      signatures: [],
      totalCodeUnits: FILES_LSP_HOVER_CONTENT_LIMIT,
      truncated: false,
    });
  });
});
