export interface CodexMembershipInfo {
  expiresAt?: number;
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

export function parseCodexAccountCheckMembership(
  payload: unknown,
  accountId: string
): CodexMembershipInfo | null {
  const root = asRecord(payload);
  const accounts = asRecord(root?.accounts);
  const row = asRecord(accounts?.[accountId]);
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
  const expiresAt = parseTime(entitlement?.expires_at);
  return {
    planType,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
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
