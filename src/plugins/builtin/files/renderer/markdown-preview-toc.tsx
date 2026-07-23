import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { MarkdownHeadingSummary } from "./markdown/markdown-ir.ts";
import {
  MARKDOWN_TOC_TICK_GAP_PX,
  MARKDOWN_TOC_TICK_HEIGHT_PX,
  markdownTocTickWidthPx,
} from "./markdown-preview-toc-layout.ts";

/**
 * One outline shell: Notion-style tick rail by default; hover/focus-within
 * fades the title list over the ticks, vertically centered on the tick stack.
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
  const panelNavRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeHeadingId) return;
    for (const root of [ticksRef.current, panelNavRef.current]) {
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

  const frameStyle: CSSProperties = {
    ...(maxHeightPx > 0 ? { maxHeight: maxHeightPx } : {}),
  };

  return (
    <div
      className="group/toc relative z-20 flex w-full max-w-full flex-col items-end"
      data-placement="overlay"
      data-side="right"
      data-slot="markdown-preview-toc"
      style={frameStyle}
    >
      <nav
        aria-label={labels.title}
        className={cn(
          "pointer-events-auto flex max-h-full flex-col overflow-auto transition-opacity duration-150",
          "group-hover/toc:opacity-0",
          "group-focus-within/toc:opacity-0"
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
                "flex items-center justify-end py-0.5",
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
          "pointer-events-none absolute top-1/2 right-0 left-0 z-30 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm",
          "invisible opacity-0 transition-[opacity,visibility] duration-150",
          "group-hover/toc:pointer-events-auto group-hover/toc:visible group-hover/toc:opacity-100",
          "group-focus-within/toc:pointer-events-auto group-focus-within/toc:visible group-focus-within/toc:opacity-100"
        )}
        style={{
          ...(maxHeightPx > 0 ? { maxHeight: maxHeightPx } : {}),
        }}
      >
        <nav
          aria-label={labels.title}
          className="min-h-0 flex-1 overflow-auto py-1"
          data-scrollbar="none"
          ref={panelNavRef}
        >
          <ul className="flex flex-col gap-0.5 px-1">
            {headings.map((heading) => {
              const active = heading.id === activeHeadingId;
              return (
                <li key={heading.id}>
                  <Button
                    className={cn(
                      "h-auto w-full justify-start px-2 py-1 text-left font-normal text-[11px] leading-4",
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
                    <span className="line-clamp-2">{heading.text}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
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
      // Focus band near the upper quarter of the scrollport (docs-site style).
      const focusY = rootRect.top + Math.min(96, rootRect.height * 0.22);
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
