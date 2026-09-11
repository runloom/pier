import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import type { GitReviewReadingSurface } from "./reading-surface.ts";
import { addReviewSurface, reviewSurfaceForGroup } from "./surface-group.ts";
import {
  buildActivateNavigationRequest,
  type ReviewSurfaceNavigationRequest,
  type ReviewTreeOpenReveal,
  shouldSkipDuplicateTreeOpen,
} from "./surface-types.ts";

/**
 * 共享树打开：B-Select 立刻更新；阅读钉仍在且同 section 则不加 nonce。
 * 树跨面点击：立即切面 + 立即可见新面（无旧面 handoff 叠层）。
 */
export function useSharedTreeOpen(options: {
  readonly activeSurfaceRef: { current: GitReviewReadingSurface };
  readonly entries: readonly GitReviewIndexEntry[];
  readonly lastNavigationPathRef: { current: string | null };
  readonly navigationNonceRef: { current: number };
  readonly navigationRequestRef: {
    current: ReviewSurfaceNavigationRequest | null;
  };
  readonly setActiveSurface: Dispatch<SetStateAction<GitReviewReadingSurface>>;
  readonly setMountedSurfaces: Dispatch<
    SetStateAction<ReadonlySet<GitReviewReadingSurface>>
  >;
  readonly setNavigationRequest: Dispatch<
    SetStateAction<ReviewSurfaceNavigationRequest | null>
  >;
  readonly setNavigationSeq: Dispatch<SetStateAction<number>>;
  readonly setSelectedTreeSectionKey: Dispatch<SetStateAction<string | null>>;
  readonly userPickedSurfaceRef: { current: boolean };
}): {
  readonly releaseReadingPin: () => void;
  readonly requestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: ReviewTreeOpenReveal
  ) => void;
} {
  const {
    activeSurfaceRef,
    entries,
    lastNavigationPathRef,
    navigationNonceRef,
    navigationRequestRef,
    setActiveSurface,
    setMountedSurfaces,
    setNavigationRequest,
    setNavigationSeq,
    setSelectedTreeSectionKey,
    userPickedSurfaceRef,
  } = options;
  const readingPinRef = useRef<{
    entryKey: string;
    sectionKey: string;
  } | null>(null);
  const requestTreeOpen = useCallback(
    (
      entryKey: string,
      sectionKey: string,
      group: GitReviewGroup,
      reveal?: ReviewTreeOpenReveal
    ) => {
      userPickedSurfaceRef.current = true;
      setSelectedTreeSectionKey(sectionKey);
      if (
        shouldSkipDuplicateTreeOpen({
          currentPin: readingPinRef.current,
          entryKey,
          sectionKey,
          ...(reveal === undefined ? {} : { reveal }),
        })
      ) {
        return;
      }
      readingPinRef.current = { entryKey, sectionKey };
      const surface = reviewSurfaceForGroup(group);
      lastNavigationPathRef.current =
        entries.find((entry) => entry.entryKey === entryKey)?.path ??
        lastNavigationPathRef.current;
      setMountedSurfaces((current) => addReviewSurface(current, surface));
      if (activeSurfaceRef.current !== surface) {
        setActiveSurface(surface);
        activeSurfaceRef.current = surface;
      }
      navigationNonceRef.current += 1;
      const nonce = navigationNonceRef.current;
      setNavigationSeq(nonce);
      const request = buildActivateNavigationRequest(
        nonce,
        entryKey,
        sectionKey,
        surface,
        reveal
      );
      navigationRequestRef.current = request;
      setNavigationRequest(request);
    },
    [
      activeSurfaceRef,
      entries,
      lastNavigationPathRef,
      navigationNonceRef,
      navigationRequestRef,
      setActiveSurface,
      setMountedSurfaces,
      setNavigationRequest,
      setNavigationSeq,
      setSelectedTreeSectionKey,
      userPickedSurfaceRef,
    ]
  );
  const releaseReadingPin = useCallback(() => {
    readingPinRef.current = null;
  }, []);
  return { releaseReadingPin, requestTreeOpen };
}
