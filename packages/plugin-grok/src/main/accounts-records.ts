import type { AccountIdentity } from "./identity.ts";
import type { GrokAccountRecord } from "./state.ts";
import type { GrokSubscriptionInfo } from "./subscription-parse.ts";

export function buildOidcAccountRecord(
  identity: AccountIdentity,
  id: string,
  now: number,
  lastAuthenticatedAt?: number
): GrokAccountRecord {
  return {
    createdAt: now,
    email: identity.email,
    id,
    kind: "oidc",
    provider: "grok",
    providerAccountId: identity.providerAccountId,
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(identity.teamId ? { teamId: identity.teamId } : {}),
  };
}

export function buildApiKeyAccountRecord(
  id: string,
  label: string,
  now: number
): GrokAccountRecord {
  return {
    createdAt: now,
    id,
    kind: "api_key",
    label,
    lastAuthenticatedAt: now,
    provider: "grok",
    providerAccountId: `api-key:${id}`,
    updatedAt: now,
  };
}

export function mergeIdentityIntoAccount(
  account: GrokAccountRecord,
  identity: AccountIdentity,
  now: number,
  lastAuthenticatedAt?: number
): GrokAccountRecord {
  return {
    ...account,
    email: identity.email,
    kind: "oidc",
    providerAccountId: identity.providerAccountId,
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(identity.teamId ? { teamId: identity.teamId } : {}),
  };
}

export function applySubscriptionToAccount(
  account: GrokAccountRecord,
  subscription: GrokSubscriptionInfo,
  now: number
): GrokAccountRecord {
  const previous = account.subscription;
  const same =
    previous &&
    previous.planType === subscription.planType &&
    previous.status === subscription.status &&
    previous.expiresAt === subscription.expiresAt &&
    previous.trialEndsAt === subscription.trialEndsAt &&
    previous.cancelAtPeriodEnd === subscription.cancelAtPeriodEnd;
  if (same) return account;
  return {
    ...account,
    subscription: {
      planType: subscription.planType,
      status: subscription.status,
      ...(subscription.expiresAt === undefined
        ? {}
        : { expiresAt: subscription.expiresAt }),
      ...(subscription.trialEndsAt === undefined
        ? {}
        : { trialEndsAt: subscription.trialEndsAt }),
      ...(subscription.cancelAtPeriodEnd === undefined
        ? {}
        : { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd }),
    },
    updatedAt: now,
  };
}

export function accountLabel(account: GrokAccountRecord): string {
  if (account.email && account.email.length > 0) {
    return account.email;
  }
  if (account.label && account.label.length > 0) {
    return account.label;
  }
  return account.id;
}
