import * as React from "react";
import {
  POST_SUCCESS_IDLE_RELEASE_MS,
  POST_SUCCESS_MAX_HOLD_MS,
} from "./tree-reveal-timing.ts";

/** Reveal retry + post-success hold timers; unmount must clear them. */
export function useTreeRevealTimers(options: {
  /** Read-only view of the controller's pending reveal (stable ref identity). */
  pendingRevealRef: { readonly current: unknown };
  releaseProgrammaticScroll: () => void;
}): {
  armPostSuccessScrollHold: () => void;
  clearReleaseTimers: () => void;
  clearRevealRetryTimers: () => void;
  scheduleReleaseAfterIdle: () => void;
  scheduleRevealRetry: (delayMs: number, run: () => void) => void;
} {
  const { pendingRevealRef, releaseProgrammaticScroll } = options;

  const releaseIdleTimerRef = React.useRef<number | null>(null);
  const releaseHardTimerRef = React.useRef<number | null>(null);
  const revealRetryTimerIdsRef = React.useRef<Set<number>>(new Set());

  const clearReleaseTimers = React.useCallback(() => {
    if (releaseIdleTimerRef.current != null) {
      window.clearTimeout(releaseIdleTimerRef.current);
      releaseIdleTimerRef.current = null;
    }
    if (releaseHardTimerRef.current != null) {
      window.clearTimeout(releaseHardTimerRef.current);
      releaseHardTimerRef.current = null;
    }
  }, []);

  const releaseIfSettled = React.useCallback(() => {
    if (pendingRevealRef.current === null) {
      clearReleaseTimers();
      releaseProgrammaticScroll();
    }
  }, [clearReleaseTimers, pendingRevealRef, releaseProgrammaticScroll]);

  const scheduleReleaseAfterIdle = React.useCallback(() => {
    if (releaseIdleTimerRef.current != null) {
      window.clearTimeout(releaseIdleTimerRef.current);
    }
    releaseIdleTimerRef.current = window.setTimeout(() => {
      releaseIdleTimerRef.current = null;
      releaseIfSettled();
    }, POST_SUCCESS_IDLE_RELEASE_MS);
  }, [releaseIfSettled]);

  const armPostSuccessScrollHold = React.useCallback(() => {
    clearReleaseTimers();
    scheduleReleaseAfterIdle();
    releaseHardTimerRef.current = window.setTimeout(() => {
      releaseHardTimerRef.current = null;
      releaseIfSettled();
    }, POST_SUCCESS_MAX_HOLD_MS);
  }, [clearReleaseTimers, releaseIfSettled, scheduleReleaseAfterIdle]);

  const clearRevealRetryTimers = React.useCallback(() => {
    for (const timerId of revealRetryTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    revealRetryTimerIdsRef.current.clear();
  }, []);

  const scheduleRevealRetry = React.useCallback(
    (delayMs: number, run: () => void) => {
      const timerId = window.setTimeout(() => {
        revealRetryTimerIdsRef.current.delete(timerId);
        run();
      }, delayMs);
      revealRetryTimerIdsRef.current.add(timerId);
    },
    []
  );

  // Unmount only (both callbacks are stable): no timer survives the instance.
  React.useEffect(
    () => () => {
      clearReleaseTimers();
      clearRevealRetryTimers();
    },
    [clearReleaseTimers, clearRevealRetryTimers]
  );

  return {
    armPostSuccessScrollHold,
    clearReleaseTimers,
    clearRevealRetryTimers,
    scheduleReleaseAfterIdle,
    scheduleRevealRetry,
  };
}
