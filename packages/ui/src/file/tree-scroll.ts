import type { PierFileTreeScrollSnapshot } from "./tree-types.ts";

/** Internal options for deprecated multi-step restore helpers. */
interface ScrollRestoreSoonOptions {
  readonly frames?: number;
  readonly settleFrames?: number;
}

export const FILE_TREE_HOST_SELECTOR =
  'file-tree-container[data-slot="pier-file-tree"]';
const FILE_TREE_ROW_SELECTOR = '[role="treeitem"][data-item-path]';
const FILE_TREE_SCROLL_SELECTORS = [
  '[data-file-tree-virtualized-scroll="true"]',
  '[role="tree"]',
] as const;

export function getAnimationFrameScheduler() {
  // Resolve rAF on each call so test spies on globalThis.requestAnimationFrame work.
  return (callback: FrameRequestCallback) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      return globalThis.requestAnimationFrame(callback);
    }
    return globalThis.setTimeout(
      () => callback(globalThis.performance?.now() ?? Date.now()),
      16
    );
  };
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

/** Resolve the virtualized scroller from any node inside the tree shadow root. */
export function fileTreeScrollElementFromNode(
  node: Element | null | undefined
): HTMLElement | null {
  if (!node) {
    return null;
  }
  const root = node.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
    return fileTreeScrollElement(root.host);
  }
  if (node instanceof HTMLElement) {
    return fileTreeScrollElement(
      node.closest<HTMLElement>(FILE_TREE_HOST_SELECTOR)
    );
  }
  return null;
}

/**
 * Pin raw scrollTop of an element across involuntary layout/focus jostle.
 * Prefer this over item-based scrollTo for context-menu freeze.
 */
export function pinRawScrollTop(
  scrollElement: HTMLElement | null | undefined,
  options?: { readonly frames?: number }
): () => void {
  if (!scrollElement) {
    return () => undefined;
  }
  const scrollTop = scrollElement.scrollTop;
  let disposed = false;
  const restore = () => {
    if (disposed) {
      return;
    }
    if (Math.abs(scrollElement.scrollTop - scrollTop) > 0.5) {
      scrollElement.scrollTop = scrollTop;
    }
  };
  queueMicrotask(restore);
  const schedule = getAnimationFrameScheduler();
  const frames = options?.frames ?? 2;
  let remaining = frames;
  const tick = () => {
    restore();
    remaining -= 1;
    if (remaining > 0) {
      schedule(tick);
    }
  };
  schedule(tick);
  return () => {
    disposed = true;
    restore();
  };
}

/**
 * Pin the tree scroller around a context-menu open.
 *
 * @pierre/trees right-click focuses the row, then a layout effect may call
 * scrollFocusedRowIntoView with stickyOverlayHeight as topInset. Rows that sit
 * under sticky group headers (git review tree) get scrolled even though the
 * pointer is already on them — the scrollbar jumps. Restore the pre-open
 * scrollTop after that layout work, before paint when possible.
 */
export function pinFileTreeScrollDuringContextMenu(
  anchorElement: Element | null | undefined
): () => void {
  return pinRawScrollTop(fileTreeScrollElementFromNode(anchorElement), {
    frames: 2,
  });
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

/**
 * @deprecated Prefer createFileTreeScrollOwner().requestLayoutCompensate.
 * Kept for tests that drive raw multi-step restore without the owner.
 */
export function scrollRestoreFrameCount(
  options: ScrollRestoreSoonOptions
): number {
  if (options.settleFrames !== undefined) {
    return options.settleFrames;
  }
  if (options.frames !== undefined) {
    return options.frames;
  }
  return 1;
}

/**
 * @deprecated Prefer createFileTreeScrollOwner().requestLayoutCompensate.
 * Does not lock scroll against the user.
 */
export function restoreFileTreeScrollSnapshotSoon(
  host: HTMLElement | null,
  snapshot: PierFileTreeScrollSnapshot | null,
  options: ScrollRestoreSoonOptions & {
    onFinished?: () => void;
    onRestored?: (scrollTop: number | null) => void;
    shouldContinue?: () => boolean;
  } = {}
): void {
  if (snapshot === null) {
    return;
  }

  const settleFrames = scrollRestoreFrameCount(options);
  const schedule = getAnimationFrameScheduler();
  let remainingSettle = settleFrames;
  const restoreNextFrame = () => {
    if (options.shouldContinue && !options.shouldContinue()) {
      return;
    }

    const restoredScrollTop = host
      ? restoreFileTreeScrollSnapshot(host, snapshot)
      : null;
    options.onRestored?.(restoredScrollTop);

    if (remainingSettle <= 0) {
      options.onFinished?.();
      return;
    }

    remainingSettle -= 1;
    schedule(restoreNextFrame);
  };

  restoreNextFrame();
}
