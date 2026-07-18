export interface AppUpdateScheduler {
  onFocusGained(): void;
  start(): void;
  stop(): void;
}

export interface CreateAppUpdateSchedulerOptions {
  readonly check: () => Promise<unknown>;
  readonly clearTimeout?: typeof clearTimeout;
  readonly enabled: boolean;
  /** Default 30s. */
  readonly initialDelayMs?: number;
  /** Default 24h. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly setTimeout?: typeof setTimeout;
}

const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function createAppUpdateScheduler(
  options: CreateAppUpdateSchedulerOptions
): AppUpdateScheduler {
  if (!options.enabled) {
    return {
      onFocusGained() {
        /* no-op */
      },
      start() {
        /* no-op */
      },
      stop() {
        /* no-op */
      },
    };
  }

  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;

  let started = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCheckAt = 0;
  let checkInFlight: Promise<unknown> | null = null;

  function clearTimers(): void {
    if (initialTimer !== null) {
      cancel(initialTimer);
      initialTimer = null;
    }
    if (intervalTimer !== null) {
      cancel(intervalTimer);
      intervalTimer = null;
    }
  }

  function armInterval(): void {
    if (intervalTimer !== null) {
      cancel(intervalTimer);
    }
    intervalTimer = schedule(() => {
      runCheck()
        .catch(() => undefined)
        .finally(() => {
          if (started) {
            armInterval();
          }
        });
    }, intervalMs);
  }

  function runCheck(): Promise<unknown> {
    if (checkInFlight) {
      return checkInFlight;
    }
    lastCheckAt = now();
    checkInFlight = Promise.resolve()
      .then(() => options.check())
      .catch(() => undefined)
      .finally(() => {
        checkInFlight = null;
      });
    return checkInFlight;
  }

  return {
    onFocusGained() {
      if (!started) {
        return;
      }
      if (now() - lastCheckAt < intervalMs) {
        return;
      }
      runCheck().catch(() => undefined);
    },
    start() {
      if (started) {
        return;
      }
      started = true;
      initialTimer = schedule(() => {
        initialTimer = null;
        runCheck()
          .catch(() => undefined)
          .finally(() => {
            if (started) {
              armInterval();
            }
          });
      }, initialDelayMs);
    },
    stop() {
      started = false;
      clearTimers();
      checkInFlight = null;
    },
  };
}
