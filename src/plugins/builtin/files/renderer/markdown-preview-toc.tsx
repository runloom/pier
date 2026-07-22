import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ListTree, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { MarkdownHeadingSummary } from "./markdown/markdown-ir.ts";
import type { MarkdownTocSide } from "./markdown-preview-preferences.ts";
import { useMarkdownPreviewPrefsStore } from "./markdown-preview-preferences.ts";
import {
  MARKDOWN_TOC_INSET_PX,
  MARKDOWN_TOC_RAIL_WIDTH_PX,
  type MarkdownTocPlacement,
} from "./markdown-preview-toc-layout.ts";

/**
 * One outline shell for dock + overlay. Placement only toggles sticky-in-flow
 * vs plain block inside the shared overlay rail; chrome/height/inset are shared.
 */
export function MarkdownPreviewToc({
  activeHeadingId,
  headings,
  labels,
  maxHeightPx,
  onSelect,
  placement,
  side,
}: {
  activeHeadingId: string | null;
  headings: readonly MarkdownHeadingSummary[];
  labels: {
    collapse: string;
    expand: string;
    title: string;
  };
  maxHeightPx: number;
  onSelect: (headingId: string) => void;
  placement: MarkdownTocPlacement;
  side: MarkdownTocSide;
}) {
  const tocCollapsed = useMarkdownPreviewPrefsStore(
    (state) => state.tocCollapsed
  );
  const setTocCollapsed = useMarkdownPreviewPrefsStore(
    (state) => state.setTocCollapsed
  );
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (tocCollapsed || !activeHeadingId || !navRef.current) return;
    const active = Array.from(
      navRef.current.querySelectorAll<HTMLElement>("[data-heading-id]")
    ).find((element) => element.dataset.headingId === activeHeadingId);
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeHeadingId, tocCollapsed]);

  if (headings.length === 0) {
    return null;
  }

  const docked = placement === "dock";
  const frameStyle: CSSProperties = {
    width: MARKDOWN_TOC_RAIL_WIDTH_PX,
    ...(maxHeightPx > 0 ? { maxHeight: maxHeightPx } : {}),
    ...(docked ? { top: MARKDOWN_TOC_INSET_PX } : {}),
  };
  const positionClass = docked ? "sticky shrink-0 self-start" : "relative";

  if (tocCollapsed) {
    return (
      <Button
        aria-label={labels.expand}
        className={cn(
          "z-20 shadow-sm",
          positionClass,
          // Keep the chip on the outer edge (matches expanded rail / zoom control).
          !docked && side === "right" && "self-end",
          !docked && side === "left" && "self-start"
        )}
        data-placement={placement}
        data-side={side}
        data-slot="markdown-preview-toc"
        onClick={() => setTocCollapsed(false)}
        size="icon-xs"
        style={docked ? { top: MARKDOWN_TOC_INSET_PX } : undefined}
        type="button"
        variant="outline"
      >
        <ListTree data-icon="inline-start" />
      </Button>
    );
  }

  return (
    <aside
      aria-label={labels.title}
      className={cn(
        "z-20 flex flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm",
        positionClass
      )}
      data-placement={placement}
      data-side={side}
      data-slot="markdown-preview-toc"
      style={frameStyle}
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-border/50 border-b px-2 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground">
          {labels.title}
        </span>
        <Button
          aria-label={labels.collapse}
          onClick={() => setTocCollapsed(true)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <X data-icon="inline-start" />
        </Button>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-auto py-1"
        data-scrollbar="none"
        ref={navRef}
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
  );
}

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
    const elements = headingIds
      .map((id) => root.querySelector<HTMLElement>(`#${CSS.escape(id)}`))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) {
      return;
    }

    let frame = 0;
    const updateActive = () => {
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
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
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
