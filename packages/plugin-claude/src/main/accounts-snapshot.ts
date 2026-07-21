import type {
  ClaudeAccountSummary,
  ClaudeAccountsSnapshot,
  ClaudeLoginState,
} from "../shared/accounts.ts";
import { accountLabel } from "./accounts-records.ts";
import {
  activeUsageCacheKey,
  toUsageSnapshot,
  type UsageCacheEntry,
} from "./accounts-usage-refresh.ts";
import type { ClaudeAccountsFileState } from "./state.ts";

interface BuildAccountsSnapshotInput {
  apiKeyModeDetected: boolean;
  /** Per-account credential problems detected at activation. */
  credentialErrors?: ReadonlyMap<string, string> | undefined;
  lastActionError: { at: number; message: string } | null;
  login: ClaudeLoginState | null;
  revision: number;
  state: ClaudeAccountsFileState;
  usageCache: Readonly<Record<string, UsageCacheEntry>>;
}

export function buildAccountsSnapshot({
  apiKeyModeDetected,
  credentialErrors,
  lastActionError,
  login,
  revision,
  state,
  usageCache,
}: BuildAccountsSnapshotInput): ClaudeAccountsSnapshot {
  const toSummary = (
    record: ClaudeAccountsFileState["accounts"][number]
  ): ClaudeAccountSummary => {
    const credentialError = credentialErrors?.get(record.id) ?? null;
    let status: ClaudeAccountSummary["status"] =
      record.id === state.activeAccountId ? "active" : "available";
    if (credentialError) {
      status = "error";
    }
    const usage = usageCache[record.id];
    return {
      id: record.id,
      label: accountLabel(record),
      status,
      updatedAt: record.updatedAt,
      ...(record.email ? { email: record.email } : {}),
      ...(record.subscriptionType
        ? {
            subscription: {
              planType: record.subscriptionType,
              ...(record.organizationName
                ? { organizationName: record.organizationName }
                : {}),
            },
          }
        : {}),
      error: credentialError,
      usage: usage ? toUsageSnapshot(usage) : null,
    };
  };

  const activeUsageEntry =
    usageCache[activeUsageCacheKey(state.activeAccountId)];

  return {
    accounts: state.accounts.map(toSummary),
    activeAccountId: state.activeAccountId,
    activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
    apiKeyModeDetected,
    lastActionError,
    login,
    revision,
    schemaVersion: 1,
  };
}
