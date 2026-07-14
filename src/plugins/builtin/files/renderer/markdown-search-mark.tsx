import type { ReactNode } from "react";
import type { MarkdownSearchMatch } from "./markdown-search.ts";

export function MarkdownSearchText({
  activeMatchId,
  baseOffset = 0,
  matches,
  value,
}: {
  activeMatchId: string | undefined;
  baseOffset?: number;
  matches: readonly MarkdownSearchMatch[] | undefined;
  value: string;
}): ReactNode {
  if (!matches?.length) return value;
  const endOffset = baseOffset + value.length;
  const relevant = matches.filter(
    (match) => match.start < endOffset && match.end > baseOffset
  );
  if (relevant.length === 0) return value;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of relevant) {
    const start = Math.max(0, match.start - baseOffset);
    const end = Math.min(value.length, match.end - baseOffset);
    if (start > cursor) output.push(value.slice(cursor, start));
    if (end > cursor) {
      const identifiesMatch = match.start >= baseOffset;
      const active = match.id === activeMatchId;
      output.push(
        <mark
          className={
            active
              ? "rounded-sm bg-action-accent text-action-accent-foreground"
              : "rounded-sm bg-warning/30 text-inherit"
          }
          data-active-search-match={
            active && identifiesMatch ? "true" : undefined
          }
          data-search-match-id={identifiesMatch ? match.id : undefined}
          key={`${match.id}:${baseOffset}`}
        >
          {value.slice(Math.max(cursor, start), end)}
        </mark>
      );
      cursor = end;
    }
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}
