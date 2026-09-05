import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { GitGutterKind } from "../../editor/git-markers.ts";
import { useFileChangeSurface } from "../../git-changes/context.ts";
import { EMPTY_FILE_CHANGES } from "../../git-changes/types.ts";
import { createFilesTranslate, useFilesPluginLanguage } from "../../i18n.ts";
import {
  MARKDOWN_GIT_BAR_COLOR_VARS,
  MARKDOWN_GIT_BAR_HOVER_WIDTH_PX,
  MARKDOWN_GIT_BAR_SLOT_PX,
  MARKDOWN_GIT_BAR_WIDTH_PX,
} from "./layout.ts";
import {
  type MarkdownGitBarSourceBox,
  mapGitRangesToPreviewBars,
} from "./map.ts";
import {
  markdownGitBarBoxesEqual,
  measureMarkdownGitBarBoxes,
} from "./measure.ts";

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
      "View added change at line {{line}}"
    ),
    deleted: t(
      "filePanel.markdown.gitBars.deleted",
      "View deleted change at line {{line}}"
    ),
    modified: t(
      "filePanel.markdown.gitBars.modified",
      "View edited change at line {{line}}"
    ),
    track: t("filePanel.markdown.gitBars.track", "Uncommitted changes"),
  };
}

export function MarkdownPreviewGitBars({
  context,
  contents,
  ready,
  scrollRoot,
}: {
  readonly context: RendererPluginContext | undefined;
  readonly contents: string;
  readonly ready: boolean;
  readonly scrollRoot: HTMLElement | null;
}) {
  const surface = useFileChangeSurface();
  const model =
    surface?.snapshot.status === "ready" &&
    surface.snapshot.contents === contents
      ? surface.snapshot
      : EMPTY_FILE_CHANGES;
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
    () =>
      mapGitRangesToPreviewBars({
        blocks: boxes,
        ranges: model.ranges,
        unrenderedPages: [
          ...(scrollRoot?.querySelectorAll<HTMLElement>(
            '[data-markdown-page-rendered="false"]'
          ) ?? []),
        ].map((page) => ({
          startLine: Number(page.dataset.sourceLine),
          endLine: Number(page.dataset.sourceEndLine),
        })),
      }),
    [boxes, model.ranges, scrollRoot]
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
          id={segment.id}
          key={segment.id}
          kind={segment.kind}
          label={kindLabel(
            segment.kind,
            labels,
            segment.newLineFrom,
            segment.newLineTo
          )}
          onClick={() => surface?.openRange(segment.id)}
          top={segment.top}
        />
      ))}
    </nav>
  );
}

function GitBarMark({
  id,
  height,
  kind,
  label,
  onClick,
  top,
}: {
  readonly id: string;
  readonly height: number;
  readonly kind: GitGutterKind;
  readonly label: string;
  readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly top: number;
}) {
  const style: CSSProperties = {
    height: kind === "deleted" ? Math.max(8, height) : height,
    top,
  };
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "group/git-bar pointer-events-auto absolute inset-x-0 cursor-pointer overflow-hidden",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-inset"
          )}
          data-git-bar-kind={kind}
          data-git-change-id={id}
          onClick={onClick}
          style={style}
          tabIndex={-1}
          type="button"
        >
          <span
            aria-hidden
            className="mx-auto block h-full w-[var(--markdown-git-bar-w)] rounded-full transition-[width] duration-75 group-hover/git-bar:w-[var(--markdown-git-bar-hover-w)]"
            style={{
              ...(kind === "deleted"
                ? { height: 3, width: 8, borderRadius: 0 }
                : {}),
              backgroundColor: `var(${MARKDOWN_GIT_BAR_COLOR_VARS[kind]})`,
              ["--markdown-git-bar-hover-w" as string]: `${MARKDOWN_GIT_BAR_HOVER_WIDTH_PX}px`,
              ["--markdown-git-bar-w" as string]: `${MARKDOWN_GIT_BAR_WIDTH_PX}px`,
            }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
