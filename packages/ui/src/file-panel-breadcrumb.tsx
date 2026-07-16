import { ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, type WheelEvent } from "react";
import { Button } from "./button.tsx";
import { cn } from "./utils.ts";

export function FilePanelBreadcrumb({
  ariaLabel,
  onSegmentClick,
  segments,
}: {
  ariaLabel: string;
  onSegmentClick?: (index: number) => void;
  segments: readonly string[];
}) {
  const breadcrumbRef = useRef<HTMLElement | null>(null);
  const previousSegmentsRef = useRef<readonly string[]>([]);
  useLayoutEffect(() => {
    const previousSegments = previousSegmentsRef.current;
    let segmentsChanged = previousSegments.length !== segments.length;
    for (
      let index = 0;
      !segmentsChanged && index < segments.length;
      index += 1
    ) {
      segmentsChanged = previousSegments[index] !== segments[index];
    }
    previousSegmentsRef.current = segments;
    const breadcrumb = breadcrumbRef.current;
    if (segmentsChanged && breadcrumb) {
      breadcrumb.scrollLeft = breadcrumb.scrollWidth;
    }
  });
  useLayoutEffect(() => {
    const breadcrumb = breadcrumbRef.current;
    if (!breadcrumb || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      breadcrumb.scrollLeft = breadcrumb.scrollWidth;
    });
    observer.observe(breadcrumb);
    return () => observer.disconnect();
  }, []);

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }
    const breadcrumb = event.currentTarget;
    const previousScrollLeft = breadcrumb.scrollLeft;
    breadcrumb.scrollLeft += event.deltaY;
    if (breadcrumb.scrollLeft !== previousScrollLeft) {
      event.preventDefault();
    }
  };

  if (segments.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const last = segments.length - 1;
  return (
    <nav
      aria-label={ariaLabel}
      className="flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden font-mono text-xs"
      data-scrollbar="none"
      onWheel={handleWheel}
      ref={breadcrumbRef}
    >
      <ol className="flex min-w-0 flex-1 items-center">
        {segments.map((segment, index) => {
          const isLast = index === last;
          const key = String(index).concat(":", segment);
          if (onSegmentClick) {
            return (
              <li
                className="flex min-w-0 max-w-[80%] shrink-0 items-center"
                key={key}
              >
                {index > 0 ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="mx-0.5 size-3 shrink-0 text-muted-foreground/60"
                  />
                ) : null}
                <Button
                  aria-current={isLast ? "page" : undefined}
                  className="min-w-0 max-w-full shrink truncate px-1"
                  onClick={() => onSegmentClick(index)}
                  size="xs"
                  title={segment}
                  type="button"
                  variant="ghost"
                >
                  {segment}
                </Button>
              </li>
            );
          }
          return (
            <li
              className="flex min-w-0 max-w-[80%] shrink-0 items-center"
              key={key}
            >
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="mx-0.5 size-3 shrink-0 text-muted-foreground/60"
                />
              ) : null}
              <span
                aria-current={isLast ? "page" : undefined}
                className={cn(
                  "min-w-0 max-w-full shrink truncate",
                  isLast
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                )}
                title={segment}
              >
                {segment}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
