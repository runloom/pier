/**
 * Content-based anchors for exclusive preview ↔ source mode switches.
 * Coordinates are source document character offsets (same as IR ranges).
 * Viewport focus band matches the TOC scroll-spy definition.
 */

export type MarkdownCrossModeAlign = "center" | "start";

export interface MarkdownCrossModeAnchor {
  /** Align restored content in the viewport; default matches scroll-spy. */
  align: MarkdownCrossModeAlign;
  /** 0–1 progress through the hit block's visible height (optional). */
  blockProgress?: number;
  /** Optional heading id when known (helps force lazy pages). */
  headingId?: string;
  /** Source character offset (primary coordinate). */
  offset: number;
}

/** Focus band near the upper quarter of the scrollport (docs-site style). */
export const MARKDOWN_VIEWPORT_FOCUS_BAND = {
  maxPx: 96,
  ratio: 0.22,
} as const;

const SOURCE_OFFSET_ATTR = "data-source-offset";
const SOURCE_END_OFFSET_ATTR = "data-source-end-offset";

export function markdownViewportFocusY(rootRect: DOMRectReadOnly): number {
  return (
    rootRect.top +
    Math.min(
      MARKDOWN_VIEWPORT_FOCUS_BAND.maxPx,
      rootRect.height * MARKDOWN_VIEWPORT_FOCUS_BAND.ratio
    )
  );
}

export function clampUnit(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function offsetWithinBlockRange(
  startOffset: number,
  endOffset: number,
  blockProgress: number
): number {
  const start = Math.max(0, startOffset);
  const end = Math.max(start, endOffset);
  const progress = clampUnit(blockProgress);
  return Math.round(start + progress * (end - start));
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function readBlockOffsets(element: HTMLElement): {
  endOffset: number;
  startOffset: number;
} | null {
  const startOffset = parseNonNegativeInt(element.dataset.sourceOffset);
  if (startOffset === null) return null;
  const endRaw = parseNonNegativeInt(element.dataset.sourceEndOffset);
  const endOffset =
    endRaw === null ? startOffset : Math.max(startOffset, endRaw);
  return { endOffset, startOffset };
}

function listSourceBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[${SOURCE_OFFSET_ATTR}]`)
  );
}

/**
 * Capture the source offset under the preview viewport focus band.
 */
export function captureMarkdownPreviewAnchor(
  scrollRoot: HTMLElement
): MarkdownCrossModeAnchor {
  const blocks = listSourceBlocks(scrollRoot);
  if (blocks.length === 0) {
    return { align: "start", offset: 0 };
  }

  const rootRect = scrollRoot.getBoundingClientRect();
  const focusY = markdownViewportFocusY(rootRect);

  let best: HTMLElement | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  let bestHeight = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    const top = rect.top;
    const height = Math.max(1, rect.height);
    const delta = focusY - top;
    // Prefer the focus band hit; break ties toward the tightest (deepest) block.
    if (delta < -8) continue;
    if (
      delta < bestDelta - 0.5 ||
      (Math.abs(delta - bestDelta) <= 0.5 && height < bestHeight)
    ) {
      bestDelta = delta;
      bestHeight = height;
      best = block;
    }
  }
  if (!best) {
    best = blocks[0] ?? null;
  }
  if (!best) {
    return { align: "start", offset: 0 };
  }

  const offsets = readBlockOffsets(best);
  if (!offsets) {
    return { align: "start", offset: 0 };
  }

  const rect = best.getBoundingClientRect();
  const height = Math.max(1, rect.height);
  const blockProgress = clampUnit((focusY - rect.top) / height);
  const offset = offsetWithinBlockRange(
    offsets.startOffset,
    offsets.endOffset,
    blockProgress
  );

  return {
    align: "start",
    blockProgress,
    offset,
  };
}

/**
 * Find the rendered block that best represents a source offset.
 * Prefer a block whose [start, end] covers the offset; otherwise the latest
 * block that starts at or before the offset.
 */
export function findMarkdownPreviewBlockForOffset(
  root: HTMLElement,
  offset: number
): HTMLElement | null {
  const target = Math.max(0, Math.floor(offset));
  const blocks = listSourceBlocks(root);
  if (blocks.length === 0) return null;

  let covering: HTMLElement | null = null;
  let coveringSpan = Number.POSITIVE_INFINITY;
  let latestBefore: HTMLElement | null = null;
  let latestBeforeStart = -1;

  for (const block of blocks) {
    const offsets = readBlockOffsets(block);
    if (!offsets) continue;
    const { startOffset, endOffset } = offsets;
    if (target >= startOffset && target <= endOffset) {
      const span = endOffset - startOffset;
      if (span < coveringSpan) {
        coveringSpan = span;
        covering = block;
      }
    }
    if (startOffset <= target && startOffset >= latestBeforeStart) {
      latestBeforeStart = startOffset;
      latestBefore = block;
    }
  }

  return covering ?? latestBefore ?? blocks[0] ?? null;
}

/**
 * Progress of `offset` within a block's source range (0–1).
 * Used when capture did not store blockProgress (source → preview).
 */
export function blockProgressForOffset(
  startOffset: number,
  endOffset: number,
  offset: number
): number {
  const start = Math.max(0, startOffset);
  const end = Math.max(start, endOffset);
  if (end <= start) return 0;
  return clampUnit((offset - start) / (end - start));
}

/**
 * Scroll the preview so the content for `anchor.offset` sits in the focus band.
 * Returns true when a block was found and scrolled.
 */
export function applyMarkdownPreviewAnchor(
  scrollRoot: HTMLElement,
  anchor: MarkdownCrossModeAnchor
): boolean {
  const block = findMarkdownPreviewBlockForOffset(scrollRoot, anchor.offset);
  if (!block) return false;

  const offsets = readBlockOffsets(block);
  const align = anchor.align === "center" ? "center" : "start";
  // Prefer explicit capture progress; otherwise derive from offset in the block.
  let progress = 0;
  if (anchor.blockProgress !== undefined) {
    progress = clampUnit(anchor.blockProgress);
  } else if (offsets) {
    progress = blockProgressForOffset(
      offsets.startOffset,
      offsets.endOffset,
      anchor.offset
    );
  }

  // Cross-mode: horizontal is mode-local. Always pin preview to the left edge.
  scrollRoot.scrollLeft = 0;

  if (align === "center") {
    if (typeof block.scrollIntoView === "function") {
      block.scrollIntoView({
        block: "center",
        behavior: "auto",
        inline: "nearest",
      });
    }
    scrollRoot.scrollLeft = 0;
    return true;
  }

  // Place the progressive point (not only block top) on the focus band.
  // Avoid scrollIntoView-then-nudge: that double-jumps and fights lazy layout.
  const rootRect = scrollRoot.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  const focusOffsetInRoot = markdownViewportFocusY(rootRect) - rootRect.top;
  const blockTopInContent =
    scrollRoot.scrollTop + (blockRect.top - rootRect.top);
  const targetTop =
    blockTopInContent +
    progress * Math.max(0, blockRect.height) -
    focusOffsetInRoot;
  scrollRoot.scrollTop = Math.max(0, targetTop);
  scrollRoot.scrollLeft = 0;
  return true;
}

/** Page index whose source range covers or is nearest before the offset. */
export function findMarkdownPageIndexForOffset(
  pages: readonly {
    index: number;
    range: { endOffset: number; startOffset: number };
  }[],
  offset: number
): number | null {
  if (pages.length === 0) return null;
  const target = Math.max(0, Math.floor(offset));
  let latestBefore: number | null = null;
  for (const page of pages) {
    const { startOffset, endOffset } = page.range;
    if (target >= startOffset && target <= endOffset) {
      return page.index;
    }
    if (startOffset <= target) {
      latestBefore = page.index;
    }
  }
  return latestBefore ?? pages[0]?.index ?? null;
}

/**
 * Force-render page 0..target so placeholder heights above the anchor do not
 * skew scrollTop when restoring a mid-document content anchor.
 */
export function markdownPagesToForceForOffset(
  pages: readonly {
    index: number;
    range: { endOffset: number; startOffset: number };
  }[],
  offset: number
): number[] {
  const targetIndex = findMarkdownPageIndexForOffset(pages, offset);
  if (targetIndex === null) {
    return pages.length > 0 ? [0] : [];
  }
  const forced: number[] = [];
  for (const page of pages) {
    if (page.index <= targetIndex) {
      forced.push(page.index);
    }
  }
  return forced.length > 0 ? forced : [targetIndex];
}

export function defaultMarkdownCrossModeAnchor(
  offset = 0
): MarkdownCrossModeAnchor {
  return { align: "start", offset: Math.max(0, Math.floor(offset)) };
}

// Attribute names exported for tests / DOM writers.
export const MARKDOWN_SOURCE_OFFSET_ATTR = SOURCE_OFFSET_ATTR;
export const MARKDOWN_SOURCE_END_OFFSET_ATTR = SOURCE_END_OFFSET_ATTR;
