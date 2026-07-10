import * as React from "react";
import { installAutoHideScrollbar } from "./auto-hide-scrollbar.ts";
import {
  captureFileTreeScrollSnapshot,
  fileTreeHost,
  fileTreeScrollElement,
  getAnimationFrameScheduler,
  restoreFileTreeScrollSnapshot,
  scrollRestoreFrameCount,
} from "./file-tree-scroll.ts";
import type {
  PierFileTreeScrollController,
  PierFileTreeScrollRestoreOptions,
  PierFileTreeScrollSnapshot,
} from "./file-tree-types.ts";

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
}: PierFileTreeScrollControllerInput<TElement>) {
  const lockedScrollTopRef = React.useRef<number | null>(null);
  const restoreRunRef = React.useRef(0);
  const getHost = React.useCallback(
    () => fileTreeHost(containerRef.current),
    [containerRef]
  );
  const captureSnapshot = React.useCallback(
    () => captureFileTreeScrollSnapshot(getHost()),
    [getHost]
  );
  const applySnapshot = React.useCallback(
    (snapshot: PierFileTreeScrollSnapshot) =>
      restoreFileTreeScrollSnapshot(getHost(), snapshot),
    [getHost]
  );
  const restoreSnapshot = React.useCallback(
    (snapshot: PierFileTreeScrollSnapshot) => {
      applySnapshot(snapshot);
    },
    [applySnapshot]
  );
  const restoreSnapshotSoon = React.useCallback(
    (
      snapshot: PierFileTreeScrollSnapshot | null,
      options: PierFileTreeScrollRestoreOptions = {}
    ) => {
      if (snapshot === null) {
        return;
      }

      const restoreRun = restoreRunRef.current + 1;
      restoreRunRef.current = restoreRun;
      const frameCount = scrollRestoreFrameCount(options);
      const lock = options.lock === true;
      let remainingFrames = frameCount;
      const schedule = getAnimationFrameScheduler();
      const restoreNextFrame = () => {
        if (restoreRunRef.current !== restoreRun) {
          return;
        }
        const restoredScrollTop = applySnapshot(snapshot);
        if (lock && restoredScrollTop !== null) {
          lockedScrollTopRef.current = restoredScrollTop;
        }
        if (remainingFrames <= 0) {
          if (restoreRunRef.current === restoreRun) {
            lockedScrollTopRef.current = null;
          }
          return;
        }
        remainingFrames -= 1;
        schedule(restoreNextFrame);
      };

      restoreNextFrame();
    },
    [applySnapshot]
  );

  React.useImperativeHandle(
    scrollControllerRef,
    () => ({
      captureSnapshot,
      restoreSnapshot,
      restoreSnapshotSoon,
    }),
    [captureSnapshot, restoreSnapshot, restoreSnapshotSoon]
  );

  React.useLayoutEffect(() => {
    const host = getHost();
    if (!host) {
      return;
    }

    const publishSnapshot = () => {
      const snapshot = captureFileTreeScrollSnapshot(host);
      if (!snapshot) {
        return;
      }

      const lockedScrollTop = lockedScrollTopRef.current;
      if (
        lockedScrollTop !== null &&
        Math.abs(snapshot.fallbackScrollTop - lockedScrollTop) > 0.5
      ) {
        return;
      }

      onScrollSnapshotChange?.(snapshot);
    };

    let scrollElement: HTMLElement | null = null;
    let detachAutoHideScrollbar: (() => void) | null = null;
    const syncScrollListener = () => {
      const nextScrollElement = fileTreeScrollElement(host);
      if (nextScrollElement === scrollElement) {
        return;
      }

      scrollElement?.removeEventListener("scroll", publishSnapshot);
      detachAutoHideScrollbar?.();
      scrollElement = nextScrollElement;
      scrollElement?.addEventListener("scroll", publishSnapshot, {
        passive: true,
      });
      detachAutoHideScrollbar = scrollElement
        ? installAutoHideScrollbar(scrollElement)
        : null;
    };

    syncScrollListener();

    if (typeof MutationObserver !== "function" || !host.shadowRoot) {
      return () => {
        detachAutoHideScrollbar?.();
        scrollElement?.removeEventListener("scroll", publishSnapshot);
      };
    }

    const observer = new MutationObserver(() => {
      syncScrollListener();
      publishSnapshot();
    });
    observer.observe(host.shadowRoot, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      detachAutoHideScrollbar?.();
      scrollElement?.removeEventListener("scroll", publishSnapshot);
    };
  }, [getHost, onScrollSnapshotChange]);
}
