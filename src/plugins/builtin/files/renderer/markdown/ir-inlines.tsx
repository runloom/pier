/**
 * Markdown IR inline renderer (text, links, images, kbd, footnotes).
 */
import { Kbd } from "@pier/ui/kbd.tsx";
import type {
  RendererPluginCodeThemeRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { Fragment, type ReactNode } from "react";
import type { MarkdownCodeBlockLabels } from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
import type { MarkdownInline } from "./ir.ts";
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
  return inlines.map((inline) => (
    <Fragment
      key={`${inline.kind}-${inline.range.startOffset}-${inline.range.endOffset}`}
    >
      {renderInline(inline, context)}
    </Fragment>
  ));
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
      return (
        <code className="text-muted-foreground">
          <MarkdownSearchText
            activeMatchId={context.activeSearchMatchId}
            matches={searchMatchesFor(context, "html", inline.range)}
            value={inline.value}
          />
        </code>
      );
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
