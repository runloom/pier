export interface GrokSubscriptionInfo {
  cancelAtPeriodEnd?: boolean;
  expiresAt?: number;
  planType: string;
  status: "active" | "canceled" | "expired" | "none" | "unknown";
  trialEndsAt?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseIsoMs(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function normalizePlanType(tier: unknown): string | null {
  if (typeof tier !== "string" || tier.length === 0) return null;
  let value = tier.trim();
  if (value.length === 0) return null;
  const upper = value.toUpperCase();
  if (upper.startsWith("SUBSCRIPTION_TIER_")) {
    value = value.slice("SUBSCRIPTION_TIER_".length);
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/^GROK_/i, "")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isFreePlan(planType: string): boolean {
  return planType === "free" || planType === "none";
}

export function parseGrokUserSubscriptionResult(
  payload: unknown
): GrokSubscriptionInfo | null {
  const root = asRecord(payload);
  const user = asRecord(root?.user) ?? root;
  if (!user) return null;
  const tier =
    user.subscriptionTier === undefined
      ? user.subscription_tier
      : user.subscriptionTier;
  // /user?include=subscription returns null (or an empty string) when no
  // subscription remains. Keep that distinct from a missing/malformed field
  // so a successful downgrade clears a previously saved paid membership.
  if (tier === null || tier === "") {
    return { planType: "free", status: "none" };
  }
  const planType = normalizePlanType(tier);
  // Live `subscriptionTier` is the current SKU. Nested `subscription` is the
  // last billed row and can still name SuperGrok after a free downgrade.
  if (planType && isFreePlan(planType)) {
    return { planType: "free", status: "none" };
  }
  const nested = asRecord(user.subscription) ?? asRecord(root?.subscription);
  if (nested) {
    const parsed = parseSubscriptionRow(nested);
    if (parsed) return parsed;
  }
  if (!planType) return null;
  return {
    planType,
    status: "active",
  };
}

function normalizeStatus(
  status: unknown
): GrokSubscriptionInfo["status"] | null {
  if (typeof status !== "string" || status.length === 0) return null;
  let value = status.trim().toUpperCase();
  if (value.startsWith("SUBSCRIPTION_STATUS_")) {
    value = value.slice("SUBSCRIPTION_STATUS_".length);
  }
  switch (value) {
    case "ACTIVE":
      return "active";
    case "CANCELED":
    case "CANCELLED":
      return "canceled";
    case "EXPIRED":
    case "INACTIVE":
      return "expired";
    case "NONE":
      return "none";
    default:
      return "unknown";
  }
}

function statusRank(status: GrokSubscriptionInfo["status"]): number {
  switch (status) {
    case "active":
      return 0;
    case "canceled":
      return 1;
    case "expired":
      return 2;
    case "unknown":
      return 3;
    case "none":
      return 4;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function subscriptionExpiresAt(
  row: Record<string, unknown>
): number | undefined {
  const google = asRecord(row.google);
  const apple = asRecord(row.apple);
  const billingEnd = parseIsoMs(row.billingPeriodEnd);
  const googleExpiry = parseIsoMs(google?.expiryTime);
  const appleExpiry =
    parseIsoMs(apple?.expiresDate) ?? parseIsoMs(apple?.expiryTime);
  // Play/App Store entitlement end is the access boundary once auto-renew is
  // off. billingPeriodEnd can still sit on the next cycle and look "current".
  const autoRenewOff =
    google?.autoRenewEnabled === false || apple?.autoRenewEnabled === false;
  if (autoRenewOff) {
    return googleExpiry ?? appleExpiry ?? billingEnd;
  }
  return billingEnd ?? googleExpiry ?? appleExpiry;
}

function parseSubscriptionRow(
  row: Record<string, unknown>
): GrokSubscriptionInfo | null {
  const planType =
    normalizePlanType(row.tier) ??
    normalizePlanType(row.planType) ??
    normalizePlanType(row.subscriptionTier);
  if (!planType) return null;
  if (isFreePlan(planType)) {
    return { planType: "free", status: "none" };
  }
  const status =
    normalizeStatus(row.status) ?? normalizeStatus(row.state) ?? "unknown";
  const expiresAt = subscriptionExpiresAt(row);
  const offer = asRecord(row.activeOffer);
  const isTrial =
    typeof offer?.type === "string" &&
    offer.type.toUpperCase().includes("FREE_TRIAL");
  const trialEndsAt = isTrial ? parseIsoMs(offer?.offerEnd) : undefined;
  const cancelAtPeriodEnd =
    typeof row.cancelAtPeriodEnd === "boolean"
      ? row.cancelAtPeriodEnd
      : undefined;
  return {
    planType,
    status,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(cancelAtPeriodEnd === undefined ? {} : { cancelAtPeriodEnd }),
    ...(trialEndsAt === undefined ? {} : { trialEndsAt }),
  };
}

/**
 * Apply wall-clock to a membership DTO. A paid row whose period already ended
 * is expired even if the vendor still labels it ACTIVE.
 */
export function applyMembershipClock(
  info: GrokSubscriptionInfo,
  now: number
): GrokSubscriptionInfo {
  if (info.status === "none" || isFreePlan(info.planType)) {
    return { planType: "free", status: "none" };
  }
  if (info.expiresAt !== undefined && info.expiresAt <= now) {
    return { ...info, status: "expired" };
  }
  return info;
}

/** True when the account still has paid access right now. */
export function isLivePaidMembership(
  info: GrokSubscriptionInfo,
  now: number
): boolean {
  const current = applyMembershipClock(info, now);
  if (current.status === "active") return true;
  return (
    current.status === "canceled" &&
    current.expiresAt !== undefined &&
    current.expiresAt > now
  );
}

/**
 * Combine grok.com/rest/subscriptions with the live `/user` tier.
 * Live free/expired is current entitlement; the listing can still hold a
 * SuperGrok row with a future billingPeriodEnd after access has ended.
 */
export function resolveGrokMembership(
  listed: GrokSubscriptionInfo | null,
  live: GrokSubscriptionInfo | null,
  now: number
): GrokSubscriptionInfo | null {
  const listedNow = listed ? applyMembershipClock(listed, now) : null;
  const liveNow = live ? applyMembershipClock(live, now) : null;

  if (liveNow && (liveNow.status === "none" || isFreePlan(liveNow.planType))) {
    return { planType: "free", status: "none" };
  }
  if (liveNow?.status === "expired") {
    return liveNow;
  }
  if (listedNow && isLivePaidMembership(listedNow, now)) {
    return listedNow;
  }
  if (liveNow && isLivePaidMembership(liveNow, now)) {
    if (listedNow?.status === "expired" && liveNow.expiresAt === undefined) {
      return listedNow;
    }
    return liveNow;
  }
  return listedNow ?? liveNow;
}

/**
 * Map grok.com/rest/subscriptions JSON into a compact account membership DTO.
 * Soft-fails with null on unusable payloads so callers can omit membership.
 */
export function parseGrokSubscriptionResult(
  payload: unknown
): GrokSubscriptionInfo | null {
  const root = asRecord(payload);
  if (!(root && Array.isArray(root.subscriptions))) {
    return null;
  }
  if (root.subscriptions.length === 0) {
    return { planType: "free", status: "none" };
  }

  let best: GrokSubscriptionInfo | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const item of root.subscriptions) {
    const row = asRecord(item);
    if (!row) continue;
    const candidate = parseSubscriptionRow(row);
    if (!candidate) continue;
    const rank = statusRank(candidate.status);
    if (!best || rank < bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}
