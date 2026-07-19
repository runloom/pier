/**
 * External-auth drift watch with write-suppression that defers instead of
 * dropping (shared by the official account plugins).
 *
 * Plugin self-writes set a suppression window so the watcher does not react
 * to them. An *external* write that lands inside that window must still be
 * processed — otherwise a real external login is never adopted and a later
 * account switch overwrites it — so suppressed events schedule a single
 * re-check for just after the window closes.
 */
export interface SuppressedDriftWatchOptions {
  /** Runs the drift check on the plugin's serial mutation queue. */
  enqueueDriftCheck(check: () => Promise<void>): Promise<void>;
  getSuppressUntil(): number;
  handleDrift(): Promise<void>;
  isDisposed(): boolean;
  now(): number;
  /** provider.watchExternalAuth */
  watchExternalAuth(callback: () => void): () => void;
}

export function startSuppressedDriftWatch(
  options: SuppressedDriftWatchOptions
): () => void {
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSuppressedRecheck = (): void => {
    if (recheckTimer !== null || options.isDisposed()) return;
    const delay = Math.max(0, options.getSuppressUntil() - options.now()) + 50;
    recheckTimer = setTimeout(() => {
      recheckTimer = null;
      if (options.isDisposed()) return;
      runDriftCheck();
    }, delay);
  };

  const runDriftCheck = (): void => {
    options
      .enqueueDriftCheck(async () => {
        if (options.now() < options.getSuppressUntil()) {
          scheduleSuppressedRecheck();
          return;
        }
        await options.handleDrift();
      })
      .catch(() => {
        /* fire-and-forget; drift errors surface via snapshots */
      });
  };

  const disposeWatch = options.watchExternalAuth(() => {
    if (options.isDisposed()) return;
    if (options.now() < options.getSuppressUntil()) {
      scheduleSuppressedRecheck();
      return;
    }
    runDriftCheck();
  });

  return () => {
    if (recheckTimer !== null) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
    disposeWatch();
  };
}
