import { type RefObject, useLayoutEffect, useRef } from "react";

interface CommandPaletteScrollOptions {
  isOpen: boolean;
  query: string;
  requestId: number;
  selectedValue: string;
}

export function useCommandPaletteScroll({
  isOpen,
  query,
  requestId,
  selectedValue,
}: CommandPaletteScrollOptions): RefObject<HTMLDivElement | null> {
  const listRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Query and session changes must reset the reused list.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!(isOpen && list)) {
      return;
    }
    list.scrollTop = 0;
  }, [isOpen, query, requestId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Query and session changes must reveal the committed selection.
  useLayoutEffect(() => {
    if (!(isOpen && selectedValue && listRef.current)) {
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen, query, requestId, selectedValue]);

  return listRef;
}
