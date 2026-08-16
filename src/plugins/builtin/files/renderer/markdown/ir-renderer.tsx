import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pier/ui/table.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createElement, type ReactNode, useMemo } from "react";
import { MarkdownCodeBlock } from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import { wrapBlocksWithComments } from "./comments/ir-blocks.tsx";
import type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
import type { MarkdownCrossModeAnchor } from "./cross-mode-anchor.ts";
import { MarkdownDiagram } from "./diagram.tsx";
import type { MarkdownBlock } from "./ir.ts";
import {
  type MarkdownRenderContext,
  type MarkdownRendererLabels,
  renderInlines,
} from "./ir-inlines.tsx";
import {
  cellKey,
  groupSearchMatches,
  headingClassName,
  isCalloutDirective,
  searchMatchesFor,
  sourceBlockProps,
  tableAlignment,
} from "./ir-render-helpers.ts";
import { MarkdownMath } from "./math.tsx";
import { MarkdownPaginationView } from "./pagination-view.tsx";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "./resource-elements.tsx";
import type { MarkdownPagination } from "./runtime.ts";
import type { MarkdownSearchMatch } from "./search.ts";
import { MarkdownSearchText } from "./search-mark.tsx";

export type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
export type { MarkdownRendererLabels } from "./ir-inlines.tsx";
export type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "./resource-elements.tsx";
export {
  resolveRelativeMarkdownResource,
  safeMarkdownUrl,
} from "./resource-elements.tsx";

interface MarkdownIrRendererProps {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  charts: RendererPluginContext["charts"] | undefined;
  codeHighlighter: MarkdownCodeHighlighter | undefined;
  codeTheme: string;
  /** Paper / app light-dark for mermaid re-render on theme switch. */
  colorMode: "dark" | "light";
  comments?: MarkdownIrCommentsChrome | undefined;
  contentAnchor?: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId?: string | number | undefined;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
  forceCommentPageIndex?: number | undefined;
  initialAnchor: string | undefined;
  initialAnchorRequestId: string | undefined;
  labels: MarkdownRendererLabels;
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  pagination: MarkdownPagination;
  scrollRoot?: HTMLElement | null | undefined;
  searchMatches: readonly MarkdownSearchMatch[];
  source: MarkdownDiskSource | undefined;
}

export function MarkdownIrRenderer(props: MarkdownIrRendererProps) {
  const searchMatchesByNode = useMemo(
    () => groupSearchMatches(props.searchMatches),
    [props.searchMatches]
  );
  return (
    <MarkdownPaginationView
      activeSearchMatchId={props.activeSearchMatchId}
      activeSearchPageIndex={props.activeSearchPageIndex}
      contentAnchor={props.contentAnchor}
      contentAnchorRequestId={props.contentAnchorRequestId}
      forceCommentPageIndex={props.forceCommentPageIndex}
      initialAnchor={props.initialAnchor}
      initialAnchorRequestId={props.initialAnchorRequestId}
      pagination={props.pagination}
      renderPage={(page, onOpenAnchor) => {
        const context: MarkdownRenderContext = {
          activeSearchMatchId: props.activeSearchMatchId,
          activeSearchPageIndex: props.activeSearchPageIndex,
          charts: props.charts,
          codeHighlighter: props.codeHighlighter,
          codeTheme: props.codeTheme,
          colorMode: props.colorMode,
          ...(props.comments ? { comments: props.comments } : {}),
          copyCode: props.copyCode,
          fileResources: props.fileResources,
          labels: props.labels,
          onJumpToSource: props.onJumpToSource,
          onOpenAnchor,
          onOpenExternal: props.onOpenExternal,
          onOpenInternal: props.onOpenInternal,
          searchMatchesByNode,
          source: props.source,
        };
        // Top-level only: nested list/quote blocks must not get comment chrome.
        return renderBlocks(page.blocks, context, true);
      }}
      scrollRoot={props.scrollRoot ?? null}
    />
  );
}

function renderBlocks(
  blocks: readonly MarkdownBlock[],
  context: MarkdownRenderContext,
  wrapComments = false
): ReactNode[] {
  return wrapBlocksWithComments(
    blocks,
    (block) => renderBlock(block, context),
    wrapComments ? context.comments : undefined
  );
}

function renderBlock(
  block: MarkdownBlock,
  context: MarkdownRenderContext
): ReactNode {
  switch (block.kind) {
    case "heading": {
      const heading = createElement(
        `h${block.depth}`,
        sourceBlockProps(block.range, context, {
          className: headingClassName(block.depth),
          id: block.id,
        }),
        renderInlines(block.children, context)
      );
      return heading;
    }
    case "paragraph": {
      const tag = block.children.some((inline) => inline.kind === "image")
        ? "div"
        : "p";
      return createElement(
        tag,
        sourceBlockProps(block.range, context, {
          className: "md-p",
        }),
        renderInlines(block.children, context)
      );
    }
    case "code":
      if (block.lang?.toLowerCase() === "mermaid" && context.charts) {
        return (
          <div
            {...sourceBlockProps(block.range, context, {
              className: "md-diagram",
            })}
          >
            <MarkdownDiagram
              // CSS-var mermaid inherits paper tokens; remount keeps node ids clean
              // when reading appearance flips the preview color mode.
              charts={context.charts}
              contentPreview={context.fileResources?.contentPreview}
              errorLabel={context.labels.diagramFailed}
              key={`mermaid:${context.colorMode}:${block.range.startOffset}`}
              label={context.labels.diagramLabel}
              openFullscreenLabel={context.labels.openFullscreen}
              previewTitle={context.labels.diagramPreviewTitle}
              source={block.value}
            />
          </div>
        );
      }
      return (
        <div {...sourceBlockProps(block.range, context)}>
          <MarkdownCodeBlock
            activeSearchMatchId={context.activeSearchMatchId}
            code={block.value}
            highlighter={context.codeHighlighter}
            labels={context.labels}
            language={block.lang}
            meta={block.meta}
            onCopy={context.copyCode}
            searchMatches={searchMatchesFor(context, "code", block.range)}
            theme={context.codeTheme}
          />
        </div>
      );
    case "math":
      return (
        <div
          {...sourceBlockProps(block.range, context, {
            className: "md-math-block",
          })}
        >
          <MarkdownMath displayMode value={block.value} />
        </div>
      );
    case "blockquote":
      return (
        <blockquote
          {...sourceBlockProps(block.range, context, {
            className: "md-blockquote",
          })}
        >
          {renderBlocks(block.blocks, context)}
        </blockquote>
      );
    case "list": {
      const listChildren = block.items.map((item) => (
        <li
          {...sourceBlockProps(item.range, context, {
            className: item.checked === null ? "md-li" : "md-li md-li-task",
          })}
          key={`${item.range.startOffset}-${item.range.endOffset}`}
        >
          {item.checked === null ? null : (
            <Checkbox
              aria-label={
                item.checked
                  ? context.labels.completedTask
                  : context.labels.incompleteTask
              }
              checked={item.checked}
              className="mt-1.5"
              disabled
            />
          )}
          <div className="min-w-0 flex-1">
            {renderBlocks(item.blocks, context)}
          </div>
        </li>
      ));
      return createElement(
        block.ordered ? "ol" : "ul",
        {
          ...sourceBlockProps(block.range, context, {
            className: block.ordered ? "md-ol" : "md-ul",
          }),
          start: block.ordered ? (block.start ?? undefined) : undefined,
        },
        listChildren
      );
    }
    case "table": {
      const [header, ...body] = block.rows;
      if (!header) return null;
      return (
        <div
          {...sourceBlockProps(block.range, context, {
            className: "md-table-wrap",
          })}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {header.cells.map((cell, index) => (
                  <TableHead
                    className={tableAlignment(block.align[index])}
                    key={cellKey(cell)}
                  >
                    {renderInlines(cell.children, context)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {body.map((row) => (
                <TableRow
                  key={`${row.range.startOffset}-${row.range.endOffset}`}
                >
                  {row.cells.map((cell, index) => (
                    <TableCell
                      className={tableAlignment(block.align[index])}
                      key={cellKey(cell)}
                    >
                      {renderInlines(cell.children, context)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }
    case "thematicBreak":
      return <Separator className="md-hr" />;
    case "html":
      return (
        <pre className="md-raw">
          <MarkdownSearchText
            activeMatchId={context.activeSearchMatchId}
            matches={searchMatchesFor(context, "html", block.range)}
            value={block.value}
          />
        </pre>
      );
    case "containerDirective": {
      if (isCalloutDirective(block.name)) {
        const title = block.attributes.title?.trim();
        return (
          <Alert
            className="md-callout"
            data-directive={block.name}
            variant={block.name === "danger" ? "destructive" : "default"}
          >
            {title ? <AlertTitle>{title}</AlertTitle> : null}
            <AlertDescription>
              {renderBlocks(block.blocks, context)}
            </AlertDescription>
          </Alert>
        );
      }
      return (
        <aside className="md-aside" data-directive={block.name}>
          {renderBlocks(block.blocks, context)}
        </aside>
      );
    }
    case "leafDirective":
      return (
        <div className="md-p" data-directive={block.name}>
          {renderInlines(block.children, context)}
        </div>
      );
    case "footnoteDefinition":
      return (
        <div className="md-footnote" id={`footnote-${block.identifier}`}>
          <span className="font-mono text-muted-foreground">
            [{block.label}]
          </span>
          <div>{renderBlocks(block.blocks, context)}</div>
        </div>
      );
    case "unsupported":
      return (
        <pre className="md-raw">
          <MarkdownSearchText
            activeMatchId={context.activeSearchMatchId}
            matches={searchMatchesFor(context, "unsupported", block.range)}
            value={block.value}
          />
        </pre>
      );
    default:
      return null;
  }
}
