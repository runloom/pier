/** Shared AbortSignal helpers for multi-hop remote (or local RPC) work. */

export function createTimeoutSignal(ms: number): AbortSignal | null {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(ms);
  }
  return null;
}

export function mergeAbortSignals(
  signals: readonly (AbortSignal | null | undefined)[]
): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal =>
    Boolean(signal)
  );
  if (active.length === 0) {
    return new AbortController().signal;
  }
  if (active.length === 1) {
    return active[0] ?? new AbortController().signal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }
  return active[0] ?? new AbortController().signal;
}

export function isTimeoutOrAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return /timeout|aborted/i.test(String(error));
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }
  return /timeout|aborted/i.test(error.message);
}
