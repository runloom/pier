/**
 * Live pin geometry for canvas comments (host + shell measure).
 */
import { useLayoutEffect, useState } from "react";
import { locateCanvasCommentPins } from "./canvas-comment-locate.ts";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import type {
  CanvasCommentThreadView,
  CanvasSoftMarker,
} from "./use-canvas-preview-comments.ts";

function samePinViews(
  left: readonly CanvasCommentPinView[],
  right: readonly CanvasCommentPinView[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!(a && b)) {
      return false;
    }
    if (
      a.key !== b.key ||
      a.index !== b.index ||
      a.left !== b.left ||
      a.top !== b.top ||
      a.title !== b.title ||
      a.threads.length !== b.threads.length
    ) {
      return false;
    }
    for (let j = 0; j < a.threads.length; j++) {
      if (a.threads[j]?.threadId !== b.threads[j]?.threadId) {
        return false;
      }
    }
  }
  return true;
}

function sameThreadIds(
  left: readonly CanvasCommentThreadView[],
  right: readonly CanvasCommentThreadView[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (thread, index) => thread.threadId === right[index]?.threadId
  );
}

export function useCanvasCommentPins(input: {
  readonly host: HTMLElement | null;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly shell: HTMLElement | null;
  readonly softMarkers: readonly CanvasSoftMarker[];
}): {
  readonly driftThreads: readonly CanvasCommentThreadView[];
  readonly hiddenPins: readonly CanvasCommentPinView[];
  readonly pins: readonly CanvasCommentPinView[];
} {
  const [pins, setPins] = useState<readonly CanvasCommentPinView[]>([]);
  const [hiddenPins, setHiddenPins] = useState<readonly CanvasCommentPinView[]>(
    []
  );
  const [driftThreads, setDriftThreads] = useState<
    readonly CanvasCommentThreadView[]
  >([]);

  const { host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers } =
    input;

  useLayoutEffect(() => {
    if (!(host && shell)) {
      setPins([]);
      setHiddenPins([]);
      setDriftThreads([]);
      return;
    }
    const apply = () => {
      const located = locateCanvasCommentPins({
        host,
        locatedByAnchorId,
        pickedNodeThreads,
        shell,
        softMarkers,
      });
      setPins((prev) =>
        samePinViews(prev, located.pins) ? prev : located.pins
      );
      setHiddenPins((prev) =>
        samePinViews(prev, located.hiddenPins) ? prev : located.hiddenPins
      );
      setDriftThreads((prev) =>
        sameThreadIds(prev, located.driftThreads) ? prev : located.driftThreads
      );
    };
    apply();
    let raf = 0;
    const schedule = () => {
      if (raf !== 0) {
        return;
      }
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            schedule();
          });
    ro?.observe(host);
    ro?.observe(shell);
    host.addEventListener("scroll", schedule, { passive: true });
    shell.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            schedule();
          });
    mo?.observe(host, {
      attributeFilter: ["data-state", "hidden"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
      }
      ro?.disconnect();
      mo?.disconnect();
      host.removeEventListener("scroll", schedule);
      shell.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers]);

  return { driftThreads, hiddenPins, pins };
}
