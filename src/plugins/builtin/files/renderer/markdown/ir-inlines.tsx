/**
 * Markdown IR inline renderer (text, links, images, kbd, footnotes).
 */
import { Kbd } from "@pier/ui/kbd.tsx";
import type {
  RendererPluginCodeThemeRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { type ReactNode, useState } from "react";
import type { MarkdownCodeBlockLabels } from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
import { FootnotePopover } from "./footnote-popover.tsx";
import { markdownHtmlRenderEnv } from "./html/env.ts";
import { renderMarkdownHtmlInlines } from "./html/inlines.tsx";
import type {
  MarkdownBlock,
  MarkdownHeadingSummary,
  MarkdownInline,
} from "./ir.ts";
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
import type { TaskToggleInput } from "./task-patch.ts";

export interface MarkdownRendererLabels extends MarkdownCodeBlockLabels {
  anchorCopied: string;
  /** aria-valuetext for auto-width columns (no stored width yet). */
  columnWidthAuto: string;
  completedTask: string;
  /** Heading hover button aria-label. */
  copyAnchor: string;
  diagramFailed: string;
  diagramLabel: string;
  diagramPreviewTitle: string;
  imagePreviewFailed: string;
  imagePreviewTitle: string;
  incompleteTask: string;
  openFullscreen: string;
  /** Drag handle / separator inside table header cells. */
  resizeColumn: string;
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
  /** Host-provided anchor copy channel (clipboard + toast/alert feedback). */
  copyAnchor: ((anchor: string) => Promise<void>) | undefined;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
  footnoteDefinitions: Map<string, MarkdownBlock[]>;
  headings: readonly MarkdownHeadingSummary[];
  labels: MarkdownRendererLabels;
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenAnchor(anchor: string): void;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  /** Host task-checkbox toggle; writes back via document model (host-owned). */
  onToggleTask?: ((input: TaskToggleInput) => void) | undefined;
  /** Host word-wrap toggle; writes back via plugin configuration (host-owned). */
  onToggleWordWrap?: (() => void) | undefined;
  searchMatchesByNode: ReadonlyMap<string, readonly MarkdownSearchMatch[]>;
  source: MarkdownDiskSource | undefined;
  wordWrap: boolean;
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
          imagePreviewTitle={context.labels.imagePreviewTitle}
          inline={inline}
          openFullscreenLabel={context.labels.openFullscreen}
          resources={context.fileResources}
          source={context.source}
        />
      );
    case "footnoteReference":
      return <FootnoteReference context={context} inline={inline} />;
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

/** Superscript footnote reference with a hover/focus definition popover.
 * Click-through jump behavior is unchanged. */
function FootnoteReference(props: {
  context: MarkdownRenderContext;
  inline: Extract<MarkdownInline, { kind: "footnoteReference" }>;
}) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const blocks = props.context.footnoteDefinitions.get(props.inline.identifier);
  // 只渲染段落块：popover 内容构建器无法渲染列表/代码等块（renderBlocks
  // 在 ir-renderer，反向 import 会成环）。全非段落时不出 popover——
  // 空浮层比缺内容更糟；文档底部定义区仍展示完整内容。
  const paragraphs =
    blocks?.filter(
      (block): block is Extract<MarkdownBlock, { kind: "paragraph" }> =>
        block.kind === "paragraph"
    ) ?? [];
  const content =
    paragraphs.length > 0
      ? paragraphs.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: footnote definition blocks have no stable identity beyond position.
          <div key={index}>{renderInlines(block.children, props.context)}</div>
        ))
      : null;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: hover/focus drives the footnote definition popover; click-through jump is the nested <a>, so making <sup> itself a button would nest interactive elements.
    <sup
      onBlur={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setHovered(true);
      }}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      ref={setAnchorElement}
    >
      <a
        className="md-link"
        href={`#footnote-${props.inline.identifier}`}
        onClick={(event) => {
          event.preventDefault();
          props.context.onOpenAnchor(`footnote-${props.inline.identifier}`);
        }}
      >
        {props.inline.label}
      </a>
      {hovered && anchorElement !== null && content !== null ? (
        <FootnotePopover anchorElement={anchorElement} content={content} />
      ) : null}
    </sup>
  );
}
