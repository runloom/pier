import type { MarkdownSourceRange } from "../ir.ts";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "../resource-elements.tsx";
import type { MarkdownSearchMatch } from "../search.ts";

export interface MarkdownHtmlRenderEnv {
  activeSearchMatchId: string | undefined;
  fileResources: MarkdownFileResources | undefined;
  headingIds: string[];
  labels: {
    imagePreviewFailed: string;
    imagePreviewTitle: string;
    openFullscreen: string;
  };
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenAnchor(anchor: string): void;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  range: MarkdownSourceRange;
  searchMatches: readonly MarkdownSearchMatch[] | undefined;
  searchMatchesForHtml?: (
    range: MarkdownSourceRange
  ) => readonly MarkdownSearchMatch[] | undefined;
  source: MarkdownDiskSource | undefined;
}
