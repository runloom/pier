import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import type { CodexAccountRecord } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

export async function reconcileManagedCredentials(options: {
  accounts: readonly CodexAccountRecord[];
  ensureManagedDir: (accountId: string) => Promise<string>;
  managedBaseDir: string;
  provider: AgentAccountProvider;
}): Promise<void> {
  const knownIds = new Set(options.accounts.map((account) => account.id));
  for (const account of options.accounts) {
    const homeDir = await options.ensureManagedDir(account.id);
    const identity = await options.provider.readIdentity(homeDir);
    if (!identity) {
      throw new Error(`Codex credential is invalid for account ${account.id}`);
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
    await options.provider.deleteCredential?.(orphanDir);
    await rm(orphanDir, { force: true, recursive: true });
  }
}
