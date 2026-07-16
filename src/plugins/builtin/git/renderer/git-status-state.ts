import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";

const RETRY_DELAYS_MS = [250, 1000, 4000] as const;

export type GitStatusLoadState =
  | { kind: "error"; retry: () => void }
  | { kind: "loaded"; status: GitStatus }
  | { kind: "loading" };

/** Git 状态快照与 watch START 共用同一套有界恢复和显式重试。 */
export function useGitStatus(
  context: RendererPluginContext,
  gitRoot: string | undefined
): GitStatusLoadState {
  const [state, setState] = useState<GitStatusLoadState>({ kind: "loading" });

  useEffect(() => {
    if (!gitRoot) {
      setState({ kind: "loading" });
      return;
    }
    const root = gitRoot;
    let alive = true;
    let sequence = 0;
    let statusRetryIndex = 0;
    let statusRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeWatch: () => void = () => undefined;
    let watchAttempt = 0;
    let watchReady = false;
    let watchRetryIndex = 0;
    let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      return null;
    };

    function retry(): void {
      if (!alive) {
        return;
      }
      statusRetryIndex = 0;
      statusRetryTimer = clearTimer(statusRetryTimer);
      watchRetryIndex = 0;
      watchRetryTimer = clearTimer(watchRetryTimer);
      setState({ kind: "loading" });
      startWatch();
    }

    function apply(next: GitStatus): void {
      if (!alive) {
        return;
      }
      statusRetryIndex = 0;
      statusRetryTimer = clearTimer(statusRetryTimer);
      setState(
        watchReady ? { kind: "loaded", status: next } : { kind: "error", retry }
      );
    }

    function scheduleStatusRetry(): void {
      const delay = RETRY_DELAYS_MS[statusRetryIndex];
      if (delay === undefined || statusRetryTimer !== null) {
        return;
      }
      statusRetryIndex += 1;
      statusRetryTimer = setTimeout(() => {
        statusRetryTimer = null;
        refetch();
      }, delay);
    }

    function refetch(): void {
      const request = ++sequence;
      context.git.getStatus(root).then(
        (next) => {
          if (request === sequence) {
            apply(next);
          }
        },
        () => {
          if (alive && request === sequence) {
            setState({ kind: "error", retry });
            scheduleStatusRetry();
          }
        }
      );
    }

    function scheduleWatchRetry(): void {
      const delay = RETRY_DELAYS_MS[watchRetryIndex];
      if (delay === undefined || watchRetryTimer !== null) {
        return;
      }
      watchRetryIndex += 1;
      watchRetryTimer = setTimeout(() => {
        watchRetryTimer = null;
        startWatch();
      }, delay);
    }

    function startWatch(): void {
      unsubscribeWatch();
      unsubscribeWatch = () => undefined;
      const attempt = ++watchAttempt;
      watchReady = true;
      let failedSynchronously = false;
      try {
        const unsubscribe = context.git.watch(
          root,
          (event) => {
            if (!(alive && attempt === watchAttempt)) {
              return;
            }
            watchReady = true;
            watchRetryIndex = 0;
            watchRetryTimer = clearTimer(watchRetryTimer);
            if (event.status) {
              sequence += 1;
              apply(event.status);
            } else {
              refetch();
            }
          },
          () => {
            if (!(alive && attempt === watchAttempt)) {
              return;
            }
            failedSynchronously = true;
            watchReady = false;
            unsubscribeWatch();
            unsubscribeWatch = () => undefined;
            setState({ kind: "error", retry });
            scheduleWatchRetry();
          }
        );
        if (failedSynchronously) {
          unsubscribe();
          return;
        }
        unsubscribeWatch = unsubscribe;
      } catch {
        watchReady = false;
        setState({ kind: "error", retry });
        scheduleWatchRetry();
        return;
      }
      refetch();
    }

    setState({ kind: "loading" });
    startWatch();
    return () => {
      alive = false;
      sequence += 1;
      statusRetryTimer = clearTimer(statusRetryTimer);
      watchRetryTimer = clearTimer(watchRetryTimer);
      unsubscribeWatch();
    };
  }, [context, gitRoot]);

  return state;
}
