export interface CodexMembershipInfo {
  expiresAt?: number;
  hasActiveSubscription?: boolean;
  planType: string;
}

type CodexMembershipSource = "entitlement" | "subscription" | "usage";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeCodexMembershipTier(
  value: unknown,
  source: CodexMembershipSource
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (
    key === "chatgptprolite" ||
    key === "prolite" ||
    key === "pro5x" ||
    key === "codexpro5x"
  ) {
    return "pro-5x";
  }
  if (
    key === "chatgptpro" ||
    key === "promax" ||
    key === "pro20x" ||
    key === "codexpro20x"
  ) {
    return source === "usage" && key === "chatgptpro" ? "pro" : "pro-20x";
  }
  const known: Record<string, string> = {
    business: "business",
    chatgptbusiness: "business",
    chatgptedu: "edu",
    chatgptenterprise: "enterprise",
    chatgptfree: "free",
    chatgptgo: "go",
    chatgptplus: "plus",
    edu: "edu",
    enterprise: "enterprise",
    free: "free",
    go: "go",
    plus: "plus",
    pro: "pro",
    team: "business",
  };
  return (
    known[key] ??
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
  );
}

function resolveAccountCheckRow(
  accounts: Record<string, unknown>,
  accountId: string
): Record<string, unknown> | null {
  const direct = asRecord(accounts[accountId]);
  if (direct) return direct;
  for (const [key, value] of Object.entries(accounts)) {
    if (key === "default") continue;
    const row = asRecord(value);
    const innerId = asRecord(row?.account)?.account_id;
    if (innerId === accountId) return row;
  }
  return null;
}

function membershipFromEntitlement(
  entitlement: Record<string, unknown> | null,
  account: Record<string, unknown> | null,
  planType: string
): CodexMembershipInfo {
  const hasActive =
    typeof entitlement?.has_active_subscription === "boolean"
      ? entitlement.has_active_subscription
      : undefined;
  // Auto-renewing ChatGPT plans expose the next bill date as renews_at.
  // expires_at is the current (often already-elapsed) period boundary and
  // lags after a successful renewal — never prefer it over renews_at.
  const expiresAt =
    parseTime(entitlement?.renews_at) ??
    parseTime(entitlement?.expires_at) ??
    parseTime(account?.active_until);
  return {
    planType,
    ...(hasActive === undefined ? {} : { hasActiveSubscription: hasActive }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export function parseCodexAccountCheckMembership(
  payload: unknown,
  accountId: string
): CodexMembershipInfo | null {
  const root = asRecord(payload);
  const accounts = asRecord(root?.accounts);
  if (!accounts) return null;
  const row = resolveAccountCheckRow(accounts, accountId);
  if (!row) return null;
  const entitlement = asRecord(row.entitlement);
  const account = asRecord(row.account);
  const tier = normalizeCodexMembershipTier(
    entitlement?.subscription_plan,
    "entitlement"
  );
  const fallback = normalizeCodexMembershipTier(
    account?.plan_type,
    "subscription"
  );
  const planType = tier ?? fallback;
  if (!planType) return null;
  return membershipFromEntitlement(entitlement, account, planType);
}

export function parseCodexSubscriptionsMembership(
  payload: unknown
): CodexMembershipInfo | null {
  const root = asRecord(payload);
  if (!root) return null;
  const planType = normalizeCodexMembershipTier(
    root.subscription_plan ?? root.plan_type,
    "subscription"
  );
  if (!planType) return null;
  const expiresAt = parseTime(root.active_until ?? root.expires_at);
  return {
    planType,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}
