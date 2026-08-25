import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import type {
  RendererPluginCodeThemeRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { Link2 } from "lucide-react";
import {
  createElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MarkdownCodeBlock } from "./code-block.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import { wrapBlocksWithComments } from "./comments/ir-blocks.tsx";
import type { MarkdownIrCommentsChrome } from "./comments/ir-types.ts";
import type { MarkdownCrossModeAnchor } from "./cross-mode-anchor.ts";
import { MarkdownDiagram } from "./diagram.tsx";
import { markdownHtmlRenderEnv } from "./html/env.ts";
import { renderMarkdownHtmlBlock } from "./html/render.tsx";
import type { MarkdownBlock } from "./ir.ts";
import {
  type MarkdownRenderContext,
  type MarkdownRendererLabels,
  renderInlines,
} from "./ir-inlines.tsx";
import {
  groupSearchMatches,
  headingClassName,
  isCalloutDirective,
  searchMatchesFor,
  sourceBlockProps,
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
import { MarkdownTableView } from "./table/table-view.tsx";
import type { TaskToggleInput } from "./task-patch.ts";

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
  codeThemeRegistration: RendererPluginCodeThemeRegistration | undefined;
  /** Paper / app light-dark for mermaid re-render on theme switch. */
  colorMode: "dark" | "light";
  comments?: MarkdownIrCommentsChrome | undefined;
  contentAnchor?: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId?: string | number | undefined;
  copyAnchor: ((anchor: string) => Promise<void>) | undefined;
  copyCode: ((code: string) => Promise<void>) | undefined;
  fileResources: MarkdownFileResources | undefined;
  forceCommentPageIndex?: number | undefined;
  initialAnchor: string | undefined;
  initialAnchorRequestId: string | undefined;
  labels: MarkdownRendererLabels;
  onJumpToSource?: ((offset: number) => void) | undefined;
  onOpenExternal: (url: string) => void;
  onOpenInternal: ((target: MarkdownInternalTarget) => void) | undefined;
  onToggleTask?: ((input: TaskToggleInput) => void) | undefined;
  onToggleWordWrap?: (() => void) | undefined;
  pagination: MarkdownPagination;
  scrollRoot?: HTMLElement | null | undefined;
  searchMatches: readonly MarkdownSearchMatch[];
  source: MarkdownDiskSource | undefined;
  wordWrap: boolean;
}

export function MarkdownIrRenderer(props: MarkdownIrRendererProps) {
  const searchMatchesByNode = useMemo(
    () => groupSearchMatches(props.searchMatches),
    [props.searchMatches]
  );
  const footnoteDefinitions = useMemo(() => {
    const map = new Map<string, MarkdownBlock[]>();
    for (const page of props.pagination.pages) {
      for (const block of page.blocks) {
        if (block.kind === "footnoteDefinition") {
          map.set(block.identifier, block.blocks);
        }
      }
    }
    return map;
  }, [props.pagination.pages]);
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
          onToggleWordWrap: props.onToggleWordWrap,
          onToggleTask: props.onToggleTask,
          charts: props.charts,
          codeHighlighter: props.codeHighlighter,
          codeTheme: props.codeTheme,
          codeThemeRegistration: props.codeThemeRegistration,
          colorMode: props.colorMode,
          ...(props.comments ? { comments: props.comments } : {}),
          copyAnchor: props.copyAnchor,
          copyCode: props.copyCode,
          fileResources: props.fileResources,
          footnoteDefinitions,
          headings: props.pagination.headings,
          labels: props.labels,
          onJumpToSource: props.onJumpToSource,
          onOpenAnchor,
          onOpenExternal: props.onOpenExternal,
          onOpenInternal: props.onOpenInternal,
          searchMatchesByNode,
          source: props.source,
          wordWrap: props.wordWrap,
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

function MarkdownTaskCheckbox({
  checked,
  context,
  rangeEnd,
  rangeStart,
}: {
  checked: boolean;
  context: MarkdownRenderContext;
  rangeEnd: number;
  rangeStart: number;
}) {
  // Optimistic flip: the document model write-back is async (autosave/CAS),
  const [optimisticChecked, setOptimisticChecked] = useState<boolean | null>(
    null
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: checked is the trigger for clearing optimistic state; it is not read inside the effect body but must be in deps.
  useEffect(() => {
    setOptimisticChecked(null);
  }, [checked]);
  // 写入 no-op 或失败时 checked prop 不变，上面的 effect 不会触发；
  // 超时兜底回落真实状态，避免复选框一直显示未持久化的翻转。
  useEffect(() => {
    if (optimisticChecked === null) return;
    const timer = setTimeout(() => setOptimisticChecked(null), 1500);
    return () => clearTimeout(timer);
  }, [optimisticChecked]);
  const onToggleTask = context.onToggleTask;
  return (
    <Checkbox
      aria-label={
        checked ? context.labels.completedTask : context.labels.incompleteTask
      }
      checked={optimisticChecked ?? checked}
      className="mt-1.5"
      {...(onToggleTask
        ? {
            onCheckedChange: (next: boolean | "indeterminate") => {
              setOptimisticChecked(next === true);
              onToggleTask({
                checked: next === true,
                rangeEnd,
                rangeStart,
              });
            },
          }
        : {})}
    />
  );
}

function renderBlock(
  block: MarkdownBlock,
  context: MarkdownRenderContext
): ReactNode {
  switch (block.kind) {
    case "heading": {
      return createElement(
        `h${block.depth}`,
        sourceBlockProps(block.range, context, {
          className: `${headingClassName(block.depth)} md-heading-group`,
          id: block.id,
        }),
        renderInlines(block.children, context),
        context.source
          ? createElement(
              "button",
              {
                "aria-label": context.labels.copyAnchor,
                className: "md-anchor-copy",
                type: "button",
                onClick: async (event: ReactMouseEvent<HTMLElement>) => {
                  // Keep the heading's own source-jump handler out of the way.
                  event.stopPropagation();
                  await context.copyAnchor?.(
                    `${context.source!.path}#${block.id}`
                  );
                },
              },
              createElement(Link2)
            )
          : null
      );
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
              shrinkHintLabel={context.labels.diagramScaledHint}
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
            onToggleWordWrap={context.onToggleWordWrap}
            searchMatches={searchMatchesFor(context, "code", block.range)}
            theme={context.codeTheme}
            themeRegistration={context.codeThemeRegistration}
            wordWrap={context.wordWrap}
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
            <MarkdownTaskCheckbox
              checked={item.checked}
              context={context}
              rangeEnd={item.range.endOffset}
              rangeStart={item.range.startOffset}
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
    case "table":
      // MarkdownTableView owns .md-table-wrap (scroll container + drag line).
      return <MarkdownTableView block={block} context={context} />;
    case "thematicBreak":
      return <Separator className="md-hr" />;
    case "html":
      return renderMarkdownHtmlBlock(block.value, {
        ...markdownHtmlRenderEnv({
          activeSearchMatchId: context.activeSearchMatchId,
          fileResources: context.fileResources,
          labels: context.labels,
          onJumpToSource: context.onJumpToSource,
          onOpenAnchor: context.onOpenAnchor,
          onOpenExternal: context.onOpenExternal,
          onOpenInternal: context.onOpenInternal,
          range: block.range,
          searchMatches: searchMatchesFor(context, "html", block.range),
          source: context.source,
        }),
        headings: context.headings,
        range: block.range,
      });
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
