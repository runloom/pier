import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import { PIER_MANAGED_HOME_MARKER } from "./managed-account-home.ts";
import type { ClaudeAccountRecord } from "./state.ts";

/**
 * Validate every managed credential and clean up orphaned account homes.
 *
 * Never throws for a single bad account: one missing/corrupt credential must
 * not brick plugin activation (which would remove the accounts UI needed to
 * remove the broken account). Returns accountId → error message so the service
 * can surface it as `status: "error"` (mirrors Codex/Grok).
 */
export async function reconcileManagedCredentials(options: {
  accounts: readonly ClaudeAccountRecord[];
  ensureManagedDir: (accountId: string) => Promise<string>;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  managedBaseDir: string;
  provider: ClaudeAccountProvider;
}): Promise<Map<string, string>> {
  const credentialErrors = new Map<string, string>();
  const knownIds = new Set(options.accounts.map((account) => account.id));
  for (const account of options.accounts) {
    try {
      const homeDir = await options.ensureManagedDir(account.id);
      const identity = await options.provider.readIdentity(homeDir);
      if (!identity) {
        credentialErrors.set(account.id, "Claude credential is invalid");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      credentialErrors.set(account.id, message);
      options.logger?.warn(
        `[pier.claude] credential reconciliation failed for account ${account.id}`,
        { error: message }
      );
    }
  }
  const providerRoot = join(options.managedBaseDir, "claude");
  const entries = await readdir(providerRoot, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (!(entry.isDirectory() && !knownIds.has(entry.name))) {
      continue;
    }
    const orphanDir = join(providerRoot, entry.name);
    if (!existsSync(join(orphanDir, PIER_MANAGED_HOME_MARKER))) {
      continue;
    }
    try {
      await options.provider.deleteCredential(orphanDir);
      await rm(orphanDir, { force: true, recursive: true });
    } catch (error) {
      options.logger?.warn(
        `[pier.claude] could not clean up orphaned account home ${entry.name}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
  return credentialErrors;
}
