import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import type { CodexAccountsStateStore } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

export interface RemoveAccountHost {
  accountHomeDir(accountId: string): string;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  onRemoved(accountId: string): void;
  provider: AgentAccountProvider;
  stateStore: CodexAccountsStateStore;
}

/**
 * Remove a managed account: durable metadata removal with targeted rollback,
 * then best-effort credential cleanup — the user's intent (remove from Pier)
 * is already durable, so a failed secret deletion must not resurrect the
 * account in an error dialog.
 */
export async function removeManagedAccount(
  host: RemoveAccountHost,
  accountId: string
): Promise<void> {
  const { provider, stateStore, logger } = host;
  const state = stateStore.get();
  if (state.activeAccountId === accountId) {
    throw new Error("Cannot remove active account — select another first");
  }
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) {
    return;
  }
  stateStore.mutate((s) => ({
    ...s,
    accounts: s.accounts.filter((a) => a.id !== accountId),
    revision: s.revision + 1,
  }));
  try {
    await stateStore.flush();
  } catch (error) {
    // Targeted rollback: re-insert only the record this remove dropped.
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.some((a) => a.id === accountId)
        ? s.accounts
        : [...s.accounts, account],
      revision: s.revision + 1,
    }));
    try {
      await stateStore.flush();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Codex account remove and metadata rollback failed"
      );
    }
    throw error;
  }
  const dir = host.accountHomeDir(accountId);
  const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
  if (existsSync(markerPath)) {
    try {
      await provider.deleteCredential?.(dir);
      await rm(dir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger?.warn("[pier.codex] account credential cleanup failed", {
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
