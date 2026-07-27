import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import { parseCredentialEnvelope } from "./oauth.ts";

/**
 * Cross-tool Anthropic (Claude Pro/Max) OAuth credential sync.
 *
 * Peer tools share the same Claude Code OAuth client
 * (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`). Access/refresh tokens from Pier's
 * managed Claude accounts can be mirrored into:
 *
 * - OpenCode `~/.local/share/opencode/auth.json`:
 *   `{ anthropic: { type: "oauth", access, refresh, expires, accountId? } }`
 * - pi `~/.pi/agent/auth.json`:
 *   `{ anthropic: { type: "oauth", access, refresh, expires, accountId? } }`
 * - omp `~/.omp/agent/agent.db` `auth_credentials`:
 *   provider `anthropic`, credential_type `oauth`,
 *   identity_key `email:<email>` or `account:<uuid>`,
 *   data `{ access, refresh, expires, accountId?, email? }`
 *
 * Each target is synced independently — a failure in one does not abort the
 * others.
 */

export interface ClaudeSyncTokenSet {
  accessToken: string;
  /** Stable Anthropic account uuid when known (omp identity / peer metadata). */
  accountId?: string | undefined;
  email?: string | undefined;
  /** Access token expiry in epoch milliseconds. */
  expiresAtMs: number;
  refreshToken: string;
}

export interface SyncTargetResult {
  error?: string;
  ok: boolean;
  target: CrossToolSyncTarget;
}

export interface CrossToolSyncOptions {
  homeDir?: string;
  logger?: {
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  opencodeDataDir?: string;
}

function defaultHomeDir(): string {
  return homedir();
}

function opencodeAuthPath(opts: CrossToolSyncOptions): string {
  const dataDir =
    opts.opencodeDataDir ??
    join(defaultHomeDir(), ".local", "share", "opencode");
  return join(dataDir, "auth.json");
}

function piAuthPath(opts: CrossToolSyncOptions): string {
  const home = opts.homeDir ?? defaultHomeDir();
  return join(home, ".pi", "agent", "auth.json");
}

function ompDbPath(opts: CrossToolSyncOptions): string {
  const home = opts.homeDir ?? defaultHomeDir();
  return join(home, ".omp", "agent", "agent.db");
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* start fresh */
  }
  return {};
}

function oauthAuthEntry(tokens: ClaudeSyncTokenSet): Record<string, unknown> {
  return {
    type: "oauth",
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: tokens.expiresAtMs,
    ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
  };
}

async function syncJsonProvider(
  path: string,
  providerKey: string,
  entry: Record<string, unknown>
): Promise<void> {
  const existing = await readJsonObject(path);
  const updated = {
    ...existing,
    [providerKey]: entry,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(updated, null, 2), {
    mode: 0o600,
  });
}

async function syncOpencode(
  tokens: ClaudeSyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  await syncJsonProvider(
    opencodeAuthPath(opts),
    "anthropic",
    oauthAuthEntry(tokens)
  );
}

async function syncPi(
  tokens: ClaudeSyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  await syncJsonProvider(piAuthPath(opts), "anthropic", oauthAuthEntry(tokens));
}

interface DatabaseSyncLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): PreparedStmt;
}

function runImmediateTransaction<T>(
  db: DatabaseSyncLike,
  operation: () => T
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "OMP credential update and rollback failed"
      );
    }
    throw error;
  }
}

interface PreparedStmt {
  get(...params: BindValue[]): unknown;
  run(...params: BindValue[]): void;
}

type BindValue = string | number | null;

async function syncOmp(
  tokens: ClaudeSyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  const dbPath = ompDbPath(opts);
  if (!existsSync(dbPath)) {
    throw new Error("omp database not found");
  }

  const nodeRequire = createRequire(import.meta.url);
  let DatabaseSync: new (
    path: string,
    options?: { timeout?: number }
  ) => DatabaseSyncLike;
  try {
    ({ DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        options?: { timeout?: number }
      ) => DatabaseSyncLike;
    });
  } catch {
    throw new Error("omp database driver unavailable (node:sqlite)");
  }

  let identityKey: string | null = null;
  if (tokens.email) {
    identityKey = `email:${tokens.email}`;
  } else if (tokens.accountId) {
    identityKey = `account:${tokens.accountId}`;
  }
  if (!identityKey) {
    throw new Error(
      "Claude account has no email or account id for OMP identity_key"
    );
  }

  const data = JSON.stringify({
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: tokens.expiresAtMs,
    ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
    ...(tokens.email ? { email: tokens.email } : {}),
  });

  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    runImmediateTransaction(db, () => {
      const row = db.prepare(
        "SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?"
      ) as PreparedStmt;
      const existing = row.get("anthropic", identityKey) as
        | { id: number }
        | undefined;
      let targetId: number;
      if (existing) {
        const update = db.prepare(
          "UPDATE auth_credentials SET data = ?, disabled_cause = NULL, updated_at = ? WHERE id = ?"
        ) as PreparedStmt;
        update.run(data, nowSec, existing.id);
        targetId = existing.id;
      } else {
        const insert = db.prepare(
          "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ) as PreparedStmt;
        insert.run("anthropic", "oauth", data, identityKey, nowSec, nowSec);
        targetId = Number(
          (
            (
              db.prepare("SELECT last_insert_rowid() AS id") as PreparedStmt
            ).get() as { id: number } | undefined
          )?.id
        );
      }
      const disableOthers = db.prepare(
        "UPDATE auth_credentials SET disabled_cause = 'superseded by active account', updated_at = ? WHERE provider = ? AND id != ? AND disabled_cause IS NULL"
      ) as PreparedStmt;
      disableOthers.run(nowSec, "anthropic", targetId);
    });
  } finally {
    db.close();
  }
}

export async function syncCrossToolCredentials(
  targets: readonly CrossToolSyncTarget[],
  tokens: ClaudeSyncTokenSet,
  opts: CrossToolSyncOptions = {}
): Promise<SyncTargetResult[]> {
  const results: SyncTargetResult[] = [];
  for (const target of targets) {
    if (target === "claude") continue;
    try {
      switch (target) {
        case "opencode":
          await syncOpencode(tokens, opts);
          break;
        case "pi":
          await syncPi(tokens, opts);
          break;
        case "omp":
          await syncOmp(tokens, opts);
          break;
        default:
          break;
      }
      results.push({ target, ok: true });
      opts.logger?.info(`[pier.claude] cross-tool sync: ${target} ok`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ target, ok: false, error: message });
      opts.logger?.warn(`[pier.claude] cross-tool sync: ${target} failed`, {
        error: message,
      });
    }
  }
  return results;
}

/**
 * Extract oauth tokens from a Claude Code credential envelope string.
 */
export function extractTokensFromClaudeEnvelope(
  envelope: string,
  identity?: { accountId?: string | undefined; email?: string | undefined }
): ClaudeSyncTokenSet {
  const parsed = parseCredentialEnvelope(envelope);
  if (!parsed) {
    throw new Error("Invalid Claude credential envelope");
  }
  if (
    typeof parsed.refreshToken !== "string" ||
    parsed.refreshToken.length === 0
  ) {
    throw new Error(
      "Claude login has no refresh token; re-login before syncing to other tools"
    );
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAtMs:
      typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
        ? parsed.expiresAt
        : Date.now() + 10 * 60 * 1000,
    ...(identity?.accountId ? { accountId: identity.accountId } : {}),
    ...(identity?.email ? { email: identity.email } : {}),
  };
}
