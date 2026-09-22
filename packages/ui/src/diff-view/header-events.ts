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

/** Partial hunks render the unmodified row without Pierre's expand buttons. */
function findPartialCollapsedSeparatorItemId(
  path: readonly EventTarget[],
  rendered: readonly { readonly element: Element; readonly id: string }[]
): string | null {
  const separator = path.find(
    (node): node is HTMLElement =>
      isHtmlElement(node) && node.hasAttribute("data-separator")
  );
  if (separator === undefined) {
    return null;
  }
  const kind = separator.getAttribute("data-separator");
  if (kind !== "line-info" && kind !== "line-info-basic") {
    return null;
  }
  if (separator.hasAttribute("data-expand-index")) {
    return null;
  }
  return findRenderedItemIdFromPath(path, rendered);
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

function expandPendingPartialDiffs(
  pending: Set<string>,
  rendered: readonly {
    readonly id: string;
    readonly instance: object;
    readonly item: object;
    readonly type: string;
  }[]
): void {
  if (pending.size === 0) {
    return;
  }
  for (const item of rendered) {
    const fileDiff = partialFileDiff(item);
    const expandHunk = expandHunkOf(item.instance);
    if (
      item.type !== "diff" ||
      !pending.has(item.id) ||
      fileDiff === null ||
      fileDiff.isPartial ||
      expandHunk === null
    ) {
      continue;
    }
    for (let index = 0; index <= fileDiff.hunks.length; index += 1) {
      expandHunk(index, "both", Number.MAX_SAFE_INTEGER);
    }
    pending.delete(item.id);
  }
}

function partialFileDiff(item: object): {
  readonly hunks: readonly unknown[];
  readonly isPartial: boolean;
} | null {
  if (!("fileDiff" in item)) {
    return null;
  }
  const { fileDiff } = item;
  if (typeof fileDiff !== "object" || fileDiff === null) {
    return null;
  }
  if (
    !("isPartial" in fileDiff && "hunks" in fileDiff) ||
    typeof fileDiff.isPartial !== "boolean" ||
    !Array.isArray(fileDiff.hunks)
  ) {
    return null;
  }
  return { hunks: fileDiff.hunks, isPartial: fileDiff.isPartial };
}

function expandHunkOf(
  instance: object
): ((index: number, direction: "both", count: number) => void) | null {
  if (
    !("expandHunk" in instance) ||
    typeof instance.expandHunk !== "function"
  ) {
    return null;
  }
  return instance.expandHunk.bind(instance);
}

function beginPartialDiffSideRequest(
  pending: Set<string>,
  itemId: string,
  request: (
    itemId: string
  ) => Promise<"accepted" | "failed"> | "accepted" | "failed"
): void {
  pending.add(itemId);
  Promise.resolve(request(itemId))
    .then((outcome) => {
      if (outcome === "failed") {
        pending.delete(itemId);
      }
    })
    .catch(() => {
      pending.delete(itemId);
    });
}

export {
  beginPartialDiffSideRequest,
  composedHtmlPath,
  expandPendingPartialDiffs,
  findHeaderFromPath,
  findPartialCollapsedSeparatorItemId,
  findRenderedItemIdFromPath,
  findTitleFromPath,
  isHeaderControlTarget,
  isInteractiveControlTarget,
  USER_SCROLL_INTENT_GESTURE_MS,
  USER_SCROLL_KEYS,
};
