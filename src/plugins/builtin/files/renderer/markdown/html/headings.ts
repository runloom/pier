import type { MarkdownHeadingSummary, MarkdownSourceRange } from "../ir.ts";

interface HtmlHeadingSlugger {
  slug(value: string): string;
}

const HTML_OPEN_HEADING_RE = /<h([1-6])\b/iu;
const MAX_UNICODE_CODE_POINT = 0x10_ff_ff;

export function stripIgnoredHtmlForHeadings(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(
      /<(script|style|template|iframe|svg|object|embed|textarea|math)\b[\s\S]*?(?:<\/\1>|$)/giu,
      ""
    );
}

export function htmlInnerText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/gu, ""), " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function htmlVisibleSearchText(html: string): string {
  return decodeHtmlEntities(
    stripIgnoredHtmlForHeadings(html).replace(/<[^>]+>/gu, ""),
    "\u00a0"
  );
}

export function collectHtmlBlockHeadings(
  value: string,
  range: MarkdownSourceRange,
  slugger: HtmlHeadingSlugger,
  headings: MarkdownHeadingSummary[]
): void {
  const source = stripIgnoredHtmlForHeadings(value);
  let index = 0;
  while (index < source.length) {
    const remaining = source.slice(index);
    const open = HTML_OPEN_HEADING_RE.exec(remaining);
    if (!open?.[1] || open.index === undefined) break;
    const abs = index + open.index;
    const depth = Number(open[1]) as 1 | 2 | 3 | 4 | 5 | 6;
    const tagEnd = findHtmlTagEnd(source, abs);
    if (tagEnd < 0) break;
    const close = findHeadingClose(source, tagEnd + 1, depth);
    if (!close) {
      index = tagEnd + 1;
      continue;
    }
    const text = htmlInnerText(source.slice(tagEnd + 1, close.start));
    if (text) {
      const startOffset = range.startOffset + abs;
      headings.push({
        depth,
        id: slugger.slug(text),
        range: {
          endLine: range.endLine,
          endOffset: startOffset + (close.end - abs),
          startLine: range.startLine,
          startOffset,
        },
        text,
      });
    }
    index = close.end;
  }
}

export function headingIdsInRange(
  headings: readonly MarkdownHeadingSummary[],
  range: MarkdownSourceRange
): string[] {
  return headings
    .filter(
      (heading) =>
        heading.range.startOffset >= range.startOffset &&
        heading.range.endOffset <= range.endOffset
    )
    .map((heading) => heading.id);
}

function findHtmlTagEnd(source: string, tagStart: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = tagStart; index < source.length; index += 1) {
    const char = source[index];
    if (!char) continue;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function findHeadingClose(
  source: string,
  from: number,
  depth: number
): { end: number; start: number } | null {
  const closeRe = new RegExp(`</h${depth}\\s*>`, "iu");
  const match = closeRe.exec(source.slice(from));
  if (!match || match.index === undefined) return null;
  return {
    end: from + match.index + match[0].length,
    start: from + match.index,
  };
}

function decodeNumericCodePoint(code: number): string {
  if (
    !Number.isInteger(code) ||
    code <= 0 ||
    code > MAX_UNICODE_CODE_POINT ||
    (code >= 0xd8_00 && code <= 0xdf_ff)
  ) {
    return "";
  }
  return String.fromCodePoint(code);
}

function decodeHtmlEntities(value: string, nbsp: string): string {
  return value
    .replace(/&nbsp;/giu, nbsp)
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) =>
      decodeNumericCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      decodeNumericCodePoint(Number.parseInt(code, 16))
    );
}
