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
import type { MarkdownCodeHighlighter } from "./markdown/markdown-code-highlighter.ts";
import type {
  MarkdownBlock,
  MarkdownInline,
  MarkdownSourceRange,
  MarkdownTableCell,
} from "./markdown/markdown-ir.ts";
import type { MarkdownPagination } from "./markdown/markdown-runtime.ts";
import {
  MarkdownCodeBlock,
  type MarkdownCodeBlockLabels,
} from "./markdown-code-block.tsx";
import { MarkdownDiagram } from "./markdown-diagram.tsx";
import { MarkdownMath } from "./markdown-math.tsx";
import { MarkdownPaginationView } from "./markdown-pagination-view.tsx";
import {
  type MarkdownDiskSource,
  type MarkdownFileResources,
  type MarkdownInternalTarget,
  MarkdownResourceImage,
  MarkdownResourceLink,
} from "./markdown-resource-elements.tsx";

export type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
} from "./markdown-resource-elements.tsx";
export {
  resolveRelativeMarkdownResource,
  safeMarkdownUrl,
} from "./markdown-resource-elements.tsx";

import {
  type MarkdownSearchMatch,
  markdownSearchNodeKey,
} from "./markdown-search.ts";
import { MarkdownSearchText } from "./markdown-search-mark.tsx";

export interface MarkdownRendererLabels extends MarkdownCodeBlockLabels {
  completedTask: string;
  diagramFailed: string;
  diagramLabel: string;
  incompleteTask: string;
}

interface MarkdownIrRendererProps {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  charts: RendererPluginContext["charts"] | undefined;
  codeHighlighter: MarkdownCodeHighlighter | undefined;
  codeTheme: string;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
  initialAnchor: string | undefined;
  initialAnchorRequestId: string | undefined;
  labels: MarkdownRendererLabels;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  pagination: MarkdownPagination;
  searchMatches: readonly MarkdownSearchMatch[];
  source: MarkdownDiskSource | undefined;
}

interface MarkdownRenderContext
  extends Omit<
    MarkdownIrRendererProps,
    "initialAnchor" | "initialAnchorRequestId" | "pagination" | "searchMatches"
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
          copyCode: props.copyCode,
          fileResources: props.fileResources,
          labels: props.labels,
          onOpenAnchor,
          onOpenExternal: props.onOpenExternal,
          onOpenInternal: props.onOpenInternal,
          searchMatchesByNode,
          source: props.source,
        };
        return renderBlocks(page.blocks, context);
      }}
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
        {
          className: headingClassName(block.depth),
          id: block.id,
        },
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
        {
          className:
            "my-3 text-[0.9375rem] leading-7 text-foreground/95 [&:first-child]:mt-0",
        },
        renderInlines(block.children, context)
      );
    }
    case "code":
      if (block.lang?.toLowerCase() === "mermaid" && context.charts) {
        return (
          <MarkdownDiagram
            charts={context.charts}
            errorLabel={context.labels.diagramFailed}
            label={context.labels.diagramLabel}
            source={block.value}
          />
        );
      }
      return (
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
      );
    case "math":
      return <MarkdownMath displayMode value={block.value} />;
    case "blockquote":
      return (
        <blockquote className="my-4 border-border border-l-2 pl-4 text-muted-foreground [&>p]:my-2">
          {renderBlocks(block.blocks, context)}
        </blockquote>
      );
    case "list": {
      const listChildren = block.items.map((item) => (
        <li
          className={
            item.checked === null
              ? undefined
              : "flex list-none items-start gap-2"
          }
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
          className: block.ordered
            ? "my-3 grid list-decimal gap-1.5 pl-6 marker:text-muted-foreground"
            : "my-3 grid list-disc gap-1.5 pl-6 marker:text-muted-foreground",
          start: block.ordered ? (block.start ?? undefined) : undefined,
        },
        listChildren
      );
    }
    case "table": {
      const [header, ...body] = block.rows;
      if (!header) return null;
      return (
        <Table className="my-4">
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
              <TableRow key={`${row.range.startOffset}-${row.range.endOffset}`}>
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
      );
    }
    case "thematicBreak":
      return <Separator className="my-6" />;
    case "html":
      return (
        <pre className="my-3 whitespace-pre-wrap text-muted-foreground">
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
            className="my-4"
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
        <aside
          className="my-4 rounded-md border p-3"
          data-directive={block.name}
        >
          {renderBlocks(block.blocks, context)}
        </aside>
      );
    }
    case "leafDirective":
      return (
        <div className="my-3" data-directive={block.name}>
          {renderInlines(block.children, context)}
        </div>
      );
    case "footnoteDefinition":
      return (
        <div
          className="my-3 flex gap-2 text-sm"
          id={`footnote-${block.identifier}`}
        >
          <span className="font-mono text-muted-foreground">
            [{block.label}]
          </span>
          <div>{renderBlocks(block.blocks, context)}</div>
        </div>
      );
    case "unsupported":
      return (
        <pre className="my-3 whitespace-pre-wrap text-muted-foreground">
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
        <code className="rounded-md border border-border/60 bg-muted/70 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
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
          inline={inline}
          resources={context.fileResources}
          source={context.source}
        />
      );
    case "footnoteReference":
      return (
        <sup>
          <a
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

function headingClassName(depth: number): string {
  if (depth === 1) {
    return "mt-8 mb-3 border-b border-border/70 pb-2 font-semibold text-3xl tracking-tight first:mt-0";
  }
  if (depth === 2) {
    return "mt-7 mb-2.5 border-b border-border/50 pb-1.5 font-semibold text-2xl tracking-tight";
  }
  if (depth === 3) {
    return "mt-6 mb-2 font-semibold text-xl tracking-tight";
  }
  return "mt-5 mb-2 font-semibold text-base tracking-tight";
}

function tableAlignment(
  alignment: "center" | "left" | "right" | null | undefined
) {
  if (alignment === "center") return "text-center";
  if (alignment === "right") return "text-right";
  return "text-left";
}

function cellKey(cell: MarkdownTableCell): string {
  return `${cell.range.startOffset}-${cell.range.endOffset}`;
}

function groupSearchMatches(
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

function searchMatchesFor(
  context: MarkdownRenderContext,
  kind: string,
  range: MarkdownSourceRange
): readonly MarkdownSearchMatch[] | undefined {
  return context.searchMatchesByNode.get(markdownSearchNodeKey(kind, range));
}

function isCalloutDirective(name: string): boolean {
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
