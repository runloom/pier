/**
 * Per-file markdown preview reading-position memory.
 * Durable coordinate is source offset (cross-mode anchor), not pixel scrollTop.
 */
import { useEffect, useRef, useState } from "react";
import {
  captureMarkdownPreviewAnchor,
  clampUnit,
  type MarkdownCrossModeAnchor,
} from "./cross-mode-anchor.ts";
import type { MarkdownDiskSource } from "./ir-renderer.tsx";

export const MARKDOWN_SCROLL_MEMORY_STORAGE_PREFIX =
  "pier.files.markdown.scroll:";
export const MARKDOWN_SCROLL_MEMORY_VERSION = 2;
export const MARKDOWN_SCROLL_MEMORY_CAPTURE_DEBOUNCE_MS = 250;
export const MARKDOWN_SCROLL_MEMORY_RESTORE_LOCK_MS = 600;

export interface MarkdownScrollMemoryV2 {
  readonly blockProgress?: number;
  readonly offset: number;
  readonly v: 2;
}

interface PendingScrollMemory {
  readonly blockProgress?: number;
  readonly offset: number;
  readonly sourcePath: string;
}

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Hidden tab / display:none must not capture. Matches editor view-scroll-capture:
 * hide often zeroes scrollTop; walking offsetParent is unreliable in jsdom.
 */
export function isMarkdownPreviewScrollSurfaceVisible(
  element: HTMLElement
): boolean {
  if (!element.isConnected) {
    return false;
  }
  const win = element.ownerDocument.defaultView;
  if (!win) {
    return true;
  }
  let node: HTMLElement | null = element;
  while (node) {
    const style = win.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

export function shouldCaptureMarkdownPreviewScroll(root: HTMLElement): boolean {
  return isMarkdownPreviewScrollSurfaceVisible(root) && root.scrollTop > 0;
}

export function parseMarkdownScrollMemory(
  raw: unknown
): MarkdownScrollMemoryV2 | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as {
    blockProgress?: unknown;
    offset?: unknown;
    v?: unknown;
  };
  if (record.v !== MARKDOWN_SCROLL_MEMORY_VERSION) {
    return null;
  }
  if (!(isFiniteNumber(record.offset) && record.offset > 0)) {
    return null;
  }
  const offset = Math.round(record.offset);
  if (!(offset > 0)) {
    return null;
  }
  if (record.blockProgress === undefined) {
    return { offset, v: 2 };
  }
  if (!isFiniteNumber(record.blockProgress)) {
    return { offset, v: 2 };
  }
  return {
    blockProgress: clampUnit(record.blockProgress),
    offset,
    v: 2,
  };
}

export function rememberScrollPosition(input: {
  blockProgress?: number;
  offset: number;
  sourcePath: string;
}): void {
  if (!(input.offset > 0) || input.sourcePath.length === 0) {
    return;
  }
  const payload: MarkdownScrollMemoryV2 = {
    offset: Math.round(input.offset),
    v: 2,
    ...(input.blockProgress === undefined
      ? {}
      : { blockProgress: clampUnit(input.blockProgress) }),
  };
  if (!(payload.offset > 0)) {
    return;
  }
  try {
    preferenceStorage()?.setItem(
      `${MARKDOWN_SCROLL_MEMORY_STORAGE_PREFIX}${input.sourcePath}`,
      JSON.stringify(payload)
    );
  } catch {
    /* quota / private mode: degrade silently */
  }
}

export function recallScrollPosition(
  sourcePath: string
): MarkdownCrossModeAnchor | null {
  if (sourcePath.length === 0) {
    return null;
  }
  try {
    const raw = preferenceStorage()?.getItem(
      `${MARKDOWN_SCROLL_MEMORY_STORAGE_PREFIX}${sourcePath}`
    );
    if (!raw) {
      return null;
    }
    const parsed = parseMarkdownScrollMemory(JSON.parse(raw) as unknown);
    if (!parsed) {
      return null;
    }
    return {
      align: "start",
      offset: parsed.offset,
      ...(parsed.blockProgress === undefined
        ? {}
        : { blockProgress: parsed.blockProgress }),
    };
  } catch {
    return null;
  }
}

function yieldToHigherIntent(
  initialAnchor: string | undefined,
  contentAnchorRequestId: string | number | undefined
): boolean {
  return initialAnchor != null || contentAnchorRequestId != null;
}

function snapshotScrollMemory(
  root: HTMLElement,
  sourcePath: string
): PendingScrollMemory | null {
  if (!shouldCaptureMarkdownPreviewScroll(root) || sourcePath.length === 0) {
    return null;
  }
  const captured = captureMarkdownPreviewAnchor(root);
  if (!(captured.offset > 0)) {
    return null;
  }
  return {
    offset: captured.offset,
    sourcePath,
    ...(captured.blockProgress === undefined
      ? {}
      : { blockProgress: captured.blockProgress }),
  };
}

function persistPending(pending: PendingScrollMemory | null): void {
  if (!pending) {
    return;
  }
  rememberScrollPosition(pending);
}

// Per-file reading-position memory hook: capture at scroll-event time (not
// debounce-fire time) so hide/zeroing cannot poison the last real position.
// Restore is a content-anchor for pagination-view; re-reveal after hide gets a
// new request id because dockview leaves the preview mounted.
export function useScrollMemory(
  scrollRoot: HTMLElement | null,
  source: MarkdownDiskSource | undefined,
  initialAnchor: string | undefined,
  contentAnchorRequestId: string | number | undefined,
  contentReady: boolean
): {
  memoryAnchor: MarkdownCrossModeAnchor | undefined;
  memoryRequestId: number | undefined;
} {
  const path = source?.path;
  const requestIdRef = useRef(0);
  const restoreLockUntilRef = useRef(0);
  const handledKeyRef = useRef<string | null>(null);
  const visibleEpochRef = useRef(0);
  const visibleRef = useRef(true);
  const pendingRef = useRef<PendingScrollMemory | null>(null);
  const issuedRef = useRef<{
    anchor: MarkdownCrossModeAnchor;
    path: string;
    requestId: number;
  } | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const scrollCaptureTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const flushPendingNowRef = useRef(() => {
    /* assigned below */
  });
  flushPendingNowRef.current = () => {
    clearTimeout(scrollCaptureTimerRef.current);
    scrollCaptureTimerRef.current = undefined;
    const pending = pendingRef.current;
    pendingRef.current = null;
    persistPending(pending);
  };

  const restoreKey =
    path === undefined ? null : `${path}:${visibleEpochRef.current}`;
  if (
    contentReady &&
    path &&
    isVisible &&
    restoreKey !== null &&
    handledKeyRef.current !== restoreKey
  ) {
    handledKeyRef.current = restoreKey;
    restoreLockUntilRef.current =
      Date.now() + MARKDOWN_SCROLL_MEMORY_RESTORE_LOCK_MS;
    if (yieldToHigherIntent(initialAnchor, contentAnchorRequestId)) {
      issuedRef.current = null;
    } else {
      const recalled = recallScrollPosition(path);
      if (recalled) {
        requestIdRef.current += 1;
        issuedRef.current = {
          anchor: recalled,
          path,
          requestId: requestIdRef.current,
        };
      } else {
        issuedRef.current = null;
      }
    }
  }

  const suppressMemory = yieldToHigherIntent(
    initialAnchor,
    contentAnchorRequestId
  );
  const issued = issuedRef.current;
  const memoryAnchor =
    !isVisible || suppressMemory || issued?.path !== path
      ? undefined
      : issued?.anchor;
  const memoryRequestId =
    !isVisible || suppressMemory || issued?.path !== path
      ? undefined
      : issued?.requestId;

  useEffect(() => {
    if (!(scrollRoot && path)) {
      return;
    }
    const handleScroll = () => {
      if (!shouldCaptureMarkdownPreviewScroll(scrollRoot)) {
        return;
      }
      if (Date.now() < restoreLockUntilRef.current) {
        return;
      }
      const snapshot = snapshotScrollMemory(scrollRoot, path);
      if (!snapshot) {
        return;
      }
      pendingRef.current = snapshot;
      clearTimeout(scrollCaptureTimerRef.current);
      scrollCaptureTimerRef.current = setTimeout(() => {
        scrollCaptureTimerRef.current = undefined;
        const pending = pendingRef.current;
        pendingRef.current = null;
        persistPending(pending);
      }, MARKDOWN_SCROLL_MEMORY_CAPTURE_DEBOUNCE_MS);
    };
    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener("scroll", handleScroll);
      flushPendingNowRef.current();
    };
  }, [path, scrollRoot]);

  useEffect(() => {
    if (!scrollRoot || typeof IntersectionObserver === "undefined") {
      return;
    }
    let disposed = false;
    const observer = new IntersectionObserver(() => {
      if (disposed) {
        return;
      }
      // IO is only a wakeup. jsdom often reports isIntersecting=false for
      // on-screen nodes; hide is real only when computed style says so.
      const styleVisible = isMarkdownPreviewScrollSurfaceVisible(scrollRoot);
      if (styleVisible) {
        if (!visibleRef.current) {
          visibleRef.current = true;
          setIsVisible(true);
        }
        return;
      }
      flushPendingNowRef.current();
      if (visibleRef.current) {
        visibleRef.current = false;
        visibleEpochRef.current += 1;
        setIsVisible(false);
      }
    });
    observer.observe(scrollRoot);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [scrollRoot]);

  return { memoryAnchor, memoryRequestId };
}
