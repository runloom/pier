import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GrokAccountProvider } from "./grok-provider.ts";
import { PIER_MANAGED_HOME_MARKER } from "./managed-account-home.ts";
import type { GrokAccountRecord } from "./state.ts";

/**
 * Validate every managed credential and clean up orphaned account homes.
 *
 * Never throws for a single bad account: one missing API key or corrupt OIDC
 * credential must not brick plugin activation (which would remove every Grok
 * surface, including the UI needed to remove the broken account). Returns a
 * map of accountId → error message for accounts whose credentials are
 * unusable, so the service can mark them `status: "error"` in the snapshot.
 */
export async function reconcileManagedCredentials(options: {
  accounts: readonly GrokAccountRecord[];
  ensureManagedDir: (accountId: string) => Promise<string>;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  managedBaseDir: string;
  provider: GrokAccountProvider;
}): Promise<Map<string, string>> {
  const credentialErrors = new Map<string, string>();
  const knownIds = new Set(options.accounts.map((account) => account.id));
  for (const account of options.accounts) {
    try {
      if (account.kind === "api_key") {
        const key = await options.provider.readApiKey(account.id);
        if (!key) {
          credentialErrors.set(account.id, "Grok API key is missing");
        }
        continue;
      }
      const homeDir = await options.ensureManagedDir(account.id);
      const identity = await options.provider.readIdentity(homeDir);
      if (!identity) {
        credentialErrors.set(account.id, "Grok credential is invalid");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      credentialErrors.set(account.id, message);
      options.logger?.warn(
        `[pier.grok] credential reconciliation failed for account ${account.id}`,
        { error: message }
      );
    }
  }
  const providerRoot = join(options.managedBaseDir, "grok");
  const entries = await readdir(providerRoot, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (!(entry.isDirectory() && !knownIds.has(entry.name))) continue;
    const orphanDir = join(providerRoot, entry.name);
    if (!existsSync(join(orphanDir, PIER_MANAGED_HOME_MARKER))) continue;
    try {
      await options.provider.deleteCredential(orphanDir);
      await options.provider.deleteApiKey(entry.name);
      await rm(orphanDir, { force: true, recursive: true });
    } catch (error) {
      options.logger?.warn(
        `[pier.grok] could not clean up orphaned account home ${entry.name}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
  return credentialErrors;
}
