import type {
  PierFileTreeScrollRestoreOptions,
  PierFileTreeScrollSnapshot,
} from "./file-tree-types.ts";

export const FILE_TREE_HOST_SELECTOR =
  'file-tree-container[data-slot="pier-file-tree"]';
const FILE_TREE_ROW_SELECTOR = '[role="treeitem"][data-item-path]';
const FILE_TREE_SCROLL_SELECTORS = [
  '[data-file-tree-virtualized-scroll="true"]',
  '[role="tree"]',
] as const;

export function getAnimationFrameScheduler() {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) =>
        globalThis.setTimeout(
          () => callback(globalThis.performance?.now() ?? Date.now()),
          16
        );
}

export function fileTreeHost(
  container: HTMLElement | null
): HTMLElement | null {
  return container?.querySelector<HTMLElement>(FILE_TREE_HOST_SELECTOR) ?? null;
}

export function fileTreeScrollElement(
  host: HTMLElement | null
): HTMLElement | null {
  const shadowRoot = host?.shadowRoot;
  if (!shadowRoot) {
    return null;
  }

  for (const selector of FILE_TREE_SCROLL_SELECTORS) {
    const element = shadowRoot.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function fileTreeRows(host: HTMLElement | null): HTMLElement[] {
  const shadowRoot = host?.shadowRoot;
  if (!shadowRoot) {
    return [];
  }

  return [...shadowRoot.querySelectorAll<HTMLElement>(FILE_TREE_ROW_SELECTOR)];
}

function rowPath(row: HTMLElement): string | null {
  return row.dataset.itemPath ?? null;
}

export function captureFileTreeScrollSnapshot(
  host: HTMLElement | null
): PierFileTreeScrollSnapshot | null {
  const scrollElement = fileTreeScrollElement(host);
  if (!scrollElement) {
    return null;
  }

  const fallbackScrollTop = scrollElement.scrollTop;
  const scrollRect = scrollElement.getBoundingClientRect();
  const rows = fileTreeRows(host);

  for (const row of rows) {
    const path = rowPath(row);
    if (!path) {
      continue;
    }

    const rect = row.getBoundingClientRect();
    const hasMeasuredRowGeometry =
      rect.height > 0 || rect.top !== 0 || rect.bottom !== 0;
    const isBeforeViewport = rect.bottom < scrollRect.top;
    if (!(hasMeasuredRowGeometry && !isBeforeViewport)) {
      continue;
    }

    return {
      fallbackScrollTop,
      kind: "anchor",
      path,
      topOffset: rect.top - scrollRect.top,
    };
  }

  return fallbackScrollTop > 0
    ? {
        fallbackScrollTop,
        kind: "position",
      }
    : null;
}

export function restoreFileTreeScrollSnapshot(
  host: HTMLElement | null,
  snapshot: PierFileTreeScrollSnapshot
): number | null {
  const scrollElement = fileTreeScrollElement(host);
  if (!scrollElement) {
    return null;
  }

  if (snapshot.kind === "anchor") {
    const scrollRect = scrollElement.getBoundingClientRect();
    const anchorRow = fileTreeRows(host).find(
      (row) => rowPath(row) === snapshot.path
    );

    if (anchorRow) {
      const rowRect = anchorRow.getBoundingClientRect();
      const nextScrollTop =
        scrollElement.scrollTop +
        rowRect.top -
        scrollRect.top -
        snapshot.topOffset;
      if (Math.abs(scrollElement.scrollTop - nextScrollTop) > 0.5) {
        scrollElement.scrollTop = nextScrollTop;
      }
      return scrollElement.scrollTop;
    }
  }

  if (Math.abs(scrollElement.scrollTop - snapshot.fallbackScrollTop) > 0.5) {
    scrollElement.scrollTop = snapshot.fallbackScrollTop;
  }
  return scrollElement.scrollTop;
}

export function scrollRestoreFrameCount(
  options: PierFileTreeScrollRestoreOptions
): number {
  return options.frames ?? 2;
}

export function restoreFileTreeScrollSnapshotSoon(
  host: HTMLElement | null,
  snapshot: PierFileTreeScrollSnapshot | null,
  options: PierFileTreeScrollRestoreOptions & {
    onFinished?: () => void;
    onRestored?: (scrollTop: number | null) => void;
    shouldContinue?: () => boolean;
  } = {}
): void {
  if (snapshot === null) {
    return;
  }

  const frameCount = scrollRestoreFrameCount(options);
  const schedule = getAnimationFrameScheduler();
  let remainingFrames = frameCount;
  const restoreNextFrame = () => {
    if (options.shouldContinue && !options.shouldContinue()) {
      return;
    }

    const restoredScrollTop = host
      ? restoreFileTreeScrollSnapshot(host, snapshot)
      : null;
    options.onRestored?.(restoredScrollTop);

    if (remainingFrames <= 0) {
      options.onFinished?.();
      return;
    }

    remainingFrames -= 1;
    schedule(restoreNextFrame);
  };

  restoreNextFrame();
}
