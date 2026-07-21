import type {
  CodexAccountSummary,
  CodexAccountsSnapshot,
} from "../shared/accounts.ts";
import {
  activeUsageCacheKey,
  toUsageSnapshot,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import type { CodexAccountsFileState } from "./state.ts";

interface BuildAccountsSnapshotInput {
  /** Per-account credential problems detected at activation (B1). */
  credentialErrors?: ReadonlyMap<string, string> | undefined;
  lastLoginError: { at: number; message: string } | null;
  loginPending: "codex" | null;
  loginStartedAt: number | null;
  now: number;
  revision: number;
  state: CodexAccountsFileState;
  usageCache: Readonly<Record<string, UsageCacheEntry>>;
}

export function buildAccountsSnapshot({
  credentialErrors,
  lastLoginError,
  loginPending,
  loginStartedAt,
  now,
  revision,
  state,
  usageCache,
}: BuildAccountsSnapshotInput): CodexAccountsSnapshot {
  const toSummary = (
    record: CodexAccountsFileState["accounts"][number]
  ): CodexAccountSummary => {
    const usage = usageCache[record.id];
    // A failed *add* login is not this account's error — it lives on the
    // snapshot's login state, not on every summary. Only real per-account
    // credential problems surface here.
    const credentialError = credentialErrors?.get(record.id) ?? null;
    let status: CodexAccountSummary["status"] =
      record.id === state.activeAccountId ? "active" : "available";
    if (credentialError) {
      status = "error";
    }
    return {
      id: record.id,
      label: record.email ?? record.id,
      ...(record.planType ? { planType: record.planType } : {}),
      ...(record.subscriptionExpiresAt === undefined
        ? {}
        : { subscriptionExpiresAt: record.subscriptionExpiresAt }),
      status,
      usage: usage ? toUsageSnapshot(usage) : null,
      error: credentialError,
    };
  };
  const activeUsageEntry =
    usageCache[activeUsageCacheKey(state.activeAccountId)];
  return {
    accounts: state.accounts.map(toSummary),
    activeAccountId: state.activeAccountId,
    activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
    ...(lastLoginError ? { lastLoginError } : {}),
    login: loginPending
      ? { provider: "codex", startedAt: loginStartedAt ?? now }
      : null,
    revision,
    schemaVersion: state.schemaVersion,
  };
}
