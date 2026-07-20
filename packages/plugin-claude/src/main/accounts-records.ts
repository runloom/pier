import type { AccountIdentity } from "./identity.ts";
import type { ClaudeAccountRecord } from "./state.ts";

export function buildAccountRecord(
  identity: AccountIdentity,
  id: string,
  now: number
): ClaudeAccountRecord {
  return {
    createdAt: now,
    email: identity.email,
    id,
    provider: "claude",
    providerAccountId: identity.providerAccountId,
    updatedAt: now,
    ...(identity.organizationName
      ? { organizationName: identity.organizationName }
      : {}),
    ...(identity.subscriptionType
      ? { subscriptionType: identity.subscriptionType }
      : {}),
  };
}

export function mergeIdentityIntoAccount(
  account: ClaudeAccountRecord,
  identity: AccountIdentity,
  now: number
): ClaudeAccountRecord {
  const {
    organizationName: _prevOrg,
    subscriptionType: _prevSub,
    ...retained
  } = account;
  return {
    ...retained,
    email: identity.email,
    providerAccountId: identity.providerAccountId,
    updatedAt: now,
    ...(identity.organizationName
      ? { organizationName: identity.organizationName }
      : {}),
    ...(identity.subscriptionType
      ? { subscriptionType: identity.subscriptionType }
      : {}),
  };
}

export function accountLabel(account: ClaudeAccountRecord): string {
  if (account.email && account.email.length > 0) {
    return account.email;
  }
  return account.id;
}
