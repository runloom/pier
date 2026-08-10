/** Cold first-open deep paths need several listing + layout passes. */
export const REVEAL_RETRY_DELAYS_MS = [
  0, 32, 80, 160, 320, 640, 1200, 2000, 3200,
] as const;

/**
 * After a successful scrolled reveal, keep path-sync compensate suppressed
 * until render/list churn settles. Resets on each renderSignature while idle.
 */
export const POST_SUCCESS_IDLE_RELEASE_MS = 300;

/**
 * Hard cap so reveal hold cannot leak. Gold standard: short (was 2500).
 */
export const POST_SUCCESS_MAX_HOLD_MS = 800;
