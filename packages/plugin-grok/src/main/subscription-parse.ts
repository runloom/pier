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
    .replace(/^GROK_/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
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
    const planType = normalizePlanType(row.tier);
    if (!planType) continue;
    const status = normalizeStatus(row.status) ?? "unknown";
    const google = asRecord(row.google);
    const expiresAt =
      parseIsoMs(row.billingPeriodEnd) ?? parseIsoMs(google?.expiryTime);
    const offer = asRecord(row.activeOffer);
    const isTrial =
      typeof offer?.type === "string" &&
      offer.type.toUpperCase().includes("FREE_TRIAL");
    const trialEndsAt = isTrial ? parseIsoMs(offer?.offerEnd) : undefined;
    const cancelAtPeriodEnd =
      typeof row.cancelAtPeriodEnd === "boolean"
        ? row.cancelAtPeriodEnd
        : undefined;

    const candidate: GrokSubscriptionInfo = {
      planType,
      status,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(cancelAtPeriodEnd === undefined ? {} : { cancelAtPeriodEnd }),
      ...(trialEndsAt === undefined ? {} : { trialEndsAt }),
    };
    const rank = statusRank(status);
    if (!best || rank < bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}
