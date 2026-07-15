import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import { syncManagedAccountToPeers } from "./peer-credential-sync.ts";
import type { GrokAccountsStateStore } from "./state.ts";

export interface AccountsSelectDeps {
  accountHomeDir: (accountId: string) => string;
  handleDrift: () => Promise<void>;
  logger?:
    | {
        info(message: string, meta?: unknown): void;
        warn(message: string, meta?: unknown): void;
      }
    | undefined;
  now: () => number;
  onSelected: (accountId: string) => void;
  provider: GrokAccountProvider;
  setSuppressWatchUntil: (until: number) => void;
  stateStore: GrokAccountsStateStore;
  watchSuppressMs: number;
}

export async function selectManagedAccount(
  deps: AccountsSelectDeps,
  accountId: string,
  syncTargets?: readonly CrossToolSyncTarget[]
): Promise<void> {
  const state = deps.stateStore.get();
  const target = state.accounts.find((account) => account.id === accountId);
  if (!target) {
    throw new Error(`Account not found: ${accountId}`);
  }
  if (state.activeAccountId === accountId) {
    return;
  }

  if (state.activeAccountId) {
    const activeAccount = state.accounts.find(
      (account) => account.id === state.activeAccountId
    );
    if (activeAccount?.kind === "oidc") {
      deps.setSuppressWatchUntil(deps.now() + deps.watchSuppressMs);
      const syncResult = await deps.provider.syncBack(
        deps.accountHomeDir(state.activeAccountId),
        activeAccount.providerAccountId
      );
      deps.setSuppressWatchUntil(deps.now() + deps.watchSuppressMs);
      if (syncResult === "identity-mismatch") {
        await deps.handleDrift();
      }
    }
  }

  deps.setSuppressWatchUntil(deps.now() + deps.watchSuppressMs);
  if (target.kind === "oidc") {
    await deps.provider.materializeOidc(deps.accountHomeDir(accountId));
  } else {
    await deps.provider.materializeEmptyAuth();
  }
  deps.setSuppressWatchUntil(deps.now() + deps.watchSuppressMs);

  // Switch keeps peer sync best-effort so a peer failure never rolls back Grok.
  if (syncTargets && syncTargets.length > 0) {
    await syncManagedAccountToPeers({
      accountHomeDir: deps.accountHomeDir(accountId),
      accountId,
      kind: target.kind,
      ...(target.label ? { label: target.label } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
      provider: deps.provider,
      syncTargets,
    });
  }

  deps.stateStore.mutate((current) => ({
    ...current,
    activeAccountId: accountId,
    revision: current.revision + 1,
  }));
  await deps.stateStore.flush();
  deps.onSelected(accountId);
}

export async function syncManagedAccountPeers(
  deps: Pick<
    AccountsSelectDeps,
    "accountHomeDir" | "logger" | "provider" | "stateStore"
  >,
  payload: {
    accountId?: string | undefined;
    syncTargets: readonly Exclude<CrossToolSyncTarget, "grok">[];
  }
): Promise<void> {
  if (payload.syncTargets.length === 0) {
    throw new Error("Select at least one tool to sync");
  }
  const state = deps.stateStore.get();
  const accountId = payload.accountId ?? state.activeAccountId;
  if (!accountId) {
    throw new Error(
      "No active managed account to sync. Select a managed Grok account first."
    );
  }
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }
  await syncManagedAccountToPeers({
    accountHomeDir: deps.accountHomeDir(accountId),
    accountId,
    kind: account.kind,
    ...(account.label ? { label: account.label } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    provider: deps.provider,
    syncTargets: payload.syncTargets,
    throwOnFailure: true,
  });
}
