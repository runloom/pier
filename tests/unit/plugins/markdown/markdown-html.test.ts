import { collectHtmlBlockHeadings } from "@plugins/builtin/files/renderer/markdown/html/headings.ts";
import { parseMarkdownHtmlInlineToken } from "@plugins/builtin/files/renderer/markdown/html/inline-token.ts";
import {
  isSafeMarkdownHtmlHref,
  isSafeMarkdownHtmlSrc,
  sanitizeMarkdownHtml,
} from "@plugins/builtin/files/renderer/markdown/html/sanitizer.ts";
import {
  htmlAlignClass,
  isSafeHtmlAlign,
} from "@plugins/builtin/files/renderer/markdown/html/schema.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import {
  classifyMarkdownUrl,
  safeMarkdownUrl,
} from "@plugins/builtin/files/renderer/markdown/resource-elements.tsx";
import { paginateMarkdownDocument } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { findMarkdownSearchMatches } from "@plugins/builtin/files/renderer/markdown/search.ts";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";

function fragmentHtml(html: string): string {
  const fragment = sanitizeMarkdownHtml(html);
  const container = fragment.ownerDocument.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

describe("markdown HTML sanitizer", () => {
  it("keeps README centering tags and relative links", () => {
    const root = document.createElement("div");
    root.innerHTML = fragmentHtml(`
      <h1 align="center" style="color:red" onclick="alert(1)">Pier</h1>
      <p align="center"><a href="docs/README.md">文档</a></p>
    `);

    const heading = root.querySelector("h1");
    expect(heading?.textContent).toBe("Pier");
    expect(heading?.getAttribute("align")).toBe("center");
    expect(heading?.hasAttribute("style")).toBe(false);
    expect(heading?.hasAttribute("onclick")).toBe(false);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "docs/README.md"
    );
  });

  it("drops align=justify so HTML cannot override the reading column", () => {
    const root = document.createElement("div");
    root.innerHTML = fragmentHtml('<p align="justify">wide</p>');
    const paragraph = root.querySelector("p");
    expect(paragraph?.textContent).toBe("wide");
    expect(paragraph?.hasAttribute("align")).toBe(false);
  });

  it("strips script and iframe content", () => {
    const html = fragmentHtml(
      "<script>alert('never')</script><p>visible</p><iframe src='https://example.com'></iframe>"
    );
    expect(html).toContain("visible");
    expect(html).not.toContain("never");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("script");
  });

  it("drops javascript and data hrefs", () => {
    const root = document.createElement("div");
    root.innerHTML = fragmentHtml(
      '<a href="javascript:alert(1)">bad</a><a href="https://example.com/ok">ok</a>'
    );
    const links = [...root.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    expect(links[0]?.hasAttribute("href")).toBe(false);
    expect(links[1]?.getAttribute("href")).toBe("https://example.com/ok");
  });

  it("drops whitespace-obfuscated javascript and protocol-relative hrefs", () => {
    const root = document.createElement("div");
    root.innerHTML = fragmentHtml(
      '<a href="java\tscript:alert(1)">tab</a><a href="//evil.example/phish">proto</a>'
    );
    for (const link of root.querySelectorAll("a")) {
      expect(link.hasAttribute("href")).toBe(false);
    }
  });

  it("strips remote image src so CSP cannot load it", () => {
    const root = document.createElement("div");
    root.innerHTML = fragmentHtml(
      '<img src="https://example.com/tracker.png" alt="Logo"><img src="images/local.png" alt="Local">'
    );
    const images = [...root.querySelectorAll("img")];
    expect(images[0]?.hasAttribute("src")).toBe(false);
    expect(images[1]?.getAttribute("src")).toBe("images/local.png");
  });
});

describe("markdown HTML inline tokens", () => {
  it("parses open, close, void, and raw tags", () => {
    expect(parseMarkdownHtmlInlineToken("<span>")).toEqual({
      attrs: {},
      name: "span",
      selfClosing: false,
      type: "open",
    });
    expect(parseMarkdownHtmlInlineToken("</span>")).toEqual({
      name: "span",
      type: "close",
    });
    expect(parseMarkdownHtmlInlineToken("<br />")).toMatchObject({
      name: "br",
      selfClosing: true,
      type: "open",
    });
    expect(
      parseMarkdownHtmlInlineToken('<a href="https://example.com">')
    ).toEqual({
      attrs: { href: "https://example.com" },
      name: "a",
      selfClosing: false,
      type: "open",
    });
    expect(
      parseMarkdownHtmlInlineToken('<h1 align="center">Pier</h1>')
    ).toEqual({
      type: "raw",
      value: '<h1 align="center">Pier</h1>',
    });
  });
});

describe("markdown HTML heading extraction", () => {
  it("slugs nested heading text from a block", () => {
    const headings: Parameters<typeof collectHtmlBlockHeadings>[3] = [];
    collectHtmlBlockHeadings(
      '<h1 align="center">Pier</h1><h2>Install <strong>now</strong></h2>',
      {
        endLine: 2,
        endOffset: 80,
        startLine: 1,
        startOffset: 10,
      },
      new GithubSlugger(),
      headings
    );
    expect(
      headings.map(({ id, text, depth }) => ({ depth, id, text }))
    ).toEqual([
      { depth: 1, id: "pier", text: "Pier" },
      { depth: 2, id: "install-now", text: "Install now" },
    ]);
  });

  it("ignores headings inside comments and quoted greater-than attrs", () => {
    const headings: Parameters<typeof collectHtmlBlockHeadings>[3] = [];
    collectHtmlBlockHeadings(
      '<!-- <h1>Deleted</h1> --><h1 title="a>b">Visible</h1>',
      {
        endLine: 1,
        endOffset: 80,
        startLine: 1,
        startOffset: 0,
      },
      new GithubSlugger(),
      headings
    );
    expect(headings.map(({ text }) => text)).toEqual(["Visible"]);
  });

  it("does not throw on out-of-range numeric entities", () => {
    const headings: Parameters<typeof collectHtmlBlockHeadings>[3] = [];
    expect(() =>
      collectHtmlBlockHeadings(
        "<h1>&#x110000;Keep</h1>",
        {
          endLine: 1,
          endOffset: 40,
          startLine: 1,
          startOffset: 0,
        },
        new GithubSlugger(),
        headings
      )
    ).not.toThrow();
    expect(headings.map(({ text }) => text)).toEqual(["Keep"]);
  });
});

describe("markdown URL classification", () => {
  it("rejects whitespace-obfuscated schemes and protocol-relative URLs", () => {
    expect(classifyMarkdownUrl("java\tscript:alert(1)")).toEqual({
      href: "",
      kind: "unsafe",
    });
    expect(safeMarkdownUrl("java\u00a0script:alert(1)")).toBe("");
    expect(safeMarkdownUrl("java\tscript:alert(1)")).toBe("");
    expect(classifyMarkdownUrl("//evil.example/phish")).toEqual({
      href: "",
      kind: "unsafe",
    });
    expect(isSafeMarkdownHtmlHref("java\tscript:alert(1)")).toBe(false);
    expect(isSafeMarkdownHtmlHref("//evil.example/phish")).toBe(false);
    expect(isSafeMarkdownHtmlHref("https://example.com/ok")).toBe(true);
    expect(isSafeMarkdownHtmlSrc("https://example.com/x.png")).toBe(false);
    expect(isSafeMarkdownHtmlSrc("images/local.png")).toBe(true);
  });
});

describe("markdown HTML search text", () => {
  it("indexes visible HTML text and skips tags and dropped script", () => {
    const document = parseMarkdownToIr(
      [
        "<h1>Pier</h1>",
        "<script>alert('never')</script>",
        "",
        "Before <span>world</span> after",
      ].join("\n")
    );
    const pagination = paginateMarkdownDocument(document);
    expect(findMarkdownSearchMatches(pagination, "Pier")).toHaveLength(1);
    expect(findMarkdownSearchMatches(pagination, "world")).toHaveLength(1);
    expect(findMarkdownSearchMatches(pagination, "alert")).toHaveLength(0);
    expect(findMarkdownSearchMatches(pagination, "<h1")).toHaveLength(0);
  });
});

describe("htmlAlignClass", () => {
  it("maps left/center/right and rejects justify", () => {
    expect(htmlAlignClass("center")).toBe("text-center");
    expect(htmlAlignClass("right")).toBe("text-right");
    expect(htmlAlignClass("left")).toBe("text-left");
    expect(htmlAlignClass("justify")).toBeUndefined();
    expect(isSafeHtmlAlign("justify")).toBe(false);
    expect(isSafeHtmlAlign("center")).toBe(true);
  });
});
