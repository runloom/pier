/**
 * Shared account-usage runtime for official account plugins (Codex, Grok, …).
 * Prefer these primitives over per-plugin copies.
 */

export {
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
} from "./abort-signals.ts";
export {
  type SuppressedDriftWatchOptions,
  startSuppressedDriftWatch,
} from "./drift-watch.ts";
export { createInflightCoalescer } from "./inflight-coalescer.ts";
export {
  assertMultiHopBudget,
  createMultiHopBudgetPolicy,
  type MultiHopBudgetPolicy,
} from "./multi-hop-budget.ts";
export {
  createUsageRefreshScheduler,
  USAGE_REFRESH_CONCURRENCY,
  type UsageRefreshSchedulerOptions,
} from "./refresh-scheduler.ts";
export {
  activeUsageCacheKey,
  createUsageCacheEntry,
  SYSTEM_USAGE_CACHE_KEY,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntryBase,
  type UsageResultBase,
} from "./usage-cache.ts";
export {
  createUsagePollingRegistry,
  USAGE_POLLING_HEARTBEAT_MS,
  USAGE_POLLING_LEASE_TTL_MS,
  type UsagePollingRegistry,
} from "./usage-polling-registry.ts";
export { withOneRetry } from "./with-one-retry.ts";
