import type {
  GrokAccountSummary,
  GrokAccountsSnapshot,
  GrokLoginState,
} from "../shared/accounts.ts";
import { accountLabel } from "./accounts-records.ts";
import {
  activeUsageCacheKey,
  toUsageSnapshot,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import type { GrokAccountsFileState } from "./state.ts";

interface BuildAccountsSnapshotInput {
  /** Per-account credential problems detected at activation (B1). */
  credentialErrors?: ReadonlyMap<string, string> | undefined;
  lastLoginError: { at: number; message: string } | null;
  loginDeviceInfo: {
    deviceCode?: string | undefined;
    deviceVerificationUrl?: string | undefined;
  } | null;
  loginMode: "oauth" | "device" | null;
  loginPending: boolean;
  loginStartedAt: number | null;
  now: number;
  revision: number;
  state: GrokAccountsFileState;
  usageCache: Readonly<Record<string, UsageCacheEntry>>;
}

export function buildAccountsSnapshot({
  credentialErrors,
  lastLoginError,
  loginDeviceInfo,
  loginMode,
  loginPending,
  loginStartedAt,
  now,
  revision,
  state,
  usageCache,
}: BuildAccountsSnapshotInput): GrokAccountsSnapshot {
  const toSummary = (
    record: GrokAccountsFileState["accounts"][number]
  ): GrokAccountSummary => {
    // A pending login is about a *new* account; it must not restamp every
    // existing account's status. Only real per-account credential problems
    // surface as "error".
    const credentialError = credentialErrors?.get(record.id) ?? null;
    let status: GrokAccountSummary["status"] =
      record.id === state.activeAccountId ? "active" : "available";
    if (credentialError) {
      status = "error";
    }
    const usage = usageCache[record.id];
    const subscription = usage?.subscription ?? record.subscription;
    return {
      id: record.id,
      kind: record.kind,
      label: accountLabel(record),
      status,
      ...(record.email ? { email: record.email } : {}),
      ...(record.teamId ? { teamId: record.teamId } : {}),
      ...(subscription ? { subscription } : {}),
      error: credentialError,
      usage: usage ? toUsageSnapshot(usage) : null,
    };
  };

  const activeUsageEntry =
    usageCache[activeUsageCacheKey(state.activeAccountId)];

  let login: GrokLoginState | null = null;
  if (loginPending && loginMode) {
    login = {
      mode: loginMode,
      provider: "grok",
      startedAt: loginStartedAt ?? now,
      ...(loginDeviceInfo?.deviceCode
        ? { deviceCode: loginDeviceInfo.deviceCode }
        : {}),
      ...(loginDeviceInfo?.deviceVerificationUrl
        ? { deviceVerificationUrl: loginDeviceInfo.deviceVerificationUrl }
        : {}),
    };
  }

  return {
    accounts: state.accounts.map(toSummary),
    activeAccountId: state.activeAccountId,
    activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
    lastLoginError,
    login,
    revision,
    schemaVersion: 1,
  };
}
