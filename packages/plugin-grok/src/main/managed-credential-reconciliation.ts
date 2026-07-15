import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GrokAccountProvider } from "./grok-provider.ts";
import { PIER_MANAGED_HOME_MARKER } from "./managed-account-home.ts";
import type { GrokAccountRecord } from "./state.ts";

export async function reconcileManagedCredentials(options: {
  accounts: readonly GrokAccountRecord[];
  ensureManagedDir: (accountId: string) => Promise<string>;
  managedBaseDir: string;
  provider: GrokAccountProvider;
}): Promise<void> {
  const knownIds = new Set(options.accounts.map((account) => account.id));
  for (const account of options.accounts) {
    if (account.kind === "api_key") {
      const key = await options.provider.readApiKey(account.id);
      if (!key) {
        throw new Error(`Grok API key is missing for account ${account.id}`);
      }
      continue;
    }
    const homeDir = await options.ensureManagedDir(account.id);
    const identity = await options.provider.readIdentity(homeDir);
    if (!identity) {
      throw new Error(`Grok credential is invalid for account ${account.id}`);
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
    await options.provider.deleteCredential(orphanDir);
    await options.provider.deleteApiKey(entry.name);
    await rm(orphanDir, { force: true, recursive: true });
  }
}
