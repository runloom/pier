import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

export const EXCERPT_LAYOUT = { gap: 0, paddingTop: 4, paddingBottom: 4 };

/** CodeView owns virtual geometry; this adapter only bounds its scroll viewport. */
export function useExcerptHeight(
  viewerRef: RefObject<CodeViewHandle<undefined> | null>,
  rootRef: RefObject<HTMLDivElement | null>,
  maxHeight: number,
  revision: string
): () => void {
  const frame = useRef(0);
  const mounted = useRef(false);
  const probe = useRef(false);
  const measure = useCallback(() => {
    if (!mounted.current || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const viewer = viewerRef.current?.getInstance();
      const root = rootRef.current;
      if (!(mounted.current && viewer && root)) return;
      if (probe.current) {
        probe.current = false;
        viewer.render(true);
      }
      // onPostRender precedes Pierre's reconciliation; read in the next frame.
      const itemHeight = viewer.getScrollHeight();
      if (itemHeight <= 0) return;
      const contentHeight =
        itemHeight + EXCERPT_LAYOUT.paddingTop + EXCERPT_LAYOUT.paddingBottom;
      const height = `${Math.max(1, Math.min(maxHeight, Math.ceil(contentHeight)))}px`;
      if (root.style.height !== height) root.style.height = height;
    });
  }, [maxHeight, rootRef, viewerRef]);

  // Height has a single DOM owner here, avoiding a React/ResizeObserver resize loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new excerpt or font invalidates measured wrap heights.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    mounted.current = true;
    const reset = () => {
      // Render at the cap before measuring so short wrapped content is not virtualized away.
      root.style.height = `${Math.max(1, maxHeight)}px`;
      probe.current = true;
      measure();
    };
    let width = root.getBoundingClientRect().width;
    const resize = new ResizeObserver(() => {
      const next = root.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      reset();
    });
    resize.observe(root);
    let disposed = false;
    const fonts = root.ownerDocument.fonts;
    fonts?.ready.then(() => {
      if (!disposed) reset();
    });
    fonts?.addEventListener("loadingdone", reset);
    reset();
    return () => {
      disposed = true;
      mounted.current = false;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      resize.disconnect();
      fonts?.removeEventListener("loadingdone", reset);
    };
  }, [maxHeight, measure, revision, rootRef]);
  return measure;
}
