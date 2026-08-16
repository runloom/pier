import { Button } from "@pier/ui/button.tsx";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { markdownViewportFocusY } from "./cross-mode-anchor.ts";
import type { MarkdownHeadingSummary } from "./ir.ts";
import {
  MARKDOWN_TOC_EDGE_INSET_PX,
  MARKDOWN_TOC_TICK_GAP_PX,
  MARKDOWN_TOC_TICK_HEIGHT_PX,
  markdownTocTickWidthPx,
} from "./preview-toc-layout.ts";

/** Viewport py-1 top+bottom; keep scrollport height in sync with list measure. */
const MARKDOWN_TOC_PANEL_Y_PAD_PX = 8;

/**
 * One outline shell: Notion-style tick rail by default; hover/focus-within
 * fades the title list over the ticks, vertically centered on the tick stack.
 * Trailing `MARKDOWN_TOC_EDGE_INSET_PX` is part of the hover group so the
 * right blank between the card and the preview frame edge keeps the panel open.
 */
export function MarkdownPreviewToc({
  activeHeadingId,
  headings,
  labels,
  maxHeightPx,
  onSelect,
}: {
  activeHeadingId: string | null;
  headings: readonly MarkdownHeadingSummary[];
  labels: {
    title: string;
  };
  maxHeightPx: number;
  onSelect: (headingId: string) => void;
}) {
  const ticksRef = useRef<HTMLElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const listRoRef = useRef<ResizeObserver | null>(null);
  const [listHeightPx, setListHeightPx] = useState(0);

  const listRef = useCallback((node: HTMLUListElement | null) => {
    listRoRef.current?.disconnect();
    listRoRef.current = null;
    if (!node) {
      setListHeightPx(0);
      return;
    }
    const update = () => {
      setListHeightPx(node.scrollHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    listRoRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      listRoRef.current?.disconnect();
      listRoRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!activeHeadingId) return;
    const panelViewport = panelScrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    for (const root of [ticksRef.current, panelViewport]) {
      if (!root) continue;
      const active = Array.from(
        root.querySelectorAll<HTMLElement>("[data-heading-id]")
      ).find((element) => element.dataset.headingId === activeHeadingId);
      if (active && typeof active.scrollIntoView === "function") {
        active.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [activeHeadingId]);

  if (headings.length === 0) {
    return null;
  }

  // Radix ScrollArea viewport is size-full; the root needs a definite height
  // or long lists clip without scrolling. Hug content when short; cap at max.
  const scrollAreaHeightPx =
    maxHeightPx > 0
      ? Math.min(
          maxHeightPx,
          listHeightPx > 0
            ? listHeightPx + MARKDOWN_TOC_PANEL_Y_PAD_PX
            : maxHeightPx
        )
      : undefined;

  const panelMaxHeightStyle: CSSProperties | undefined =
    maxHeightPx > 0
      ? {
          maxHeight: maxHeightPx,
          ["--markdown-toc-panel-max-h" as string]: `${maxHeightPx}px`,
        }
      : undefined;

  const frameStyle: CSSProperties = {
    paddingRight: MARKDOWN_TOC_EDGE_INSET_PX,
    ...panelMaxHeightStyle,
  };

  return (
    <div
      className="group/toc relative z-20 flex w-full max-w-full flex-col items-end"
      data-placement="overlay"
      data-side="right"
      data-slot="markdown-preview-toc"
      style={frameStyle}
    >
      {/*
        Hover bridge for the trailing edge blank. Parent rail is
        pointer-events-none; this strip re-enables hit testing so the right
        margin stays inside group-hover. Height matches the max panel so
        leaving a tall card into the blank does not dismiss it.
      */}
      <div
        aria-hidden
        className="pointer-events-auto absolute top-1/2 right-0 z-10 -translate-y-1/2"
        data-slot="markdown-preview-toc-edge-bridge"
        style={{
          width: MARKDOWN_TOC_EDGE_INSET_PX,
          height: maxHeightPx > 0 ? maxHeightPx : "100%",
        }}
      />

      <nav
        aria-label={labels.title}
        className={cn(
          "pointer-events-auto flex flex-col overflow-y-auto overscroll-contain transition-opacity duration-150",
          "group-hover/toc:opacity-0",
          "group-focus-within/toc:opacity-0",
          maxHeightPx > 0 && "max-h-[var(--markdown-toc-panel-max-h)]"
        )}
        data-scrollbar="none"
        ref={ticksRef}
        style={{ gap: MARKDOWN_TOC_TICK_GAP_PX }}
      >
        {headings.map((heading) => {
          const active = heading.id === activeHeadingId;
          const widthPx = markdownTocTickWidthPx(heading.depth);
          return (
            <button
              aria-current={active ? "true" : undefined}
              aria-label={heading.text}
              className={cn(
                "flex shrink-0 items-center justify-end py-0.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              )}
              data-heading-id={heading.id}
              key={heading.id}
              onClick={() => onSelect(heading.id)}
              type="button"
            >
              <span
                aria-hidden
                className={cn(
                  "block rounded-full transition-colors",
                  active
                    ? "bg-foreground"
                    : "bg-muted-foreground/35 hover:bg-muted-foreground/55"
                )}
                style={{
                  width: widthPx,
                  height: MARKDOWN_TOC_TICK_HEIGHT_PX,
                }}
              />
            </button>
          );
        })}
      </nav>

      <aside
        className={cn(
          // right inset matches trailing edge bridge so the card sits left of the blank
          "pointer-events-none absolute top-1/2 left-0 z-30 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm",
          "invisible opacity-0 transition-[opacity,visibility] duration-150",
          "group-hover/toc:pointer-events-auto group-hover/toc:visible group-hover/toc:opacity-100",
          "group-focus-within/toc:pointer-events-auto group-focus-within/toc:visible group-focus-within/toc:opacity-100"
        )}
        style={{
          right: MARKDOWN_TOC_EDGE_INSET_PX,
          ...panelMaxHeightStyle,
        }}
      >
        {/*
          Floating outline list:
          - ScrollArea viewportFade (short) = scroll-fade edges
          - Scrollbars fully hidden (ephemeral rail; wheel/trackpad still scrolls)
          - Root height = min(list, maxHeight) so size-full viewport can scroll
            when the outline exceeds the frame budget
        */}
        <div className="min-h-0 w-full min-w-0" ref={panelScrollRef}>
          <ScrollArea
            className={cn(
              "min-h-0 w-full min-w-0",
              // Hide Radix thumbs; fade + wheel/trackpad are enough for this panel.
              "[&_[data-slot=scroll-area-scrollbar]]:hidden"
            )}
            style={
              scrollAreaHeightPx == null
                ? undefined
                : { height: scrollAreaHeightPx }
            }
            type="hover"
            viewportClassName="py-1"
            viewportFade="vertical"
            viewportFadeProfile="short"
          >
            <nav aria-label={labels.title}>
              <ul className="flex flex-col gap-0.5 px-1" ref={listRef}>
                {headings.map((heading) => {
                  const active = heading.id === activeHeadingId;
                  return (
                    <li key={heading.id}>
                      <Button
                        className={cn(
                          // Override Button defaults (whitespace-nowrap, fixed height)
                          // so long headings wrap fully inside the panel width.
                          "h-auto min-h-0 w-full items-start justify-start whitespace-normal px-2 py-1 text-left font-normal text-xs leading-4",
                          active
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground"
                        )}
                        data-heading-id={heading.id}
                        onClick={() => onSelect(heading.id)}
                        style={{
                          paddingLeft: `${0.5 + (heading.depth - 1) * 0.45}rem`,
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <span className="min-w-0 flex-1 whitespace-normal break-words text-left">
                          {heading.text}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </ScrollArea>
        </div>
      </aside>
    </div>
  );
}

/**
 * Tracks the heading nearest the scrollport focus band. Re-queries the DOM on
 * every update so lazily mounted markdown pages stay in sync.
 */
export function useMarkdownHeadingScrollSpy(
  root: HTMLElement | null,
  headingIds: readonly string[]
): string | null {
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!(root && headingIds.length > 0)) {
      setActiveHeadingId(null);
      return;
    }

    let frame = 0;
    const updateActive = () => {
      // Lazy pagination mounts pages on demand — never cache element nodes.
      const elements = headingIds
        .map((id) => root.querySelector<HTMLElement>(`#${CSS.escape(id)}`))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      // Focus band shared with preview ↔ source content anchors.
      const focusY = markdownViewportFocusY(rootRect);
      let bestId: string | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const element of elements) {
        const delta = focusY - element.getBoundingClientRect().top;
        if (delta >= -8 && delta < bestDelta) {
          bestDelta = delta;
          bestId = element.id;
        }
      }
      if (!bestId) {
        // Still above the first mounted heading.
        bestId = elements[0]?.id ?? null;
      }
      setActiveHeadingId((current) => (current === bestId ? current : bestId));
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };

    scheduleUpdate();
    root.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleUpdate);
    mutationObserver?.observe(root, {
      childList: true,
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      mutationObserver?.disconnect();
    };
  }, [headingIds, root]);

  return activeHeadingId;
}

export function selectMarkdownProseContents(root: HTMLElement | null): boolean {
  if (!root) return false;
  const prose = root.querySelector<HTMLElement>('[data-slot="markdown-prose"]');
  if (!prose) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(prose);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
