const SCROLLBAR_POLICY_SELECTOR =
  '[data-scrollbar]:not([data-scrollbar="none"]), [data-flat-scroll], .cv-scrollbar';

export const AUTO_HIDE_SCROLLBAR_IDLE_MS = 900;

const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

interface PointerPosition {
  clientX: number;
  clientY: number;
}

function clearHideTimer(element: HTMLElement): void {
  const timer = hideTimers.get(element);
  if (timer !== undefined) {
    clearTimeout(timer);
    hideTimers.delete(element);
  }
}

export function hideAutoScrollbar(element: HTMLElement): void {
  clearHideTimer(element);
  delete element.dataset.scrollbarScrolling;
}

export function hideAutoScrollbarHover(element: HTMLElement): void {
  delete element.dataset.scrollbarHovering;
}

export function showAutoScrollbar(element: HTMLElement): void {
  clearHideTimer(element);
  element.dataset.scrollbarScrolling = "true";
  hideTimers.set(
    element,
    setTimeout(() => {
      hideTimers.delete(element);
      delete element.dataset.scrollbarScrolling;
    }, AUTO_HIDE_SCROLLBAR_IDLE_MS)
  );
}

function cssScrollbarWidth(style: CSSStyleDeclaration): number {
  const value = style.getPropertyValue("--shell-scrollbar-width-legacy");
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pointerHitsScrollbar(
  element: HTMLElement,
  pointer: PointerPosition
): boolean {
  const rect = element.getBoundingClientRect();
  const computedStyle = getComputedStyle(element);
  const fallbackWidth = cssScrollbarWidth(computedStyle);
  const verticalGutter = Math.max(
    element.offsetWidth - element.clientWidth,
    fallbackWidth
  );
  const horizontalGutter = Math.max(
    element.offsetHeight - element.clientHeight,
    fallbackWidth
  );
  const hasVerticalScrollbar = element.scrollHeight > element.clientHeight;
  const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth;
  const verticalStart =
    computedStyle.direction === "rtl" ? rect.left : rect.right - verticalGutter;
  const verticalEnd =
    computedStyle.direction === "rtl" ? rect.left + verticalGutter : rect.right;
  const hitsVertical =
    hasVerticalScrollbar &&
    pointer.clientX >= verticalStart &&
    pointer.clientX <= verticalEnd &&
    pointer.clientY >= rect.top &&
    pointer.clientY <= rect.bottom;
  const hitsHorizontal =
    hasHorizontalScrollbar &&
    pointer.clientY >= rect.bottom - horizontalGutter &&
    pointer.clientY <= rect.bottom &&
    pointer.clientX >= rect.left &&
    pointer.clientX <= rect.right;
  return hitsVertical || hitsHorizontal;
}

export function updateAutoScrollbarHover(
  element: HTMLElement,
  pointer: PointerPosition
): void {
  if (pointerHitsScrollbar(element, pointer)) {
    element.dataset.scrollbarHovering = "true";
  } else {
    hideAutoScrollbarHover(element);
  }
}

function scrollbarTarget(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (
      target instanceof HTMLElement &&
      target.matches(SCROLLBAR_POLICY_SELECTOR)
    ) {
      return target;
    }
  }
  return null;
}

export function installAutoHideScrollbar(element: HTMLElement): () => void {
  const reveal = () => {
    showAutoScrollbar(element);
  };
  const updateHover = (event: PointerEvent) => {
    updateAutoScrollbarHover(element, event);
  };
  const clearHover = () => {
    hideAutoScrollbarHover(element);
  };
  element.addEventListener("scroll", reveal, { passive: true });
  element.addEventListener("wheel", reveal, { passive: true });
  element.addEventListener("touchmove", reveal, { passive: true });
  element.addEventListener("pointermove", updateHover, { passive: true });
  element.addEventListener("pointerleave", clearHover, { passive: true });

  return () => {
    element.removeEventListener("scroll", reveal);
    element.removeEventListener("wheel", reveal);
    element.removeEventListener("touchmove", reveal);
    element.removeEventListener("pointermove", updateHover);
    element.removeEventListener("pointerleave", clearHover);
    hideAutoScrollbar(element);
    hideAutoScrollbarHover(element);
  };
}

export function installDocumentAutoHideScrollbars(
  root: Document = document
): () => void {
  let hoveredElement: HTMLElement | null = null;
  const reveal = (event: Event) => {
    const element = scrollbarTarget(event);
    if (!element) {
      return;
    }
    showAutoScrollbar(element);
  };
  const updateHover = (event: PointerEvent) => {
    const element = scrollbarTarget(event);
    if (hoveredElement && hoveredElement !== element) {
      hideAutoScrollbarHover(hoveredElement);
    }
    if (!element) {
      hoveredElement = null;
      return;
    }
    updateAutoScrollbarHover(element, event);
    hoveredElement = element.dataset.scrollbarHovering ? element : null;
  };
  const clearHover = () => {
    if (hoveredElement) {
      hideAutoScrollbarHover(hoveredElement);
      hoveredElement = null;
    }
  };
  root.addEventListener("scroll", reveal, { capture: true, passive: true });
  root.addEventListener("wheel", reveal, { capture: true, passive: true });
  root.addEventListener("touchmove", reveal, {
    capture: true,
    passive: true,
  });
  root.addEventListener("pointermove", updateHover, {
    capture: true,
    passive: true,
  });
  root.addEventListener("pointerleave", clearHover, {
    capture: true,
    passive: true,
  });
  root.defaultView?.addEventListener("blur", clearHover);

  return () => {
    root.removeEventListener("scroll", reveal, true);
    root.removeEventListener("wheel", reveal, true);
    root.removeEventListener("touchmove", reveal, true);
    root.removeEventListener("pointermove", updateHover, true);
    root.removeEventListener("pointerleave", clearHover, true);
    root.defaultView?.removeEventListener("blur", clearHover);
    clearHover();
  };
}
