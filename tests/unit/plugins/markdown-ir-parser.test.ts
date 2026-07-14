import {
  MARKDOWN_IR_VERSION,
  MARKDOWN_MAX_SOURCE_BYTES,
  parseMarkdownRequest,
  parseMarkdownToIr,
} from "@plugins/builtin/files/renderer/markdown/markdown-parser.ts";
import { describe, expect, it } from "vitest";

describe("Markdown IR parser", () => {
  it("builds stable heading anchors, inline nodes, and source ranges", () => {
    const source = [
      "# Hello, World!",
      "",
      "Text with **bold**, *emphasis*, ~~gone~~, `code`, [Docs](https://example.com), and ![Alt](./image.png).",
      "",
      "## Hello World",
      "## Hello World",
    ].join("\n");
    const document = parseMarkdownToIr(source);

    expect(document.version).toBe(MARKDOWN_IR_VERSION);
    expect(
      document.headings.map(({ depth, id, text }) => ({ depth, id, text }))
    ).toEqual([
      { depth: 1, id: "hello-world", text: "Hello, World!" },
      { depth: 2, id: "hello-world-1", text: "Hello World" },
      { depth: 2, id: "hello-world-2", text: "Hello World" },
    ]);
    expect(document.blocks[0]).toMatchObject({
      depth: 1,
      id: "hello-world",
      kind: "heading",
      range: { endLine: 1, startLine: 1, startOffset: 0 },
    });
    expect(document.blocks[1]).toMatchObject({
      kind: "paragraph",
      children: expect.arrayContaining([
        expect.objectContaining({ kind: "strong" }),
        expect.objectContaining({ kind: "emphasis" }),
        expect.objectContaining({ kind: "delete" }),
        expect.objectContaining({ kind: "inlineCode", value: "code" }),
        expect.objectContaining({ kind: "link", url: "https://example.com" }),
        expect.objectContaining({
          alt: "Alt",
          kind: "image",
          url: "./image.png",
        }),
      ]),
    });
    expect(document.plainText).toContain("Hello, World!");
    expect(document.plainText).toContain("Text with bold");
  });

  it("represents GFM task lists, tables, blockquotes, and definitions", () => {
    const document = parseMarkdownToIr(
      [
        "- [x] shipped",
        "- [ ] pending",
        "",
        "| Name | Value |",
        "| :--- | ----: |",
        "| A | 1 |",
        "",
        "> See [guide][docs].",
        "",
        '[docs]: https://example.com/guide "Guide"',
      ].join("\n")
    );

    expect(document.blocks[0]).toMatchObject({
      kind: "list",
      ordered: false,
      items: [
        expect.objectContaining({ checked: true }),
        expect.objectContaining({ checked: false }),
      ],
    });
    expect(document.blocks[1]).toMatchObject({
      align: ["left", "right"],
      kind: "table",
      rows: expect.arrayContaining([
        expect.objectContaining({
          cells: expect.arrayContaining([
            expect.objectContaining({
              children: expect.any(Array),
              range: expect.objectContaining({
                startOffset: expect.any(Number),
              }),
            }),
          ]),
          range: expect.objectContaining({ startOffset: expect.any(Number) }),
        }),
      ]),
    });
    expect(document.blocks[2]).toMatchObject({ kind: "blockquote" });
    expect(JSON.stringify(document.blocks[2])).toContain(
      "https://example.com/guide"
    );
  });

  it("keeps code, math, directives, and raw HTML as explicit non-executable IR", () => {
    const document = parseMarkdownToIr(
      [
        "Inline $x^2$.",
        "",
        "$$latex",
        "y = x + 1",
        "$$",
        "",
        "```ts title=demo",
        "const x = 1",
        "```",
        "",
        ":::note{title=Heads-up}",
        "Directive body.",
        ":::",
        "",
        "::youtube[Video of a cat]{id=abc}",
        "",
        "<script>alert('never')</script>",
      ].join("\n")
    );

    expect(JSON.stringify(document.blocks)).toContain('"kind":"inlineMath"');
    expect(document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "math",
          meta: "latex",
          value: "y = x + 1",
        }),
        expect.objectContaining({
          kind: "code",
          lang: "ts",
          meta: "title=demo",
        }),
        expect.objectContaining({ kind: "containerDirective", name: "note" }),
        expect.objectContaining({
          attributes: { id: "abc" },
          children: [
            expect.objectContaining({ kind: "text", value: "Video of a cat" }),
          ],
          kind: "leafDirective",
          name: "youtube",
        }),
        expect.objectContaining({
          kind: "html",
          value: "<script>alert('never')</script>",
        }),
      ])
    );
  });

  it("resolves nested definitions in document order with first-definition precedence", () => {
    const document = parseMarkdownToIr(
      [
        "> [nested]: /nested",
        "",
        "[Nested][nested]",
        "",
        '[dup]: /first "First"',
        '[dup]: /second "Second"',
        "[Duplicate][dup]",
      ].join("\n")
    );

    const serialized = JSON.stringify(document.blocks);
    expect(serialized).toContain('"url":"/nested"');
    expect(serialized).toContain('"url":"/first"');
    expect(serialized).not.toContain('"url":"/second"');
  });

  it("returns a versioned worker response and enforces the UTF-8 byte limit", () => {
    const parsed = parseMarkdownRequest({
      requestId: "request-1",
      revision: "revision-1",
      sessionId: "session-1",
      source: "# Ready",
      type: "parse",
    });
    expect(parsed).toMatchObject({
      document: { version: MARKDOWN_IR_VERSION },
      requestId: "request-1",
      revision: "revision-1",
      sessionId: "session-1",
      type: "parsed",
    });

    expect(
      parseMarkdownRequest({
        requestId: "request-2",
        revision: "revision-2",
        sessionId: "session-1",
        source: "界".repeat(Math.floor(MARKDOWN_MAX_SOURCE_BYTES / 3) + 1),
        type: "parse",
      })
    ).toEqual({
      code: "too-large",
      requestId: "request-2",
      revision: "revision-2",
      sessionId: "session-1",
      type: "error",
    });
  });
});
