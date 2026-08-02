import {
  applyMarkdownPreviewAnchor,
  type MarkdownCrossModeAnchor,
} from "./cross-mode-anchor.ts";

const DEFAULT_MAX_CORRECTIONS = 2;
const DEFAULT_WINDOW_MS = 600;

/**
 * After the first content-anchor apply, re-apply up to `maxCorrections` times
 * while the document layout is still settling (images, mermaid, lazy pages).
 * One-shot window — stops on timeout, max corrections, or dispose.
 */
export function scheduleMarkdownPreviewAnchorReflow(input: {
  anchor: MarkdownCrossModeAnchor;
  isActive?: () => boolean;
  maxCorrections?: number;
  observeRoot: HTMLElement;
  scrollRoot: HTMLElement;
  windowMs?: number;
}): () => void {
  const maxCorrections = input.maxCorrections ?? DEFAULT_MAX_CORRECTIONS;
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  let corrections = 0;
  let raf = 0;
  let disposed = false;
  const startedAt = Date.now();

  const stillActive = () =>
    !disposed &&
    (input.isActive?.() ?? true) &&
    Date.now() - startedAt <= windowMs &&
    corrections < maxCorrections;

  const reapply = () => {
    if (!stillActive()) {
      dispose();
      return;
    }
    if (applyMarkdownPreviewAnchor(input.scrollRoot, input.anchor)) {
      corrections += 1;
    }
    if (!stillActive()) {
      dispose();
    }
  };

  const schedule = () => {
    if (!stillActive()) {
      dispose();
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(reapply);
  };

  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          schedule();
        });
  observer?.observe(input.observeRoot);

  // Catch late image/svg natural-size paints that may not resize the observe root
  // in the same frame as load.
  const onMedia = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("img, svg, video, canvas")) {
      schedule();
    }
  };
  input.observeRoot.addEventListener("load", onMedia, true);

  const timeoutId = window.setTimeout(() => {
    dispose();
  }, windowMs);

  // First reflow pass after layout.
  schedule();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(timeoutId);
    observer?.disconnect();
    input.observeRoot.removeEventListener("load", onMedia, true);
  }

  return dispose;
}
