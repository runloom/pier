import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import type { CodexAccountRecord } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

/**
 * Validate every managed credential and clean up orphaned account homes.
 *
 * Never throws for a single bad account: one corrupt/missing credential must
 * not brick plugin activation (which would remove every Codex surface,
 * including the UI needed to remove the broken account). Returns a map of
 * accountId → error message for accounts whose credentials are unusable, so
 * the service can mark them `status: "error"` in the snapshot.
 */
export async function reconcileManagedCredentials(options: {
  accounts: readonly CodexAccountRecord[];
  ensureManagedDir: (accountId: string) => Promise<string>;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  managedBaseDir: string;
  provider: AgentAccountProvider;
}): Promise<Map<string, string>> {
  const credentialErrors = new Map<string, string>();
  const knownIds = new Set(options.accounts.map((account) => account.id));
  for (const account of options.accounts) {
    try {
      const homeDir = await options.ensureManagedDir(account.id);
      const identity = await options.provider.readIdentity(homeDir);
      if (!identity) {
        credentialErrors.set(account.id, "Codex credential is invalid");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      credentialErrors.set(account.id, message);
      options.logger?.warn(
        `[pier.codex] credential reconciliation failed for account ${account.id}`,
        { error: message }
      );
    }
  }
  const providerRoot = join(options.managedBaseDir, "codex");
  const entries = await readdir(providerRoot, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (!(entry.isDirectory() && !knownIds.has(entry.name))) continue;
    const orphanDir = join(providerRoot, entry.name);
    if (!existsSync(join(orphanDir, PIER_MANAGED_HOME_MARKER))) continue;
    try {
      await options.provider.deleteCredential?.(orphanDir);
      await rm(orphanDir, { force: true, recursive: true });
    } catch (error) {
      options.logger?.warn(
        `[pier.codex] could not clean up orphaned account home ${entry.name}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
  return credentialErrors;
}
