/**
 * Multi-hop remote fetch budget policy.
 *
 * Contract:
 * - Budget each hop; never wrap an entire multi-hop path in one short timeout.
 * - overall ≥ sum of declared hop budgets for the worst path.
 * - retry overall is shorter (warm path after first attempt).
 */

export interface MultiHopBudgetPolicy {
  readonly hopTimeoutMs: Readonly<Record<string, number>>;
  readonly overallDeadlineMs: number;
  readonly retryOverallDeadlineMs: number;
}

export function createMultiHopBudgetPolicy(options: {
  hopTimeoutMs: Record<string, number>;
  overallDeadlineMs: number;
  retryOverallDeadlineMs: number;
  /** Ordered hop ids that define the worst-case path for the overall floor. */
  worstPathHopIds: readonly string[];
}): MultiHopBudgetPolicy {
  const worstPathMs = options.worstPathHopIds.reduce((sum, id) => {
    const hop = options.hopTimeoutMs[id];
    if (hop === undefined) {
      throw new Error(`multi-hop budget missing hop timeout for "${id}"`);
    }
    return sum + hop;
  }, 0);
  if (options.overallDeadlineMs < worstPathMs) {
    throw new Error(
      `overallDeadlineMs (${options.overallDeadlineMs}) must be >= worst path (${worstPathMs})`
    );
  }
  const minRetry = Math.min(...Object.values(options.hopTimeoutMs));
  if (options.retryOverallDeadlineMs < minRetry) {
    throw new Error(
      `retryOverallDeadlineMs (${options.retryOverallDeadlineMs}) must cover at least one hop (${minRetry})`
    );
  }
  return {
    hopTimeoutMs: { ...options.hopTimeoutMs },
    overallDeadlineMs: options.overallDeadlineMs,
    retryOverallDeadlineMs: options.retryOverallDeadlineMs,
  };
}

export function assertMultiHopBudget(policy: MultiHopBudgetPolicy): void {
  const hops = Object.values(policy.hopTimeoutMs);
  if (hops.length === 0) {
    throw new Error("multi-hop budget requires at least one hop");
  }
  if (policy.overallDeadlineMs < Math.max(...hops)) {
    throw new Error("overall deadline shorter than a single hop");
  }
  if (policy.retryOverallDeadlineMs < Math.min(...hops)) {
    throw new Error("retry deadline shorter than the smallest hop");
  }
}
