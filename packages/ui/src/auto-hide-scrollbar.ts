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

function overflowAllowsScroll(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "overlay";
}

/** 可滚动容器：非 none，且 overflow 允许滚动。 */
export function isAutoHideScrollContainer(element: HTMLElement): boolean {
  if (element.closest('[data-scrollbar="none"]')) {
    return false;
  }
  const style = getComputedStyle(element);
  return (
    overflowAllowsScroll(style.overflowX) ||
    overflowAllowsScroll(style.overflowY)
  );
}

function pointerHitsScrollbar(
  element: HTMLElement,
  pointer: PointerPosition
): boolean {
  const rect = element.getBoundingClientRect();
  const computedStyle = getComputedStyle(element);
  const bar = cssScrollbarWidth(computedStyle);
  if (bar <= 0) {
    return false;
  }

  const canScrollY = element.scrollHeight > element.clientHeight + 1;
  const canScrollX = element.scrollWidth > element.clientWidth + 1;
  const inY =
    canScrollY &&
    pointer.clientX >= rect.right - bar &&
    pointer.clientX <= rect.right &&
    pointer.clientY >= rect.top &&
    pointer.clientY <= rect.bottom;
  const inX =
    canScrollX &&
    pointer.clientY >= rect.bottom - bar &&
    pointer.clientY <= rect.bottom &&
    pointer.clientX >= rect.left &&
    pointer.clientX <= rect.right;
  return inY || inX;
}

export function updateAutoScrollbarHover(
  element: HTMLElement,
  pointer: PointerPosition
): void {
  if (pointerHitsScrollbar(element, pointer)) {
    element.dataset.scrollbarHovering = "true";
    return;
  }
  hideAutoScrollbarHover(element);
}

function scrollbarTarget(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) {
      continue;
    }
    if (isAutoHideScrollContainer(target)) {
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
