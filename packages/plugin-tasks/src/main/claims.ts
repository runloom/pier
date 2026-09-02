/**
 * Single-executor gate for plugin renderer events. Plugin events broadcast to
 * every Pier window (rpc-bus fans out before pluginId filtering), but side
 * effects like creating a working tree or posting a notification must run
 * exactly once. Main issues a claim id per event; each window races
 * `work.claim` and only the winner executes.
 */
export interface WorkClaimRegistry {
  /** First caller wins; repeated or empty ids are rejected. */
  claimOnce(claimId: string): boolean;
  issue(): string;
}

export function createWorkClaimRegistry(input?: {
  capacity?: number;
}): WorkClaimRegistry {
  const capacity = input?.capacity ?? 256;
  const consumed = new Set<string>();
  let counter = 0;
  return {
    claimOnce(claimId) {
      if (claimId.length === 0 || consumed.has(claimId)) {
        return false;
      }
      consumed.add(claimId);
      // Leak guard only — evicted ids could theoretically be re-claimed, but
      // claims are consumed within milliseconds of being issued.
      while (consumed.size > capacity) {
        const oldest = consumed.values().next().value;
        if (oldest === undefined) {
          break;
        }
        consumed.delete(oldest);
      }
      return true;
    },
    issue() {
      counter += 1;
      return `claim-${Date.now().toString(36)}-${counter.toString(36)}`;
    },
  };
}
