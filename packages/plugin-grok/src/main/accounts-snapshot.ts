import type {
  GrokAccountSummary,
  GrokAccountsSnapshot,
} from "../shared/accounts.ts";
import { accountLabel } from "./accounts-records.ts";
import {
  activeUsageCacheKey,
  toUsageSnapshot,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import type { GrokAccountsFileState } from "./state.ts";

interface BuildAccountsSnapshotInput {
  lastLoginError: { at: number; message: string } | null;
  loginMode: "oauth" | "device" | null;
  loginPending: boolean;
  now: number;
  revision: number;
  state: GrokAccountsFileState;
  usageCache: Readonly<Record<string, UsageCacheEntry>>;
}

export function buildAccountsSnapshot({
  lastLoginError,
  loginMode,
  loginPending,
  now,
  revision,
  state,
  usageCache,
}: BuildAccountsSnapshotInput): GrokAccountsSnapshot {
  const toSummary = (
    record: GrokAccountsFileState["accounts"][number]
  ): GrokAccountSummary => {
    let status: GrokAccountSummary["status"] =
      record.id === state.activeAccountId ? "active" : "available";
    if (loginPending) {
      status = "login-pending";
    } else if (lastLoginError && record.id === state.activeAccountId) {
      status = "error";
    }
    const usage = usageCache[record.id];
    return {
      id: record.id,
      kind: record.kind,
      label: accountLabel(record),
      status,
      ...(record.email ? { email: record.email } : {}),
      ...(record.teamId ? { teamId: record.teamId } : {}),
      ...(usage?.subscription ? { subscription: usage.subscription } : {}),
      error: lastLoginError && !loginPending ? lastLoginError.message : null,
      usage: usage ? toUsageSnapshot(usage) : null,
    };
  };

  const activeUsageEntry =
    usageCache[activeUsageCacheKey(state.activeAccountId)];

  return {
    accounts: state.accounts.map(toSummary),
    activeAccountId: state.activeAccountId,
    activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
    lastLoginError,
    login:
      loginPending && loginMode
        ? { mode: loginMode, provider: "grok", startedAt: now }
        : null,
    revision,
    schemaVersion: 1,
  };
}
