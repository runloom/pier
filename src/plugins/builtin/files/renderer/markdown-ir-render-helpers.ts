import type {
  MarkdownSourceRange,
  MarkdownTableCell,
} from "./markdown/markdown-ir.ts";
import {
  type MarkdownSearchMatch,
  markdownSearchNodeKey,
} from "./markdown-search.ts";

export function sourceBlockProps(
  range: MarkdownSourceRange,
  context: {
    onJumpToSource?: ((offset: number) => void) | undefined;
  },
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...extra,
    "data-source-line": range.startLine,
    "data-source-offset": range.startOffset,
    onDoubleClick: context.onJumpToSource
      ? (event: {
          stopPropagation: () => void;
          target: EventTarget | null;
        }) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest("a, button, input, textarea, [data-no-source-jump]")
          ) {
            return;
          }
          event.stopPropagation();
          context.onJumpToSource?.(range.startOffset);
        }
      : undefined,
  };
}

export function headingClassName(depth: number): string {
  if (depth === 1) return "md-h1";
  if (depth === 2) return "md-h2";
  if (depth === 3) return "md-h3";
  if (depth === 4) return "md-h4";
  if (depth === 5) return "md-h5";
  return "md-h6";
}

export function tableAlignment(
  alignment: "center" | "left" | "right" | null | undefined
) {
  if (alignment === "center") return "text-center";
  if (alignment === "right") return "text-right";
  return "text-left";
}

export function cellKey(cell: MarkdownTableCell): string {
  return `${cell.range.startOffset}-${cell.range.endOffset}`;
}

export function groupSearchMatches(
  matches: readonly MarkdownSearchMatch[]
): ReadonlyMap<string, readonly MarkdownSearchMatch[]> {
  const grouped = new Map<string, MarkdownSearchMatch[]>();
  for (const match of matches) {
    const group = grouped.get(match.nodeKey);
    if (group) group.push(match);
    else grouped.set(match.nodeKey, [match]);
  }
  return grouped;
}

export function searchMatchesFor(
  context: {
    searchMatchesByNode: ReadonlyMap<string, readonly MarkdownSearchMatch[]>;
  },
  kind: string,
  range: MarkdownSourceRange
): readonly MarkdownSearchMatch[] | undefined {
  return context.searchMatchesByNode.get(markdownSearchNodeKey(kind, range));
}

export function isCalloutDirective(name: string): boolean {
  return [
    "caution",
    "danger",
    "important",
    "info",
    "note",
    "tip",
    "warning",
  ].includes(name);
}
