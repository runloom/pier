/** Normalized account membership shared by official account plugins. */
export type AccountMembershipStatus =
  | "active"
  | "canceled"
  | "expired"
  | "free"
  | "unknown";

export interface AccountMembershipSnapshot {
  cancelAtPeriodEnd?: boolean;
  expiresAt?: number;
  status: AccountMembershipStatus;
  tier: string;
  trialEndsAt?: number;
  updatedAt: number;
}

export type AccountMembershipValue = Omit<
  AccountMembershipSnapshot,
  "updatedAt"
>;

export type MembershipFetchResult =
  | {
      membership: AccountMembershipValue;
      status: "ok";
    }
  | {
      error: string;
      status: "error";
    };

export interface MembershipCacheEntry {
  attemptedAt: number;
  error?: string;
  membership?: AccountMembershipSnapshot;
  status: "error" | "ok";
  updatedAt?: number;
}

/**
 * A failed attempt never destroys the last authoritative membership. A
 * successful `free` result is authoritative and therefore replaces paid data.
 */
export function createMembershipCacheEntry(
  result: MembershipFetchResult,
  cached: MembershipCacheEntry | undefined,
  attemptedAt: number
): MembershipCacheEntry {
  if (result.status === "ok") {
    return {
      attemptedAt,
      membership: { ...result.membership, updatedAt: attemptedAt },
      status: "ok",
      updatedAt: attemptedAt,
    };
  }
  return {
    attemptedAt,
    error: result.error,
    ...(cached?.membership ? { membership: cached.membership } : {}),
    status: "error",
    ...(cached?.updatedAt === undefined ? {} : { updatedAt: cached.updatedAt }),
  };
}
