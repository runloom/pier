import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
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
import { createElement, Fragment, type ReactNode, useMemo } from "react";
import {
  MarkdownCodeBlock,
  type MarkdownCodeBlockLabels,
} from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import { MarkdownDiagram } from "./diagram.tsx";
import type { MarkdownBlock, MarkdownInline } from "./ir.ts";
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
import {
  type MarkdownDiskSource,
  type MarkdownFileResources,
  type MarkdownInternalTarget,
  MarkdownResourceImage,
  MarkdownResourceLink,
} from "./resource-elements.tsx";
import type { MarkdownPagination } from "./runtime.ts";

export type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "./resource-elements.tsx";
export {
  resolveRelativeMarkdownResource,
  safeMarkdownUrl,
} from "./resource-elements.tsx";

import type { MarkdownCrossModeAnchor } from "./cross-mode-anchor.ts";
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

interface MarkdownIrRendererProps {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  charts: RendererPluginContext["charts"] | undefined;
  codeHighlighter: MarkdownCodeHighlighter | undefined;
  codeTheme: string;
  /** Paper / app light-dark for mermaid re-render on theme switch. */
  colorMode: "dark" | "light";
  contentAnchor?: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId?: string | number | undefined;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
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

interface MarkdownRenderContext
  extends Omit<
    MarkdownIrRendererProps,
    | "contentAnchor"
    | "contentAnchorRequestId"
    | "initialAnchor"
    | "initialAnchorRequestId"
    | "pagination"
    | "scrollRoot"
    | "searchMatches"
  > {
  onOpenAnchor(anchor: string): void;
  searchMatchesByNode: ReadonlyMap<string, readonly MarkdownSearchMatch[]>;
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
        return renderBlocks(page.blocks, context);
      }}
      scrollRoot={props.scrollRoot ?? null}
    />
  );
}

function renderBlocks(
  blocks: readonly MarkdownBlock[],
  context: MarkdownRenderContext
): ReactNode[] {
  return blocks.map((block) => (
    <Fragment
      key={`${block.kind}-${block.range.startOffset}-${block.range.endOffset}`}
    >
      {renderBlock(block, context)}
    </Fragment>
  ));
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
              // Remount on color mode so mermaid re-renders (facade reads store at call).
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

function renderInlines(
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
