import type { ClaudeAccountProvider } from "./claude-provider.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";

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
  provider: ClaudeAccountProvider;
  setSuppressWatchUntil: (until: number) => void;
  stateStore: ClaudeAccountsStateStore;
  watchSuppressMs: number;
}

/**
 * Switch the active Claude account: sync the current active account's live
 * credential back into its managed store first (in case Claude rotated its
 * token), then materialize the target account into the active store. Mirrors
 * Codex/Grok switch ordering; identity is only mutated after materialize.
 */
export async function selectManagedAccount(
  deps: AccountsSelectDeps,
  accountId: string
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
    // Only capture back when we have a fingerprint to validate against — an
    // absent providerAccountId would let a foreign external login be bound to
    // the old account's store (mirrors the Codex fix).
    if (activeAccount?.providerAccountId !== undefined) {
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
  await deps.provider.materialize(deps.accountHomeDir(accountId));
  deps.setSuppressWatchUntil(deps.now() + deps.watchSuppressMs);

  deps.stateStore.mutate((current) => ({
    ...current,
    activeAccountId: accountId,
    revision: current.revision + 1,
  }));
  await deps.stateStore.flush();
  deps.onSelected(accountId);
}
