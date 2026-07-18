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
  lastLoginError: { at: number; message: string } | null;
  loginPending: "codex" | null;
  now: number;
  revision: number;
  state: CodexAccountsFileState;
  usageCache: Readonly<Record<string, UsageCacheEntry>>;
}

export function buildAccountsSnapshot({
  lastLoginError,
  loginPending,
  now,
  revision,
  state,
  usageCache,
}: BuildAccountsSnapshotInput): CodexAccountsSnapshot {
  const toSummary = (
    record: CodexAccountsFileState["accounts"][number]
  ): CodexAccountSummary => {
    const usage = usageCache[record.id];
    return {
      id: record.id,
      label: record.email ?? record.id,
      ...(record.planType ? { planType: record.planType } : {}),
      ...(record.subscriptionExpiresAt === undefined
        ? {}
        : { subscriptionExpiresAt: record.subscriptionExpiresAt }),
      status: record.id === state.activeAccountId ? "active" : "available",
      usage: usage ? toUsageSnapshot(usage) : null,
      error:
        lastLoginError && loginPending === null ? lastLoginError.message : null,
    };
  };
  const activeUsageEntry =
    usageCache[activeUsageCacheKey(state.activeAccountId)];
  return {
    accounts: state.accounts.map(toSummary),
    activeAccountId: state.activeAccountId,
    activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
    login: loginPending ? { provider: "codex", startedAt: now } : null,
    revision,
    schemaVersion: state.schemaVersion,
  };
}
