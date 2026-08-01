const USER_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

/** 连续 wheel/触控只通知宿主一次，避免每帧 setState/清导航拖垮滚动。 */
const USER_SCROLL_INTENT_GESTURE_MS = 160;

function isHtmlElement(
  value: EventTarget | null | undefined
): value is HTMLElement {
  return value instanceof HTMLElement;
}

function composedHtmlPath(event: Event): HTMLElement[] {
  return event.composedPath().filter(isHtmlElement);
}

function findHeaderFromPath(path: readonly HTMLElement[]): HTMLElement | null {
  return path.find((node) => node.hasAttribute("data-diffs-header")) ?? null;
}

function findTitleFromPath(path: readonly HTMLElement[]): HTMLElement | null {
  return path.find((node) => node.hasAttribute("data-title")) ?? null;
}

function isInteractiveControlTarget(path: readonly HTMLElement[]): boolean {
  return path.some((node) => {
    const tag = node.tagName;
    return (
      tag === "BUTTON" ||
      tag === "A" ||
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      tag === "LABEL" ||
      node.isContentEditable ||
      node.getAttribute("role") === "button"
    );
  });
}

/** Clicks on real controls must not also toggle collapse / open file. */
function isHeaderControlTarget(path: readonly HTMLElement[]): boolean {
  for (const node of path) {
    if (node.hasAttribute("data-diffs-header")) {
      break;
    }
    if (
      node.hasAttribute("data-slot") &&
      node.getAttribute("data-slot") === "pier-diff-header-actions"
    ) {
      return true;
    }
    if (isInteractiveControlTarget([node])) {
      return true;
    }
  }
  return false;
}

function findRenderedItemIdFromPath(
  path: readonly EventTarget[],
  rendered: readonly { readonly element: Element; readonly id: string }[]
): string | null {
  // composedPath already crosses open shadow trees and includes the host
  // element — match hosts without reading shadow tree (governance).
  const hostIds = new Map(
    rendered.map((item) => [item.element, item.id] as const)
  );
  for (const node of path) {
    if (node instanceof Element) {
      const id = hostIds.get(node);
      if (id !== undefined) {
        return id;
      }
    }
  }
  return null;
}

export {
  composedHtmlPath,
  findHeaderFromPath,
  findRenderedItemIdFromPath,
  findTitleFromPath,
  isHeaderControlTarget,
  isInteractiveControlTarget,
  USER_SCROLL_INTENT_GESTURE_MS,
  USER_SCROLL_KEYS,
};
