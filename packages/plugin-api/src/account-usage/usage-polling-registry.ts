/**
 * Main-process registry for renderer usage-polling leases.
 *
 * Renderer consumers acquire a lease while a settings page / widget is
 * visible and renew it with a heartbeat. Entries that miss their heartbeats
 * (window reload, renderer crash — unmount effects never ran) expire after
 * `USAGE_POLLING_LEASE_TTL_MS`, so background polling cannot leak forever.
 */

export const USAGE_POLLING_HEARTBEAT_MS = 5 * 60 * 1000;

/** Survives two missed heartbeats plus scheduling jitter. */
export const USAGE_POLLING_LEASE_TTL_MS =
  USAGE_POLLING_HEARTBEAT_MS * 3 + 60_000;

export interface UsagePollingRegistry {
  /**
   * Register (or renew) a consumer lease. Returns `firstConsumer: true` when
   * the registry had no live consumers before this call, so the caller can
   * kick an immediate refresh.
   */
  acquire(consumerId: string): { firstConsumer: boolean };
  clear(): void;
  hasVisibleTarget(): boolean;
  release(consumerId: string): void;
}

export function createUsagePollingRegistry(
  now: () => number = Date.now
): UsagePollingRegistry {
  const lastSeen = new Map<string, number>();

  function prune(): void {
    const cutoff = now() - USAGE_POLLING_LEASE_TTL_MS;
    for (const [consumerId, seenAt] of lastSeen) {
      if (seenAt < cutoff) {
        lastSeen.delete(consumerId);
      }
    }
  }

  return {
    acquire(consumerId) {
      prune();
      const firstConsumer = lastSeen.size === 0;
      lastSeen.set(consumerId, now());
      return { firstConsumer };
    },
    clear() {
      lastSeen.clear();
    },
    hasVisibleTarget() {
      prune();
      return lastSeen.size > 0;
    },
    release(consumerId) {
      lastSeen.delete(consumerId);
    },
  };
}
