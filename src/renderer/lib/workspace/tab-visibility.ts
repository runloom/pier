import { withProgrammaticTabStripScroll } from "./tab-strip-scroll.ts";

const REVEAL_PADDING_PX = 8;
let dockviewTabRevealRoot: ParentNode | null = null;
let cancelScheduledReveal: (() => void) | null = null;

export function setDockviewTabRevealRoot(root: ParentNode | null): void {
  dockviewTabRevealRoot = root;
}

/** Abort a pending rAF reveal (user scroll wins; K3). */
export function abortScheduledDockviewTabReveal(): void {
  cancelScheduledReveal?.();
  cancelScheduledReveal = null;
}

export function revealElementWithinScrollContainer(
  container: HTMLElement,
  element: HTMLElement,
  padding = REVEAL_PADDING_PX
): void {
  withProgrammaticTabStripScroll(() => {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const leftDelta = elementRect.left - containerRect.left;
    const rightDelta = elementRect.right - containerRect.right;

    if (leftDelta < padding) {
      container.scrollLeft = Math.max(
        0,
        container.scrollLeft + leftDelta - padding
      );
    } else if (rightDelta > -padding) {
      container.scrollLeft += rightDelta + padding;
    }

    const topDelta = elementRect.top - containerRect.top;
    const bottomDelta = elementRect.bottom - containerRect.bottom;

    if (topDelta < 0) {
      container.scrollTop = Math.max(
        0,
        container.scrollTop + topDelta - padding
      );
    } else if (bottomDelta > 0) {
      container.scrollTop += bottomDelta + padding;
    }
  });
}

export function revealDockviewTabElement(tabContentElement: HTMLElement): void {
  const tabElement = tabContentElement.closest<HTMLElement>(".dv-tab");
  if (!tabElement) {
    return;
  }

  const tabsContainer = tabElement.closest<HTMLElement>(".dv-tabs-container");
  if (!tabsContainer) {
    return;
  }

  revealElementWithinScrollContainer(tabsContainer, tabElement);
}

export function revealDockviewTabByPanelId(
  panelId: string,
  root: ParentNode
): boolean {
  for (const contentElement of root.querySelectorAll<HTMLElement>(
    "[data-panel-tab-id]"
  )) {
    if (contentElement.dataset.panelTabId === panelId) {
      revealDockviewTabElement(contentElement);
      return true;
    }
  }
  return false;
}

export function scheduleRevealDockviewTabByPanelId(
  panelId: string,
  root?: ParentNode
): void {
  const targetRoot = root ?? dockviewTabRevealRoot;
  if (!targetRoot) {
    return;
  }
  abortScheduledDockviewTabReveal();
  if (typeof requestAnimationFrame === "function") {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }
      cancelScheduledReveal = null;
      revealDockviewTabByPanelId(panelId, targetRoot);
    });
    cancelScheduledReveal = () => {
      cancelled = true;
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
    };
    return;
  }
  revealDockviewTabByPanelId(panelId, targetRoot);
}
