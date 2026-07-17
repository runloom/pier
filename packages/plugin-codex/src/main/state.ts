import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod/mini";

/**
 * Plugin-local Codex account state store — persists non-sensitive metadata
 * under `context.paths.workDir/accounts.json` (design §8.2).
 */

export type AgentAccountProviderId = "codex";

export interface CodexAccountRecord {
  createdAt: number;
  email?: string | undefined;
  id: string;
  lastAuthenticatedAt?: number | undefined;
  planType?: string | undefined;
  provider: AgentAccountProviderId;
  providerAccountId?: string | undefined;
  /** ChatGPT subscription period end (ms epoch). */
  subscriptionExpiresAt?: number | undefined;
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

const nonEmptyStringSchema = z.string().check(z.minLength(1));

const accountRecordSchema = z.strictObject({
  createdAt: z.number(),
  email: z.optional(z.string()),
  id: nonEmptyStringSchema,
  lastAuthenticatedAt: z.optional(z.number()),
  planType: z.optional(z.string()),
  provider: z.literal("codex"),
  providerAccountId: z.optional(z.string()),
  subscriptionExpiresAt: z.optional(z.number()),
  updatedAt: z.number(),
});

const accountsStateSchema = z.strictObject({
  accounts: z.array(accountRecordSchema),
  activeAccountId: z.nullable(nonEmptyStringSchema),
  revision: z.int().check(z.nonnegative()),
  schemaVersion: z.literal(1),
});

const dataSchemaMarkerSchema = z.strictObject({
  schemas: z.strictObject({
    "codex.accounts": z.strictObject({
      updatedByPluginVersion: nonEmptyStringSchema,
      version: z.literal(1),
    }),
  }),
  version: z.literal(1),
});

export interface CodexAccountsStateStore {
  ensureSchemaMarker(): Promise<void>;
  flush(): Promise<void>;
  get(): CodexAccountsFileState;
  init(): Promise<CodexAccountsFileState>;
  mutate(
    fn: (state: CodexAccountsFileState) => CodexAccountsFileState
  ): CodexAccountsFileState;
}

export function createCodexAccountsStateStore(
  filePath: string,
  pluginVersion = "0.0.0"
): CodexAccountsStateStore {
  let state: CodexAccountsFileState = DEFAULTS;
  let dirty = false;
  let flushInFlight: Promise<void> | null = null;
  const markerPath = join(dirname(filePath), ".pier-plugin-data-schemas.json");

  async function persistMarker(): Promise<void> {
    const marker = dataSchemaMarkerSchema.parse({
      schemas: {
        "codex.accounts": {
          updatedByPluginVersion: pluginVersion,
          version: 1,
        },
      },
      version: 1,
    });
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFileAtomic(markerPath, JSON.stringify(marker), { mode: 0o600 });
  }

  async function persist(): Promise<void> {
    const snapshot = state;
    await mkdir(dirname(filePath), { recursive: true });
    const validated = accountsStateSchema.parse(snapshot);
    await writeFileAtomic(filePath, JSON.stringify(validated), { mode: 0o600 });
    await persistMarker();
    dirty = state !== snapshot;
  }

  return {
    ensureSchemaMarker: persistMarker,
    async flush(): Promise<void> {
      while (dirty) {
        if (flushInFlight) {
          await flushInFlight;
          continue;
        }
        flushInFlight = persist();
        try {
          await flushInFlight;
        } finally {
          flushInFlight = null;
        }
      }
    },
    get: () => state,
    async init(): Promise<CodexAccountsFileState> {
      if (existsSync(filePath)) {
        const raw = await readFile(filePath, "utf8");
        state = accountsStateSchema.parse(JSON.parse(raw));
      }
      if (
        state.activeAccountId !== null &&
        !state.accounts.some((account) => account.id === state.activeAccountId)
      ) {
        throw new Error(
          "active Codex account is missing from accounts metadata"
        );
      }
      const ids = new Set<string>();
      for (const account of state.accounts) {
        if (ids.has(account.id)) {
          throw new Error(`duplicate Codex account id: ${account.id}`);
        }
        ids.add(account.id);
      }
      if (existsSync(markerPath)) {
        const markerRaw = await readFile(markerPath, "utf8");
        dataSchemaMarkerSchema.parse(JSON.parse(markerRaw));
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
