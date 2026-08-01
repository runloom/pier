import { describe, expect, it } from "vitest";
import { highlightFilesLspCodeToHtml } from "../../../../../src/plugins/builtin/files/renderer/lsp/code-highlight.ts";

describe("highlightFilesLspCodeToHtml", () => {
  it("emits tok-* spans for TypeScript signatures", () => {
    const html = highlightFilesLspCodeToHtml(
      "export class EditorView {}",
      "typescript"
    );
    expect(html).toContain("tok-keyword");
    expect(html).toContain("tok-className");
    expect(html).toContain("export");
    expect(html).toContain("EditorView");
    expect(html).toMatch(/class="tok-/);
  });

  it("escapes plain text when the language is unknown", () => {
    const html = highlightFilesLspCodeToHtml(
      'const x = "<script>";',
      "not-a-language"
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
