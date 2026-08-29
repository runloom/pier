import { withProgrammaticTabStripScroll } from "./tab-strip-scroll.ts";

const REVEAL_PADDING_PX = 8;
/** Wait for React header commit + first layout; no nested rAF. */
const REVEAL_SETTLE_TIMEOUT_MS = 120;
let dockviewTabRevealRoot: ParentNode | null = null;
let cancelScheduledReveal: (() => void) | null = null;

export function setDockviewTabRevealRoot(root: ParentNode | null): void {
  dockviewTabRevealRoot = root;
}

/** Abort a pending settle (user scroll wins; K3). */
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

function tabElementIsLaidOut(tabElement: HTMLElement): boolean {
  return tabElement.getBoundingClientRect().width > 0;
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
    if (contentElement.dataset.panelTabId !== panelId) {
      continue;
    }
    const tabElement = contentElement.closest<HTMLElement>(".dv-tab");
    if (!(tabElement && tabElementIsLaidOut(tabElement))) {
      return false;
    }
    revealDockviewTabElement(contentElement);
    return true;
  }
  return false;
}

function tabElementForPanelId(
  panelId: string,
  root: ParentNode
): HTMLElement | null {
  for (const contentElement of root.querySelectorAll<HTMLElement>(
    "[data-panel-tab-id]"
  )) {
    if (contentElement.dataset.panelTabId !== panelId) {
      continue;
    }
    return contentElement.closest<HTMLElement>(".dv-tab");
  }
  return null;
}

/** Host/document size does not change when a tab goes 0→N; watch the tab. */
function observeTargetsForReveal(panelId: string, root: ParentNode): Element[] {
  const tab = tabElementForPanelId(panelId, root);
  if (tab) {
    const container = tab.closest(".dv-tabs-container");
    return container ? [tab, container] : [tab];
  }
  return [...root.querySelectorAll(".dv-tabs-container")];
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

  let cancelled = false;
  let frame = 0;
  let timeoutId: ReturnType<typeof setTimeout> | 0 = 0;
  let observer: ResizeObserver | null = null;

  const dispose = (): void => {
    if (frame !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (timeoutId !== 0) {
      clearTimeout(timeoutId);
      timeoutId = 0;
    }
    observer?.disconnect();
    observer = null;
    if (cancelScheduledReveal === abort) {
      cancelScheduledReveal = null;
    }
  };

  const abort = (): void => {
    cancelled = true;
    dispose();
  };

  const revealed = (): boolean => {
    if (cancelled) {
      return true;
    }
    if (revealDockviewTabByPanelId(panelId, targetRoot)) {
      abort();
      return true;
    }
    return false;
  };

  cancelScheduledReveal = abort;

  if (revealed()) {
    return;
  }

  const watchUntilTimeout = (): void => {
    if (cancelled) {
      return;
    }
    if (typeof ResizeObserver !== "undefined") {
      const targets = observeTargetsForReveal(panelId, targetRoot);
      if (targets.length > 0) {
        observer = new ResizeObserver(() => {
          revealed();
        });
        for (const target of targets) {
          observer.observe(target);
        }
      }
    }
    timeoutId = setTimeout(() => {
      if (cancelled) {
        return;
      }
      revealDockviewTabByPanelId(panelId, targetRoot);
      abort();
    }, REVEAL_SETTLE_TIMEOUT_MS);
  };

  if (typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (revealed()) {
        return;
      }
      watchUntilTimeout();
    });
    return;
  }
  watchUntilTimeout();
}
