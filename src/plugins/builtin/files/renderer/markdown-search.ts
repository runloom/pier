import type {
  MarkdownBlock,
  MarkdownInline,
  MarkdownSourceRange,
} from "./markdown/markdown-ir.ts";
import type { MarkdownPagination } from "./markdown/markdown-runtime.ts";

export interface MarkdownSearchMatch {
  end: number;
  id: string;
  nodeKey: string;
  pageIndex: number;
  start: number;
}

const MAX_SEARCH_MATCHES = 10_000;

export function markdownSearchNodeKey(
  kind: string,
  range: MarkdownSourceRange
): string {
  return `${kind}:${range.startOffset}:${range.endOffset}`;
}

export function findMarkdownSearchMatches(
  pagination: MarkdownPagination,
  query: string
): MarkdownSearchMatch[] {
  if (!query) return [];
  const matcher = new RegExp(escapeRegExp(query), "giu");
  const matches: MarkdownSearchMatch[] = [];
  for (const page of pagination.pages) {
    for (const segment of collectBlockSegments(page.blocks)) {
      matcher.lastIndex = 0;
      for (
        let match = matcher.exec(segment.value);
        match;
        match = matcher.exec(segment.value)
      ) {
        const start = match.index;
        const end = start + match[0].length;
        matches.push({
          end,
          id: `${segment.nodeKey}:${start}:${end}`,
          nodeKey: segment.nodeKey,
          pageIndex: page.index,
          start,
        });
        if (matches.length >= MAX_SEARCH_MATCHES) return matches;
      }
    }
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface SearchSegment {
  nodeKey: string;
  value: string;
}

function collectBlockSegments(
  blocks: readonly MarkdownBlock[]
): SearchSegment[] {
  const segments: SearchSegment[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "leafDirective":
        collectInlineSegments(block.children, segments);
        break;
      case "code":
        if (block.lang?.toLowerCase() !== "mermaid") {
          segments.push({
            nodeKey: markdownSearchNodeKey(block.kind, block.range),
            value: block.value,
          });
        }
        break;
      case "html":
      case "unsupported":
        segments.push({
          nodeKey: markdownSearchNodeKey(block.kind, block.range),
          value: block.value,
        });
        break;
      case "math":
        break;
      case "blockquote":
      case "containerDirective":
      case "footnoteDefinition":
        segments.push(...collectBlockSegments(block.blocks));
        break;
      case "list":
        for (const item of block.items) {
          segments.push(...collectBlockSegments(item.blocks));
        }
        break;
      case "table":
        for (const row of block.rows) {
          for (const cell of row.cells) {
            collectInlineSegments(cell.children, segments);
          }
        }
        break;
      case "thematicBreak":
        break;
      default:
        break;
    }
  }
  return segments;
}

function collectInlineSegments(
  inlines: readonly MarkdownInline[],
  segments: SearchSegment[]
) {
  for (const inline of inlines) {
    switch (inline.kind) {
      case "text":
      case "inlineCode":
      case "html":
        segments.push({
          nodeKey: markdownSearchNodeKey(inline.kind, inline.range),
          value: inline.value,
        });
        break;
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "textDirective":
        collectInlineSegments(inline.children, segments);
        break;
      case "inlineMath":
      case "image":
      case "break":
      case "footnoteReference":
        break;
      default:
        break;
    }
  }
}
