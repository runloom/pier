/**
 * Markdown IR inline renderer (text, links, images, kbd, footnotes).
 */
import { Kbd } from "@pier/ui/kbd.tsx";
import type {
  RendererPluginCodeThemeRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { ReactNode } from "react";
import type { MarkdownCodeBlockLabels } from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
import { markdownHtmlRenderEnv } from "./html/env.ts";
import { renderMarkdownHtmlInlines } from "./html/inlines.tsx";
import type { MarkdownHeadingSummary, MarkdownInline } from "./ir.ts";
import { searchMatchesFor } from "./ir-render-helpers.ts";
import { MarkdownMath } from "./math.tsx";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "./resource-elements.tsx";
import {
  MarkdownResourceImage,
  MarkdownResourceLink,
} from "./resource-elements.tsx";
import type { MarkdownSearchMatch } from "./search.ts";
import { MarkdownSearchText } from "./search-mark.tsx";

export interface MarkdownRendererLabels extends MarkdownCodeBlockLabels {
  completedTask: string;
  diagramFailed: string;
  diagramLabel: string;
  diagramPreviewTitle: string;
  /** Shown on the diagram shrink chip; omit for icon-only chip. */
  diagramScaledHint?: string;
  imagePreviewFailed: string;
  imagePreviewTitle: string;
  incompleteTask: string;
  openFullscreen: string;
}

export interface MarkdownRenderContext {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  charts: RendererPluginContext["charts"] | undefined;
  codeHighlighter: MarkdownCodeHighlighter | undefined;
  codeTheme: string;
  codeThemeRegistration: RendererPluginCodeThemeRegistration | undefined;
  colorMode: "dark" | "light";
  comments?: MarkdownIrCommentsChrome | undefined;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
  headings: readonly MarkdownHeadingSummary[];
  labels: MarkdownRendererLabels;
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenAnchor(anchor: string): void;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  searchMatchesByNode: ReadonlyMap<string, readonly MarkdownSearchMatch[]>;
  source: MarkdownDiskSource | undefined;
}

export function renderInlines(
  inlines: readonly MarkdownInline[],
  context: MarkdownRenderContext
): ReactNode[] {
  const range = inlines[0]?.range ?? {
    endLine: 1,
    endOffset: 0,
    startLine: 1,
    startOffset: 0,
  };
  return renderMarkdownHtmlInlines(
    inlines,
    {
      ...markdownHtmlRenderEnv({
        activeSearchMatchId: context.activeSearchMatchId,
        fileResources: context.fileResources,
        labels: context.labels,
        onJumpToSource: context.onJumpToSource,
        onOpenAnchor: context.onOpenAnchor,
        onOpenExternal: context.onOpenExternal,
        onOpenInternal: context.onOpenInternal,
        range,
        searchMatches: undefined,
        searchMatchesForHtml: (htmlRange) =>
          searchMatchesFor(context, "html", htmlRange),
        source: context.source,
      }),
      headingIds: [],
    },
    (inline) => renderInline(inline, context)
  );
}

function renderInline(
  inline: MarkdownInline,
  context: MarkdownRenderContext
): ReactNode {
  switch (inline.kind) {
    case "text":
      return (
        <MarkdownSearchText
          activeMatchId={context.activeSearchMatchId}
          matches={searchMatchesFor(context, "text", inline.range)}
          value={inline.value}
        />
      );
    case "inlineCode":
      return (
        <code className="md-inline-code">
          <MarkdownSearchText
            activeMatchId={context.activeSearchMatchId}
            matches={searchMatchesFor(context, "inlineCode", inline.range)}
            value={inline.value}
          />
        </code>
      );
    case "inlineMath":
      return <MarkdownMath displayMode={false} value={inline.value} />;
    case "break":
      return <br />;
    case "emphasis":
      return <em>{renderInlines(inline.children, context)}</em>;
    case "strong":
      return <strong>{renderInlines(inline.children, context)}</strong>;
    case "delete":
      return <del>{renderInlines(inline.children, context)}</del>;
    case "link":
      return (
        <MarkdownResourceLink
          inline={inline}
          onOpenAnchor={context.onOpenAnchor}
          onOpenExternal={context.onOpenExternal}
          onOpenInternal={context.onOpenInternal}
          source={context.source}
        >
          {renderInlines(inline.children, context)}
        </MarkdownResourceLink>
      );
    case "image":
      return (
        <MarkdownResourceImage
          imagePreviewFailedLabel={context.labels.imagePreviewFailed}
          imagePreviewTitle={context.labels.imagePreviewTitle}
          inline={inline}
          openFullscreenLabel={context.labels.openFullscreen}
          resources={context.fileResources}
          source={context.source}
        />
      );
    case "footnoteReference":
      return (
        <sup>
          <a
            className="md-link"
            href={`#footnote-${inline.identifier}`}
            onClick={(event) => {
              event.preventDefault();
              context.onOpenAnchor(`footnote-${inline.identifier}`);
            }}
          >
            {inline.label}
          </a>
        </sup>
      );
    case "html":
      return null;
    case "textDirective":
      if (inline.name === "kbd") {
        return <Kbd>{renderInlines(inline.children, context)}</Kbd>;
      }
      return (
        <span data-directive={inline.name}>
          {renderInlines(inline.children, context)}
        </span>
      );
    default:
      return null;
  }
}
