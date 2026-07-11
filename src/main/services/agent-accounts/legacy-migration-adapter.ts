import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Private Codex legacy migration adapter (plan Task 11a).
 * Read-only bridge over the pre-migration on-disk layout:
 * `{userData}/agent-accounts.json` + `{userData}/agent-accounts/codex/<id>/auth.json`.
 *
 * Injected ONLY when `plugin.id === "pier.codex"` by the external main runtime
 * — no other plugin can observe legacy account paths or credentials.
 *
 * This adapter is intentionally NOT deleted in Task 11b; it stays as the only
 * survivor of the agent-accounts module until a documented sunset window
 * confirms all users have migrated (design §8.6 / plan Task 11b).
 */

export interface CodexLegacyMigrationAdapter {
  readonly legacyAgentAccountsBaseDir: string;
  readonly legacyAgentAccountsStateFile: string;
  readLegacyAuthJson(accountId: string): Promise<string | null>;
  readLegacyStateFile(): Promise<string | null>;
}

export function createCodexLegacyMigrationAdapter(opts: {
  userDataDir: string;
}): CodexLegacyMigrationAdapter {
  const stateFile = join(opts.userDataDir, "agent-accounts.json");
  const baseDir = join(opts.userDataDir, "agent-accounts");

  return {
    legacyAgentAccountsBaseDir: baseDir,
    legacyAgentAccountsStateFile: stateFile,
    async readLegacyAuthJson(accountId: string): Promise<string | null> {
      const path = join(baseDir, "codex", accountId, "auth.json");
      if (!existsSync(path)) {
        return null;
      }
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async readLegacyStateFile(): Promise<string | null> {
      if (!existsSync(stateFile)) {
        return null;
      }
      try {
        return await readFile(stateFile, "utf8");
      } catch {
        return null;
      }
    },
  };
}
