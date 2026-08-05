/**
 * Max concurrent agent install/update runs (main runMany + renderer batch UI).
 * Keep one constant so both layers stay aligned.
 */
export const AGENT_LIFECYCLE_BATCH_CONCURRENCY = 3;
