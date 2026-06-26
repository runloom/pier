const REVEAL_PADDING_PX = 8;
let dockviewTabRevealRoot: ParentNode | null = null;

export function setDockviewTabRevealRoot(root: ParentNode | null): void {
  dockviewTabRevealRoot = root;
}

export function revealElementWithinScrollContainer(
  container: HTMLElement,
  element: HTMLElement,
  padding = REVEAL_PADDING_PX
): void {
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
    container.scrollTop = Math.max(0, container.scrollTop + topDelta - padding);
  } else if (bottomDelta > 0) {
    container.scrollTop += bottomDelta + padding;
  }
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
  const reveal = () => {
    revealDockviewTabByPanelId(panelId, targetRoot);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(reveal);
    return;
  }
  reveal();
}
