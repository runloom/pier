import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  fitTerminalStatusOverflow,
  overflowPriorityForStatusItem,
  type TerminalStatusOverflowPolicy,
} from "./terminal-status-bar-overflow.ts";

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export interface UseTerminalStatusBarOverflowOptions {
  /**
   * 贡献声明中的溢出策略（priority / pinned）。
   * 测量时按 id 查找；未声明项 priority 默认 25。
   */
  overflowById: ReadonlyMap<string, TerminalStatusOverflowPolicy>;
  pinnedIds: ReadonlySet<string>;
}

/**
 * 金标准溢出：测底栏可用宽，按 priority 整项 hidden。
 * 测量时临时取消 hidden 并 flex-shrink:0，读取自然宽。
 * width===0 的空壳一并 hidden，避免仍占 flex gap。
 */
export function useTerminalStatusBarOverflow(
  enabled: boolean,
  options: UseTerminalStatusBarOverflowOptions
): {
  hiddenIds: ReadonlySet<string>;
  rootRef: (node: HTMLDivElement | null) => void;
} {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const measuringRef = useRef(false);
  const { overflowById, pinnedIds } = options;
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  const measure = useCallback(() => {
    const root = nodeRef.current;
    if (!root || measuringRef.current) {
      return;
    }
    measuringRef.current = true;
    try {
      const style = getComputedStyle(root);
      const paddingX =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
      const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
      const availableWidth = Math.max(0, root.clientWidth - paddingX);
      const slots = [
        ...root.querySelectorAll<HTMLElement>("[data-overflow-slot]"),
      ].map((element) => {
        const id = element.dataset.overflowSlot ?? "";
        const wasHidden = element.hasAttribute("hidden");
        const prevShrink = element.style.flexShrink;
        element.hidden = false;
        element.style.flexShrink = "0";
        const width = Math.ceil(element.getBoundingClientRect().width);
        element.style.flexShrink = prevShrink;
        element.hidden = wasHidden;
        return {
          id,
          priority: overflowPriorityForStatusItem(id, overflowById),
          width,
        };
      });

      const nextHidden = fitTerminalStatusOverflow({
        availableWidth,
        gap,
        hasFlexSpacer: true,
        pinnedIds,
        slots: slots.filter((slot) => slot.id.length > 0),
      });
      setHiddenIds((current) =>
        sameIds(current, nextHidden) ? current : nextHidden
      );
    } finally {
      measuringRef.current = false;
    }
  }, [overflowById, pinnedIds]);

  const rootRef = useCallback(
    (node: HTMLDivElement | null) => {
      nodeRef.current = node;
      if (node && enabled) {
        measure();
      }
    },
    [enabled, measure]
  );

  useLayoutEffect(() => {
    if (!(enabled && nodeRef.current)) {
      setHiddenIds((current) => (current.length === 0 ? current : []));
      return;
    }
    let frame: number | null = null;
    const schedule = (): void => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    schedule();
    const root = nodeRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(root);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    mutationObserver?.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [enabled, measure]);

  return {
    hiddenIds: new Set(hiddenIds),
    rootRef,
  };
}
