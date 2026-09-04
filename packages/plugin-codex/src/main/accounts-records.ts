import type { AccountIdentity } from "./identity.ts";
import type { CodexAccountRecord } from "./state.ts";

/**
 * 从登录身份构造新的 codex 账号记录。doAdoptCurrent / doAdd 共用,
 * 保证两处 record 形状一致(createdAt / updatedAt / provider / 可选 planType /
 * providerAccountId / subscriptionExpiresAt;doAdd 额外带 lastAuthenticatedAt)。
 */
export function buildAccountRecord(
  identity: AccountIdentity,
  id: string,
  now: number,
  lastAuthenticatedAt?: number
): CodexAccountRecord {
  return {
    createdAt: now,
    email: identity.email,
    id,
    provider: "codex",
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(identity.planType ? { planType: identity.planType } : {}),
    ...(identity.providerAccountId
      ? { providerAccountId: identity.providerAccountId }
      : {}),
    ...(identity.subscriptionExpiresAt === undefined
      ? {}
      : { subscriptionExpiresAt: identity.subscriptionExpiresAt }),
  };
}

/**
 * 把登录身份合并进已有账号记录。doAdoptCurrent / doAdd 的 existing 分支共用,
 * 保证更新字段一致(email / updatedAt / 可选 planType / providerAccountId /
 * subscriptionExpiresAt;doAdd 额外刷新 lastAuthenticatedAt)。
 */
export function mergeIdentityIntoAccount(
  account: CodexAccountRecord,
  identity: AccountIdentity,
  now: number,
  lastAuthenticatedAt?: number
): CodexAccountRecord {
  const nextPlanType = resolveIdentityPlanType(account, identity);
  const isFree = nextPlanType?.toLowerCase() === "free";
  // JWT chatgpt_subscription_active_until lags after renewal. Once a live
  // accounts/check bit exists, keep that period-end; identity only backfills
  // expiry when membership has never been resolved.
  let nextExpires: number | undefined;
  if (isFree) {
    nextExpires = undefined;
  } else if (account.hasActiveSubscription !== undefined) {
    nextExpires = account.subscriptionExpiresAt;
  } else if (identity.subscriptionExpiresAt === undefined) {
    nextExpires = account.subscriptionExpiresAt;
  } else {
    nextExpires = identity.subscriptionExpiresAt;
  }
  const {
    hasActiveSubscription: _previousHasActive,
    planType: _previousPlanType,
    subscriptionExpiresAt: _previousSubscriptionExpiresAt,
    ...retained
  } = account;
  return {
    ...retained,
    email: identity.email,
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(nextPlanType ? { planType: nextPlanType } : {}),
    ...(identity.providerAccountId
      ? { providerAccountId: identity.providerAccountId }
      : {}),
    ...(isFree || account.hasActiveSubscription === undefined
      ? {}
      : { hasActiveSubscription: account.hasActiveSubscription }),
    ...(nextExpires === undefined
      ? {}
      : { subscriptionExpiresAt: nextExpires }),
  };
}

function resolveIdentityPlanType(
  account: CodexAccountRecord,
  identity: AccountIdentity
): string | undefined {
  const identityPlan = identity.planType?.toLowerCase();
  const currentPlan = account.planType?.toLowerCase();
  if (identityPlan === "free") return identity.planType;
  // Live accounts/check already named the SKU; JWT chatgpt_plan_type is
  // a broad "pro" and must not overwrite it on the pre-usage identity pass.
  if (account.hasActiveSubscription !== undefined) return account.planType;
  if (
    identityPlan === "pro" &&
    (currentPlan === "pro-5x" || currentPlan === "pro-20x")
  ) {
    return account.planType;
  }
  return identity.planType ?? account.planType;
}

function futureTimestamp(
  value: number | undefined,
  now: number
): number | undefined {
  return value !== undefined && value > now ? value : undefined;
}

function replaceMembershipFields(
  account: CodexAccountRecord,
  next: {
    hasActiveSubscription?: boolean;
    planType: string;
    subscriptionExpiresAt?: number;
  },
  now: number
): CodexAccountRecord {
  if (
    account.planType === next.planType &&
    account.subscriptionExpiresAt === next.subscriptionExpiresAt &&
    account.hasActiveSubscription === next.hasActiveSubscription
  ) {
    return account;
  }
  const {
    hasActiveSubscription: _previousHasActive,
    planType: _previousPlanType,
    subscriptionExpiresAt: _previousSubscriptionExpiresAt,
    ...retained
  } = account;
  return {
    ...retained,
    planType: next.planType,
    updatedAt: now,
    ...(next.hasActiveSubscription === undefined
      ? {}
      : { hasActiveSubscription: next.hasActiveSubscription }),
    ...(next.subscriptionExpiresAt === undefined
      ? {}
      : { subscriptionExpiresAt: next.subscriptionExpiresAt }),
  };
}

/**
 * Prefer the live plan from account/rateLimits/read over a possibly stale JWT
 * claim. Free plans drop any leftover paid subscriptionExpiresAt.
 */
export function applyLivePlanType(
  account: CodexAccountRecord,
  planType: string,
  now: number
): CodexAccountRecord {
  const normalized = planType.trim();
  if (normalized.length === 0) return account;
  const currentPlan = account.planType?.toLowerCase();
  const keepPreciseSku =
    normalized.toLowerCase() === "pro" &&
    (currentPlan === "pro-5x" || currentPlan === "pro-20x");
  const nextPlan = keepPreciseSku
    ? (account.planType ?? currentPlan)
    : normalized;
  const isFree = nextPlan.toLowerCase() === "free";
  // Plan switch (pro→plus, free→pro, …) invalidates the previous paid period.
  // A wham plan_type is not a live entitlement: do not set or clear
  // hasActiveSubscription except when the live plan is free.
  const planChanged =
    !keepPreciseSku &&
    (account.planType ?? "").toLowerCase() !== nextPlan.toLowerCase();
  const nextActive = isFree ? undefined : account.hasActiveSubscription;
  let nextExpires: number | undefined;
  if (isFree || planChanged) {
    nextExpires = undefined;
  } else if (account.hasActiveSubscription === false) {
    nextExpires = account.subscriptionExpiresAt;
  } else {
    nextExpires = futureTimestamp(account.subscriptionExpiresAt, now);
  }
  return replaceMembershipFields(
    account,
    {
      planType: nextPlan,
      ...(nextActive === undefined
        ? {}
        : { hasActiveSubscription: nextActive }),
      ...(nextExpires === undefined
        ? {}
        : { subscriptionExpiresAt: nextExpires }),
    },
    now
  );
}

export function applyLiveMembership(
  account: CodexAccountRecord,
  membership: {
    expiresAt?: number;
    hasActiveSubscription?: boolean;
    planType: string;
  },
  now: number
): CodexAccountRecord {
  const normalized = membership.planType.trim();
  if (normalized.length === 0) return account;
  const isFree = normalized.toLowerCase() === "free";
  const hasActiveSubscription = isFree
    ? undefined
    : membership.hasActiveSubscription;
  let expiresAt: number | undefined;
  if (isFree) {
    expiresAt = undefined;
  } else if (hasActiveSubscription === false) {
    expiresAt = membership.expiresAt;
  } else {
    expiresAt = futureTimestamp(membership.expiresAt, now);
  }
  return replaceMembershipFields(
    account,
    {
      planType: normalized,
      ...(hasActiveSubscription === undefined ? {} : { hasActiveSubscription }),
      ...(expiresAt === undefined ? {} : { subscriptionExpiresAt: expiresAt }),
    },
    now
  );
}
