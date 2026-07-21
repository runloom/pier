import { existsSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod/mini";
import { DATA_SCHEMA_ID } from "../shared/constants.ts";

/**
 * Plugin-local Claude account state store — persists non-sensitive metadata
 * under `context.paths.workDir/accounts.json`. Mirrors the hardened
 * Codex/Grok store: quarantine-and-recover on corrupt files, repair dangling
 * active ids and duplicate ids instead of failing activation.
 */

export type AgentAccountProviderId = "claude";

export interface ClaudeAccountRecord {
  createdAt: number;
  email?: string | undefined;
  id: string;
  organizationName?: string | undefined;
  provider: AgentAccountProviderId;
  providerAccountId?: string | undefined;
  subscriptionType?: string | undefined;
  updatedAt: number;
}

export interface ClaudeAccountsFileState {
  accounts: ClaudeAccountRecord[];
  activeAccountId: string | null;
  revision: number;
  schemaVersion: number;
}

const DEFAULTS: ClaudeAccountsFileState = {
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
  organizationName: z.optional(z.string()),
  provider: z.literal("claude"),
  providerAccountId: z.optional(z.string()),
  subscriptionType: z.optional(z.string()),
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
    [DATA_SCHEMA_ID]: z.strictObject({
      updatedByPluginVersion: nonEmptyStringSchema,
      version: z.literal(1),
    }),
  }),
  version: z.literal(1),
});

export interface ClaudeAccountsStateStore {
  ensureSchemaMarker(): Promise<void>;
  flush(): Promise<void>;
  get(): ClaudeAccountsFileState;
  init(): Promise<ClaudeAccountsFileState>;
  mutate(
    fn: (state: ClaudeAccountsFileState) => ClaudeAccountsFileState
  ): ClaudeAccountsFileState;
}

export function createClaudeAccountsStateStore(
  filePath: string,
  pluginVersion = "0.0.0",
  logger?: { warn(message: string, meta?: unknown): void }
): ClaudeAccountsStateStore {
  let state: ClaudeAccountsFileState = DEFAULTS;
  let dirty = false;
  let flushInFlight: Promise<void> | null = null;
  const markerPath = join(dirname(filePath), ".pier-plugin-data-schemas.json");

  async function quarantineCorruptFile(
    path: string,
    error: unknown
  ): Promise<void> {
    const quarantinePath = `${path}.corrupt-${Date.now()}`;
    logger?.warn(
      "[pier.claude] state file is corrupt, moving aside and starting fresh",
      {
        error: error instanceof Error ? error.message : String(error),
        from: path,
        to: quarantinePath,
      }
    );
    await rename(path, quarantinePath).catch(() => undefined);
  }

  function repairState(
    loaded: ClaudeAccountsFileState
  ): ClaudeAccountsFileState {
    let repaired = loaded;
    const seen = new Set<string>();
    const deduped = repaired.accounts.filter((account) => {
      if (seen.has(account.id)) {
        return false;
      }
      seen.add(account.id);
      return true;
    });
    if (deduped.length !== repaired.accounts.length) {
      logger?.warn("[pier.claude] removed duplicate account ids from state");
      repaired = { ...repaired, accounts: deduped };
      dirty = true;
    }
    if (
      repaired.activeAccountId !== null &&
      !repaired.accounts.some((a) => a.id === repaired.activeAccountId)
    ) {
      logger?.warn(
        "[pier.claude] active account missing from metadata, clearing selection",
        { activeAccountId: repaired.activeAccountId }
      );
      repaired = { ...repaired, activeAccountId: null };
      dirty = true;
    }
    return repaired;
  }

  async function persistMarker(): Promise<void> {
    const marker = dataSchemaMarkerSchema.parse({
      schemas: {
        [DATA_SCHEMA_ID]: {
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
    async init(): Promise<ClaudeAccountsFileState> {
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, "utf8");
          state = repairState(accountsStateSchema.parse(JSON.parse(raw)));
        } catch (error) {
          await quarantineCorruptFile(filePath, error);
          state = DEFAULTS;
        }
      }
      if (existsSync(markerPath)) {
        try {
          const markerRaw = await readFile(markerPath, "utf8");
          dataSchemaMarkerSchema.parse(JSON.parse(markerRaw));
        } catch (error) {
          await quarantineCorruptFile(markerPath, error);
        }
      }
      return state;
    },
    mutate(fn): ClaudeAccountsFileState {
      state = fn(state);
      dirty = true;
      return state;
    },
  };
}
