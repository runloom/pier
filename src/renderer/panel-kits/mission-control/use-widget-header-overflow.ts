import { useCallback, useLayoutEffect, useState } from "react";

const TITLE_AND_CHROME_RESERVE = 124;
const FALLBACK_ACTION_WIDTH = 24;
const FALLBACK_GAP = 4;

export function fitWidgetHeaderActionWidths(
  headerWidth: number,
  actionWidths: readonly number[],
  moreWidth: number,
  gap: number
): number {
  if (actionWidths.length === 0) return 0;
  const available = Math.max(0, headerWidth - TITLE_AND_CHROME_RESERVE);
  const allWidth = actionWidths.reduce(
    (total, width, index) => total + width + (index === 0 ? 0 : gap),
    0
  );
  if (allWidth <= available) return actionWidths.length;

  const directBudget = Math.max(0, available - moreWidth - gap);
  let used = 0;
  let count = 0;
  for (const width of actionWidths) {
    const next = used + (count === 0 ? 0 : gap) + width;
    if (next > directBudget) break;
    used = next;
    count += 1;
  }
  return count;
}

export function useWidgetHeaderOverflow(
  actionCount: number,
  frozen: boolean
): [(node: HTMLDivElement | null) => void, number, boolean] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [measured, setMeasured] = useState(false);

  const measure = useCallback(() => {
    if (!(node && !frozen)) return;
    const header = node.closest<HTMLElement>("[data-slot=card-header]");
    const measuredActions = Array.from(
      node.querySelectorAll<HTMLElement>("[data-measure-action]")
    );
    const more = node.querySelector<HTMLElement>("[data-measure-more]");
    const styles = getComputedStyle(node);
    const gap =
      Number.parseFloat(styles.columnGap || styles.gap) || FALLBACK_GAP;
    const widths = Array.from({ length: actionCount }, (_, index) =>
      Math.ceil(
        measuredActions[index]?.getBoundingClientRect().width ||
          FALLBACK_ACTION_WIDTH
      )
    );
    const next = fitWidgetHeaderActionWidths(
      header?.clientWidth ?? node.clientWidth,
      widths,
      Math.ceil(more?.getBoundingClientRect().width || FALLBACK_ACTION_WIDTH),
      gap
    );
    setVisibleCount((current) => (current === next ? current : next));
    setMeasured(true);
  }, [actionCount, frozen, node]);

  useLayoutEffect(() => {
    if (!node) return;
    let frame: number | null = null;
    const schedule = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    schedule();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(
      node.closest<HTMLElement>("[data-slot=card-header]") ?? node
    );
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [measure, node]);

  return [setNode, visibleCount, measured];
}
