import type { MarkdownSourceRange, MarkdownTableCell } from "./ir.ts";
import { type MarkdownSearchMatch, markdownSearchNodeKey } from "./search.ts";

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
    "data-source-end-line": range.endLine,
    "data-source-offset": range.startOffset,
    "data-source-end-offset": range.endOffset,
    onDoubleClick: context.onJumpToSource
      ? (event: {
          altKey: boolean;
          stopPropagation: () => void;
          target: EventTarget | null;
        }) => {
          // 裸双击归还给原生选词（Zed #60817 同款取舍）；⌥+双击才跳源码，
          // 常规路径走右键菜单「跳转到源码」与工具栏切换。
          if (!event.altKey) return;
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest("a, button, input, textarea, [data-no-source-jump]")
          ) {
            return;
          }
          event.stopPropagation();
          // 双击在 mousedown 阶段已产生选词，跳转前清掉，避免闪一下残留。
          window.getSelection?.()?.removeAllRanges();
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
