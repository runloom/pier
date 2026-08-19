import type { MarkdownSourceRange } from "../ir.ts";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "../resource-elements.tsx";
import type { MarkdownSearchMatch } from "../search.ts";
import type { MarkdownHtmlRenderEnv } from "./types.ts";

export function markdownHtmlRenderEnv(input: {
  activeSearchMatchId: string | undefined;
  fileResources: MarkdownFileResources | undefined;
  labels: MarkdownHtmlRenderEnv["labels"];
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenAnchor(anchor: string): void;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  range: MarkdownSourceRange;
  searchMatches: readonly MarkdownSearchMatch[] | undefined;
  searchMatchesForHtml?: MarkdownHtmlRenderEnv["searchMatchesForHtml"];
  source: MarkdownDiskSource | undefined;
}): Omit<MarkdownHtmlRenderEnv, "headingIds"> {
  return {
    activeSearchMatchId: input.activeSearchMatchId,
    fileResources: input.fileResources,
    labels: input.labels,
    onJumpToSource: input.onJumpToSource,
    onOpenAnchor: input.onOpenAnchor,
    onOpenExternal: input.onOpenExternal,
    onOpenInternal: input.onOpenInternal,
    range: input.range,
    searchMatches: input.searchMatches,
    searchMatchesForHtml: input.searchMatchesForHtml,
    source: input.source,
  };
}
