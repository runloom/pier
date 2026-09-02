import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { navigateGitGutterToReview } from "../../editor/git-gutter-navigate.ts";
import type { GitGutterKind } from "../../editor/git-markers.ts";
import { createFilesTranslate, useFilesPluginLanguage } from "../../i18n.ts";
import type { MarkdownDiskSource } from "../resource-elements.tsx";
import {
  MARKDOWN_GIT_BAR_COLOR_VARS,
  MARKDOWN_GIT_BAR_HOVER_WIDTH_PX,
  MARKDOWN_GIT_BAR_SLOT_PX,
  MARKDOWN_GIT_BAR_WIDTH_PX,
} from "./layout.ts";
import {
  type MarkdownGitBarSegment,
  type MarkdownGitBarSourceBox,
  mapGitRangesToPreviewBars,
  resolveGitBarClickLine,
} from "./map.ts";
import {
  markdownGitBarBoxesEqual,
  measureMarkdownGitBarBoxes,
} from "./measure.ts";
import { useMarkdownPreviewGitModel } from "./use-model.ts";

export interface MarkdownPreviewGitBarLabels {
  readonly added: string;
  readonly deleted: string;
  readonly modified: string;
  readonly track: string;
}

function withLineToken(template: string, line: string): string {
  return template.replaceAll("{{line}}", line);
}

function kindLabel(
  kind: GitGutterKind,
  labels: MarkdownPreviewGitBarLabels,
  from: number,
  to: number
): string {
  const line = from === to ? String(from) : `${from}–${to}`;
  if (kind === "added") {
    return withLineToken(labels.added, line);
  }
  if (kind === "deleted") {
    return withLineToken(labels.deleted, line);
  }
  return withLineToken(labels.modified, line);
}

function useGitBarLabels(
  context: RendererPluginContext | undefined
): MarkdownPreviewGitBarLabels {
  useFilesPluginLanguage();
  const t = createFilesTranslate(context);
  return {
    added: t(
      "filePanel.markdown.gitBars.added",
      "Review added change at line {{line}}"
    ),
    deleted: t(
      "filePanel.markdown.gitBars.deleted",
      "Review deleted change at line {{line}}"
    ),
    modified: t(
      "filePanel.markdown.gitBars.modified",
      "Review edited change at line {{line}}"
    ),
    track: t("filePanel.markdown.gitBars.track", "Uncommitted changes"),
  };
}

function contentYFromClick(
  event: ReactMouseEvent<HTMLButtonElement>,
  scrollRoot: HTMLElement
): number {
  return (
    event.clientY -
    scrollRoot.getBoundingClientRect().top +
    scrollRoot.scrollTop
  );
}

export function MarkdownPreviewGitBars({
  context,
  diskRevision,
  panelContext,
  ready,
  scrollRoot,
  source,
}: {
  readonly context: RendererPluginContext | undefined;
  readonly diskRevision?: string | null | undefined;
  readonly panelContext: PanelContext | undefined;
  readonly ready: boolean;
  readonly scrollRoot: HTMLElement | null;
  readonly source: MarkdownDiskSource | undefined;
}) {
  const model = useMarkdownPreviewGitModel({
    context,
    refreshKey: diskRevision,
    source,
  });
  const labels = useGitBarLabels(context);
  const [boxes, setBoxes] = useState<MarkdownGitBarSourceBox[]>(() =>
    scrollRoot ? measureMarkdownGitBarBoxes(scrollRoot) : []
  );

  useEffect(() => {
    if (!(ready && scrollRoot && model.ranges.length > 0)) {
      setBoxes([]);
      return;
    }
    let frame = 0;
    const update = () => {
      const next = measureMarkdownGitBarBoxes(scrollRoot);
      setBoxes((current) =>
        markdownGitBarBoxesEqual(current, next) ? current : next
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    schedule();
    const prose = scrollRoot.querySelector("[data-slot='markdown-prose']");
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(scrollRoot);
    if (prose) {
      resizeObserver?.observe(prose);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    mutationObserver?.observe(prose ?? scrollRoot, {
      childList: true,
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [model.ranges, ready, scrollRoot]);

  const segments = useMemo(
    () => mapGitRangesToPreviewBars({ blocks: boxes, ranges: model.ranges }),
    [boxes, model.ranges]
  );

  const onSelect = useCallback(
    (line: number) => {
      if (!(context && source)) {
        return;
      }
      const t = createFilesTranslate(context);
      const failed = t(
        "filePanel.editor.gitGutter.openChangesFailed",
        "Couldn't open Changes. Open a project folder with git first."
      );
      const base = panelContext ?? context.panels.getActiveContext();
      if (!base) {
        context.notifications.error(failed);
        return;
      }
      const opened = navigateGitGutterToReview({
        context,
        line,
        panelContext: {
          ...base,
          gitRoot: base.gitRoot ?? source.root,
          projectRootPath: base.projectRootPath ?? source.root,
          worktreeRoot: base.worktreeRoot ?? source.root,
        },
        path: source.path,
      });
      if (!opened) {
        context.notifications.error(failed);
      }
    },
    [context, panelContext, source]
  );

  const onMarkClick = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      segment: MarkdownGitBarSegment
    ) => {
      if (!scrollRoot) {
        onSelect(segment.newLineFrom);
        return;
      }
      onSelect(
        resolveGitBarClickLine({
          blocks: boxes,
          newLineFrom: segment.newLineFrom,
          newLineTo: segment.newLineTo,
          y: contentYFromClick(event, scrollRoot),
        })
      );
    },
    [boxes, onSelect, scrollRoot]
  );

  if (segments.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={labels.track}
      className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      data-slot="markdown-preview-git-bars"
      style={{
        height: 0,
        width: MARKDOWN_GIT_BAR_SLOT_PX,
      }}
    >
      {segments.map((segment) => (
        <GitBarMark
          height={segment.height}
          key={segment.id}
          kind={segment.kind}
          label={kindLabel(
            segment.kind,
            labels,
            segment.newLineFrom,
            segment.newLineTo
          )}
          onClick={(event) => onMarkClick(event, segment)}
          top={segment.top}
        />
      ))}
    </nav>
  );
}

function GitBarMark({
  height,
  kind,
  label,
  onClick,
  top,
}: {
  readonly height: number;
  readonly kind: GitGutterKind;
  readonly label: string;
  readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly top: number;
}) {
  const style: CSSProperties = {
    height,
    top,
  };
  return (
    <button
      aria-label={label}
      className={cn(
        "group/git-bar pointer-events-auto absolute inset-x-0 cursor-pointer overflow-hidden",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-inset"
      )}
      data-git-bar-kind={kind}
      onClick={onClick}
      style={style}
      tabIndex={-1}
      type="button"
    >
      <span
        aria-hidden
        className="mx-auto block h-full w-[var(--markdown-git-bar-w)] rounded-full transition-[width] duration-75 group-hover/git-bar:w-[var(--markdown-git-bar-hover-w)]"
        style={{
          backgroundColor: `var(${MARKDOWN_GIT_BAR_COLOR_VARS[kind]})`,
          ["--markdown-git-bar-hover-w" as string]: `${MARKDOWN_GIT_BAR_HOVER_WIDTH_PX}px`,
          ["--markdown-git-bar-w" as string]: `${MARKDOWN_GIT_BAR_WIDTH_PX}px`,
        }}
      />
    </button>
  );
}
