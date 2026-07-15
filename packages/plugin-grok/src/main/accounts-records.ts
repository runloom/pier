import type { AccountIdentity } from "./identity.ts";
import type { GrokAccountRecord } from "./state.ts";

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

export function accountLabel(account: GrokAccountRecord): string {
  if (account.email && account.email.length > 0) {
    return account.email;
  }
  if (account.label && account.label.length > 0) {
    return account.label;
  }
  return account.id;
}
