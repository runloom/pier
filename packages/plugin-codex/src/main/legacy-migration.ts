import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { CodexAccountRecord, CodexAccountsStateStore } from "./state.ts";

export interface CodexLegacyMigrationAdapter {
  readonly legacyAgentAccountsBaseDir: string;
  readonly legacyAgentAccountsStateFile: string;
  readLegacyAuthJson(accountId: string): Promise<string | null>;
  readLegacySecretsStoreEntry(key: string): Promise<string | null>;
  readLegacyStateFile(): Promise<string | null>;
}

export interface MigrateLegacyAccountsOptions {
  ensureManagedDir(accountId: string): Promise<string>;
  legacyMigration?: CodexLegacyMigrationAdapter;
  now(): number;
  stateStore: CodexAccountsStateStore;
}

export interface LegacyMigrationResult {
  activeAccountId: string | null;
  migrated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export async function migrateLegacyAccountsToState(
  options: MigrateLegacyAccountsOptions
): Promise<LegacyMigrationResult> {
  const { legacyMigration, stateStore } = options;
  if (!legacyMigration || stateStore.get().accounts.length > 0) {
    return { activeAccountId: null, migrated: false };
  }
  const raw = await legacyMigration.readLegacyStateFile();
  if (!raw) {
    return { activeAccountId: null, migrated: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { activeAccountId: null, migrated: false };
  }
  if (!(isRecord(parsed) && Array.isArray(parsed.accounts))) {
    return { activeAccountId: null, migrated: false };
  }

  const migrated: CodexAccountRecord[] = [];
  const seenIds = new Set<string>();
  for (const candidate of parsed.accounts) {
    if (!isRecord(candidate) || candidate.provider !== "codex") {
      continue;
    }
    const id = stringField(candidate, "id");
    const email = stringField(candidate, "email");
    if (!(id && email) || seenIds.has(id)) {
      continue;
    }
    const legacyAuth = await legacyMigration.readLegacyAuthJson(id);
    if (!legacyAuth) {
      continue;
    }
    const dir = await options.ensureManagedDir(id);
    await writeFileAtomic(join(dir, "auth.json"), legacyAuth, {
      mode: 0o600,
    });
    seenIds.add(id);

    const createdAt = numberField(candidate, "createdAt") ?? options.now();
    const updatedAt = numberField(candidate, "updatedAt") ?? createdAt;
    const lastAuthenticatedAt = numberField(candidate, "lastAuthenticatedAt");
    const planType = stringField(candidate, "planType");
    const providerAccountId = stringField(candidate, "providerAccountId");
    migrated.push({
      createdAt,
      email,
      id,
      provider: "codex",
      updatedAt,
      ...(lastAuthenticatedAt === undefined ? {} : { lastAuthenticatedAt }),
      ...(planType ? { planType } : {}),
      ...(providerAccountId ? { providerAccountId } : {}),
    });
  }

  if (migrated.length === 0) {
    return { activeAccountId: null, migrated: false };
  }

  const legacyActiveId = stringField(parsed, "activeAccountId");
  const activeAccountId =
    legacyActiveId && migrated.some((account) => account.id === legacyActiveId)
      ? legacyActiveId
      : (migrated[0]?.id ?? null);
  stateStore.mutate((s) => ({
    ...s,
    accounts: migrated,
    activeAccountId,
    revision: s.revision + 1,
  }));
  return { activeAccountId, migrated: true };
}
