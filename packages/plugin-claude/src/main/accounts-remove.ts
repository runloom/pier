import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import { PIER_MANAGED_HOME_MARKER } from "./managed-account-home.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";

export interface RemoveAccountHost {
  accountHomeDir(accountId: string): string;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  onRemoved(accountId: string): void;
  provider: ClaudeAccountProvider;
  stateStore: ClaudeAccountsStateStore;
}

/**
 * Remove a managed account: durable metadata removal with targeted rollback,
 * then best-effort credential cleanup (mirrors Codex/Grok). Removing the
 * ACTIVE account is allowed — it clears the selection; the CLI's live login
 * is never touched (and may be re-imported by drift adoption while it stays
 * signed in).
 */
export async function removeManagedAccount(
  host: RemoveAccountHost,
  accountId: string
): Promise<void> {
  const { provider, stateStore, logger } = host;
  const state = stateStore.get();
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) {
    return;
  }
  const wasActive = state.activeAccountId === accountId;
  stateStore.mutate((s) => ({
    ...s,
    accounts: s.accounts.filter((a) => a.id !== accountId),
    activeAccountId: s.activeAccountId === accountId ? null : s.activeAccountId,
    revision: s.revision + 1,
  }));
  try {
    await stateStore.flush();
  } catch (error) {
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.some((a) => a.id === accountId)
        ? s.accounts
        : [...s.accounts, account],
      activeAccountId:
        wasActive && s.activeAccountId === null ? accountId : s.activeAccountId,
      revision: s.revision + 1,
    }));
    try {
      await stateStore.flush();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Claude account remove and metadata rollback failed"
      );
    }
    throw error;
  }
  const dir = host.accountHomeDir(accountId);
  const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
  if (existsSync(markerPath)) {
    try {
      await provider.deleteCredential(dir);
      await rm(dir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger?.warn("[pier.claude] account credential cleanup failed", {
        accountId,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }
  host.onRemoved(accountId);
}
