import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Plugin-local Codex account state store — persists non-sensitive metadata
 * under `context.paths.workDir/accounts.json` (design §8.2).
 */

export type AgentAccountProviderId = "codex";

export interface CodexAccountRecord {
  createdAt: number;
  email?: string;
  id: string;
  lastAuthenticatedAt?: number;
  planType?: string;
  provider: AgentAccountProviderId;
  providerAccountId?: string;
  updatedAt: number;
}

export interface CodexAccountsFileState {
  accounts: CodexAccountRecord[];
  activeAccountId: string | null;
  revision: number;
  schemaVersion: number;
}

const DEFAULTS: CodexAccountsFileState = {
  accounts: [],
  activeAccountId: null,
  revision: 0,
  schemaVersion: 1,
};

export interface CodexAccountsStateStore {
  flush(): Promise<void>;
  get(): CodexAccountsFileState;
  init(): Promise<CodexAccountsFileState>;
  mutate(
    fn: (state: CodexAccountsFileState) => CodexAccountsFileState
  ): CodexAccountsFileState;
}

export function createCodexAccountsStateStore(
  filePath: string
): CodexAccountsStateStore {
  let state: CodexAccountsFileState = DEFAULTS;
  let dirty = false;
  let flushInFlight: Promise<void> | null = null;

  async function persist(): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, filePath);
    dirty = false;
  }

  return {
    async flush(): Promise<void> {
      if (!dirty) {
        return;
      }
      if (flushInFlight) {
        await flushInFlight;
        return;
      }
      flushInFlight = persist();
      try {
        await flushInFlight;
      } finally {
        flushInFlight = null;
      }
    },
    get: () => state,
    async init(): Promise<CodexAccountsFileState> {
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as Partial<CodexAccountsFileState>;
          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.accounts)
          ) {
            state = {
              accounts: parsed.accounts as CodexAccountRecord[],
              activeAccountId: parsed.activeAccountId ?? null,
              revision: parsed.revision ?? 0,
              schemaVersion: parsed.schemaVersion ?? 1,
            };
          }
        } catch {
          state = DEFAULTS;
        }
      }
      return state;
    },
    mutate(fn): CodexAccountsFileState {
      state = fn(state);
      dirty = true;
      return state;
    },
  };
}
