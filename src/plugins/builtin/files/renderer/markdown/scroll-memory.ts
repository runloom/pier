import { useEffect, useRef } from "react";
import type { MarkdownDiskSource } from "./ir-renderer.tsx";
import type { MarkdownPreviewState } from "./preview-types.ts";

const STORAGE_PREFIX = "pier.files.markdown.scroll:";

function djb2(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: djb2 hash requires bitwise shift and overflow clamp.
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return String(hash);
}

export function rememberScrollPosition(input: {
  sourcePath: string;
  source: string;
  top: number;
}): void {
  if (!(input.top > 0)) return; // hidden-panel scrollTop=0 must not poison memory (view-scroll-capture 先例)
  try {
    globalThis.localStorage?.setItem(
      `${STORAGE_PREFIX}${input.sourcePath}`,
      JSON.stringify({ h: djb2(input.source), top: Math.round(input.top) })
    );
  } catch {
    /* degrade silently */
  }
}

export function recallScrollPosition(input: {
  sourcePath: string;
  source: string;
}): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(
      `${STORAGE_PREFIX}${input.sourcePath}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { h: string; top: number };
    return parsed.h === djb2(input.source) && parsed.top > 0
      ? parsed.top
      : null;
  } catch {
    return null;
  }
}

// Per-file reading-position memory hook: refs hold latest source/path/anchor
// so the scroll capture listener and restore effect read fresh values without
// re-subscribing on every render. Net-new in the reading-position capability;
// lives here to keep preview.tsx under the 500-line hard gate.
export function useScrollMemory(
  scrollRoot: HTMLElement | null,
  source: MarkdownDiskSource | undefined,
  value: string,
  initialAnchor: string | undefined,
  contentAnchorRequestId: string | number | undefined,
  status: MarkdownPreviewState["status"]
): void {
  const scrollSourcePathRef = useRef<string | undefined>(source?.path);
  scrollSourcePathRef.current = source?.path;
  const scrollSourceValueRef = useRef(value);
  scrollSourceValueRef.current = value;
  const scrollInitialAnchorRef = useRef(initialAnchor);
  scrollInitialAnchorRef.current = initialAnchor;
  const scrollContentAnchorRequestIdRef = useRef(contentAnchorRequestId);
  scrollContentAnchorRequestIdRef.current = contentAnchorRequestId;
  const scrollRestoredPathRef = useRef<string | null>(null);
  const scrollCaptureTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // Capture scroll position with a 250ms trailing debounce so quick scroll
  // bursts write once. top<=0 is ignored by rememberScrollPosition
  // (hidden-panel scrollTop=0 must not poison memory).
  useEffect(() => {
    if (!scrollRoot) return;
    const handleScroll = () => {
      clearTimeout(scrollCaptureTimerRef.current);
      scrollCaptureTimerRef.current = setTimeout(() => {
        scrollCaptureTimerRef.current = undefined;
        const path = scrollSourcePathRef.current;
        if (!path) return;
        rememberScrollPosition({
          sourcePath: path,
          source: scrollSourceValueRef.current,
          top: scrollRoot.scrollTop,
        });
      }, 250);
    };
    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(scrollCaptureTimerRef.current);
      scrollCaptureTimerRef.current = undefined;
      scrollRoot.removeEventListener("scroll", handleScroll);
    };
  }, [scrollRoot]);

  // Restore the last remembered position for this file once the document is
  // ready. Wait two animation frames so paginated layout settles before
  // applying scrollTop. Yield to cross-mode anchors: when initialAnchor or
  // contentAnchorRequestId is set, skip restore (and mark the path handled so
  // a later anchor clear does not jump to a stale remembered position).
  useEffect(() => {
    if (status !== "ready") return;
    const path = scrollSourcePathRef.current;
    if (!(path && scrollRoot)) return;
    if (scrollRestoredPathRef.current === path) return;
    if (
      scrollInitialAnchorRef.current != null ||
      scrollContentAnchorRequestIdRef.current != null
    ) {
      scrollRestoredPathRef.current = path;
      return;
    }
    const recalled = recallScrollPosition({
      sourcePath: path,
      source: scrollSourceValueRef.current,
    });
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        scrollRestoredPathRef.current = path;
        if (scrollRoot) scrollRoot.scrollTop = recalled ?? 0;
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [status, scrollRoot]);
}
