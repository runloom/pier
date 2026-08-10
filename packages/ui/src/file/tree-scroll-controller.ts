import * as React from "react";
import { installAutoHideScrollbar } from "../auto-hide-scrollbar.ts";
import {
  captureFileTreeScrollSnapshot,
  fileTreeHost,
  fileTreeScrollElement,
  restoreFileTreeScrollSnapshot,
} from "./tree-scroll.ts";
import {
  createFileTreeScrollOwner,
  type FileTreeScrollOwner,
} from "./tree-scroll-owner.ts";
import type {
  PierFileTreeScrollController,
  PierFileTreeScrollSnapshot,
} from "./tree-types.ts";

/** Align with @pierre/trees keyboard pre-scroll keys. */
const FILE_TREE_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

type ScheduledHandle =
  | { readonly id: number; readonly kind: "raf" }
  | { readonly id: ReturnType<typeof setTimeout>; readonly kind: "timeout" };

function scheduleFrame(callback: FrameRequestCallback): ScheduledHandle {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return {
      kind: "raf",
      id: globalThis.requestAnimationFrame(callback),
    };
  }
  return {
    kind: "timeout",
    id: globalThis.setTimeout(
      () => callback(globalThis.performance?.now() ?? Date.now()),
      16
    ),
  };
}

function cancelScheduled(handle: ScheduledHandle | null): void {
  if (!handle) {
    return;
  }
  if (handle.kind === "raf") {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(handle.id);
    }
    return;
  }
  globalThis.clearTimeout(handle.id);
}

interface PierFileTreeScrollControllerInput<TElement extends HTMLElement> {
  containerRef: React.RefObject<TElement | null>;
  onScrollSnapshotChange:
    | ((snapshot: PierFileTreeScrollSnapshot) => void)
    | undefined;
  scrollControllerRef: React.Ref<PierFileTreeScrollController> | undefined;
}

export function usePierFileTreeScrollController<TElement extends HTMLElement>({
  containerRef,
  onScrollSnapshotChange,
  scrollControllerRef,
}: PierFileTreeScrollControllerInput<TElement>): {
  beginProgrammaticScroll: () => void;
  captureSnapshot: () => PierFileTreeScrollSnapshot | null;
  endProgrammaticScroll: () => void;
  requestLayoutCompensate: (
    snapshot: PierFileTreeScrollSnapshot | null,
    options?: { readonly settleFrames?: number }
  ) => void;
  scrollOwner: FileTreeScrollOwner;
} {
  const ownerRef = React.useRef<FileTreeScrollOwner | null>(null);
  if (ownerRef.current === null) {
    ownerRef.current = createFileTreeScrollOwner();
  }
  const scrollOwner = ownerRef.current;

  const getHost = React.useCallback(
    () => fileTreeHost(containerRef.current),
    [containerRef]
  );
  const captureSnapshot = React.useCallback(
    () => captureFileTreeScrollSnapshot(getHost()),
    [getHost]
  );
  const restoreSnapshot = React.useCallback(
    (snapshot: PierFileTreeScrollSnapshot) => {
      scrollOwner.withProgrammaticScroll(() => {
        restoreFileTreeScrollSnapshot(getHost(), snapshot);
      });
    },
    [getHost, scrollOwner]
  );
  const beginProgrammaticScroll = React.useCallback(() => {
    scrollOwner.beginReveal();
  }, [scrollOwner]);
  const endProgrammaticScroll = React.useCallback(() => {
    scrollOwner.endReveal();
  }, [scrollOwner]);
  const requestLayoutCompensate = React.useCallback(
    (
      snapshot: PierFileTreeScrollSnapshot | null,
      options?: { readonly settleFrames?: number }
    ) => {
      scrollOwner.requestLayoutCompensate(getHost(), snapshot, options);
    },
    [getHost, scrollOwner]
  );

  React.useImperativeHandle(
    scrollControllerRef,
    () => ({
      beginProgrammaticScroll,
      beginReveal: beginProgrammaticScroll,
      captureSnapshot,
      endProgrammaticScroll,
      endReveal: endProgrammaticScroll,
      requestLayoutCompensate,
      restoreSnapshot,
    }),
    [
      beginProgrammaticScroll,
      captureSnapshot,
      endProgrammaticScroll,
      requestLayoutCompensate,
      restoreSnapshot,
    ]
  );

  React.useLayoutEffect(() => {
    const host = getHost();
    if (!host) {
      return;
    }

    let snapshotHandle: ScheduledHandle | null = null;
    const publishSnapshot = () => {
      if (snapshotHandle != null) {
        return;
      }
      snapshotHandle = scheduleFrame(() => {
        snapshotHandle = null;
        const snapshot = captureFileTreeScrollSnapshot(host);
        if (!snapshot) {
          return;
        }
        onScrollSnapshotChange?.(snapshot);
      });
    };

    const claimFromUserGesture = () => {
      scrollOwner.claimUserScroll();
    };

    const onScroll = () => {
      if (!scrollOwner.isProgrammaticScrollEvent()) {
        claimFromUserGesture();
      }
      publishSnapshot();
    };

    const onWheel = () => {
      claimFromUserGesture();
    };

    const onTouchMove = () => {
      claimFromUserGesture();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!FILE_TREE_SCROLL_KEYS.has(event.key)) {
        return;
      }
      claimFromUserGesture();
    };

    let scrollElement: HTMLElement | null = null;
    let detachAutoHideScrollbar: (() => void) | null = null;
    let observer: MutationObserver | null = null;

    const bindScrollElement = (element: HTMLElement | null) => {
      if (element === scrollElement) {
        return;
      }
      scrollElement?.removeEventListener("scroll", onScroll);
      scrollElement?.removeEventListener("wheel", onWheel);
      scrollElement?.removeEventListener("touchmove", onTouchMove);
      scrollElement?.removeEventListener("keydown", onKeyDown);
      detachAutoHideScrollbar?.();
      scrollElement = element;
      if (!scrollElement) {
        detachAutoHideScrollbar = null;
        return;
      }
      scrollElement.addEventListener("scroll", onScroll, { passive: true });
      scrollElement.addEventListener("wheel", onWheel, { passive: true });
      scrollElement.addEventListener("touchmove", onTouchMove, {
        passive: true,
      });
      scrollElement.addEventListener("keydown", onKeyDown);
      detachAutoHideScrollbar = installAutoHideScrollbar(scrollElement);
    };

    /**
     * Watch for scroller mount/replacement without following virtual-row churn:
     * - no scroller yet → subtree observe until one appears
     * - scroller bound → observe only its parent childList for replacement
     */
    const wireScrollerObserver = () => {
      observer?.disconnect();
      observer = null;
      if (typeof MutationObserver !== "function" || !host.shadowRoot) {
        bindScrollElement(fileTreeScrollElement(host));
        return;
      }

      const next = fileTreeScrollElement(host);
      bindScrollElement(next);

      if (next?.parentElement) {
        const parent = next.parentElement;
        observer = new MutationObserver(() => {
          const current = fileTreeScrollElement(host);
          if (current !== scrollElement) {
            wireScrollerObserver();
          }
        });
        observer.observe(parent, { childList: true });
        return;
      }

      observer = new MutationObserver(() => {
        if (fileTreeScrollElement(host)) {
          wireScrollerObserver();
        }
      });
      observer.observe(host.shadowRoot, { childList: true, subtree: true });
    };

    wireScrollerObserver();

    return () => {
      observer?.disconnect();
      cancelScheduled(snapshotHandle);
      detachAutoHideScrollbar?.();
      scrollElement?.removeEventListener("scroll", onScroll);
      scrollElement?.removeEventListener("wheel", onWheel);
      scrollElement?.removeEventListener("touchmove", onTouchMove);
      scrollElement?.removeEventListener("keydown", onKeyDown);
    };
  }, [getHost, onScrollSnapshotChange, scrollOwner]);

  return {
    beginProgrammaticScroll,
    captureSnapshot,
    endProgrammaticScroll,
    requestLayoutCompensate,
    scrollOwner,
  };
}
