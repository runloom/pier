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
  // Prefer identity plan when present; otherwise keep the previous plan so a
  // partial JWT (no auth claims) does not wipe a known plan on soft refresh.
  const nextPlanType = identity.planType ?? account.planType;
  const isFree = nextPlanType?.toLowerCase() === "free";
  // Paid expiry: take identity's value when provided; drop it on free; keep the
  // previous paid expiry only when the account remains non-free.
  let nextExpires: number | undefined;
  if (isFree) {
    nextExpires = undefined;
  } else if (identity.subscriptionExpiresAt === undefined) {
    nextExpires = account.subscriptionExpiresAt;
  } else {
    nextExpires = identity.subscriptionExpiresAt;
  }
  const {
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
    ...(nextExpires === undefined
      ? {}
      : { subscriptionExpiresAt: nextExpires }),
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
  const isFree = normalized.toLowerCase() === "free";
  // Plan switch (pro→plus, free→pro, …) invalidates the previous paid period.
  // Keep expiry only when the live plan label is unchanged and still paid.
  const planChanged =
    (account.planType ?? "").toLowerCase() !== normalized.toLowerCase();
  const nextExpires =
    isFree || planChanged ? undefined : account.subscriptionExpiresAt;
  if (
    account.planType === normalized &&
    account.subscriptionExpiresAt === nextExpires
  ) {
    return account;
  }
  const {
    planType: _previousPlanType,
    subscriptionExpiresAt: _previousSubscriptionExpiresAt,
    ...retained
  } = account;
  return {
    ...retained,
    updatedAt: now,
    planType: normalized,
    ...(nextExpires === undefined
      ? {}
      : { subscriptionExpiresAt: nextExpires }),
  };
}
