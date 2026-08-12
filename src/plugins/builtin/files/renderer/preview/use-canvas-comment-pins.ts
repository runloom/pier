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

export function useCanvasCommentPins(input: {
  readonly host: HTMLElement | null;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly shell: HTMLElement | null;
  readonly softMarkers: readonly CanvasSoftMarker[];
}): {
  readonly driftThreads: readonly CanvasCommentThreadView[];
  readonly pins: readonly CanvasCommentPinView[];
} {
  const [pins, setPins] = useState<readonly CanvasCommentPinView[]>([]);
  const [driftThreads, setDriftThreads] = useState<
    readonly CanvasCommentThreadView[]
  >([]);

  const { host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers } =
    input;

  useLayoutEffect(() => {
    if (!(host && shell)) {
      setPins([]);
      setDriftThreads([]);
      return;
    }
    const update = () => {
      const located = locateCanvasCommentPins({
        host,
        locatedByAnchorId,
        pickedNodeThreads,
        shell,
        softMarkers,
      });
      setPins(located.pins);
      setDriftThreads(located.driftThreads);
    };
    update();
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            update();
          });
    ro?.observe(host);
    ro?.observe(shell);
    host.addEventListener("scroll", update, { passive: true });
    shell.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      host.removeEventListener("scroll", update);
      shell.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [host, locatedByAnchorId, pickedNodeThreads, shell, softMarkers]);

  return { driftThreads, pins };
}
