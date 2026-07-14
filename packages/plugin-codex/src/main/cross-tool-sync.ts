import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { CrossToolSyncTarget } from "../shared/accounts.ts";

/**
 * Cross-tool OpenAI OAuth credential sync.
 *
 * All four tools (codex / opencode / pi / omp) share the same OpenAI OAuth
 * client (`app_EMoamEEZ73f0CkXaXp7hrann`), issuer (`https://auth.openai.com`),
 * and audience (`https://api.openai.com/v1`). Their access/refresh tokens are
 * interchangeable — when the user switches the active Codex account, the same
 * token set can be materialized into the peer tools' auth stores so they all
 * use the same ChatGPT account.
 *
 * Token shapes (verified empirically on 2026-07-14):
 *
 * - Codex `~/.codex/auth.json`:
 *   `{ tokens: { access_token, refresh_token, id_token, account_id }, OPENAI_API_KEY, last_refresh }`
 * - opencode `~/.local/share/opencode/auth.json`:
 *   `{ openai: { type: "oauth", access, refresh, accountId, expires } }`
 * - pi `~/.pi/agent/auth.json`:
 *   `{ "openai-codex": { type: "oauth", access, refresh, accountId, expires } }`
 * - omp `~/.omp/agent/agent.db` (SQLite):
 *   `auth_credentials` table: `{ provider, credential_type, data: JSON({access, refresh, accountId, expires, email}), identity_key }`
 *
 * Each target is synced independently — a failure in one does not abort the
 * others. The caller receives per-target results.
 */

export interface SyncTokenSet {
  accessToken: string;
  accountId: string;
  /** Email from the Codex identity, used as omp identity_key. */
  email?: string;
  /**
   * Access token expiry in epoch milliseconds. Derived from the JWT `exp`
   * claim (seconds → ms). If absent, falls back to `Date.now() + 10 min`.
   */
  expiresAtMs: number;
  refreshToken: string;
}

export interface SyncTargetResult {
  error?: string;
  ok: boolean;
  target: CrossToolSyncTarget;
}

export interface CrossToolSyncOptions {
  /** Override home dir for tests. */
  homeDir?: string;
  logger?: {
    warn(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
  };
  /** Override opencode data dir for tests. */
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

/**
 * Sync the given token set into opencode's auth.json.
 * Overwrites the `openai` key in the existing file, preserving other providers.
 */
async function syncOpencode(
  tokens: SyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  const authPath = opencodeAuthPath(opts);
  let existing: Record<string, unknown> = {};
  if (existsSync(authPath)) {
    try {
      const raw = await readFile(authPath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Corrupt or empty file — start fresh with just the openai entry.
      existing = {};
    }
  }
  const updated: Record<string, unknown> = {
    ...existing,
    openai: {
      type: "oauth",
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      accountId: tokens.accountId,
      expires: tokens.expiresAtMs,
    },
  };
  await mkdir(dirname(authPath), { recursive: true });
  await writeFileAtomic(authPath, JSON.stringify(updated, null, 2), {
    mode: 0o600,
  });
}

/**
 * Sync the given token set into pi's auth.json.
 * Overwrites the `openai-codex` key in the existing file, preserving other providers.
 */
async function syncPi(
  tokens: SyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  const authPath = piAuthPath(opts);
  let existing: Record<string, unknown> = {};
  if (existsSync(authPath)) {
    try {
      const raw = await readFile(authPath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const updated: Record<string, unknown> = {
    ...existing,
    "openai-codex": {
      type: "oauth",
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      accountId: tokens.accountId,
      expires: tokens.expiresAtMs,
    },
  };
  await mkdir(dirname(authPath), { recursive: true });
  await writeFileAtomic(authPath, JSON.stringify(updated, null, 2), {
    mode: 0o600,
  });
}

/**
 * Sync the given token set into omp's agent.db (SQLite).
 *
 * omp stores multiple credentials per provider in `auth_credentials`. The
 * "active" credential is the most recently `updated_at` row that is not
 * disabled. To switch accounts we UPSERT a row matching the `identity_key`
 * (`email:<email>`) and bump `updated_at` so it becomes the most recent.
 *
 * If the account already exists as a row, we update its data + clear
 * `disabled_cause` + bump `updated_at`. If not, we insert a new row.
 *
 * Uses `node:sqlite` (Node 24+ built-in, same as the host's opencode scanner).
 * Opens read-write with a 5s busy_timeout to tolerate omp's WAL-mode
 * concurrent access.
 */
async function syncOmp(
  tokens: SyncTokenSet,
  opts: CrossToolSyncOptions
): Promise<void> {
  const dbPath = ompDbPath(opts);
  if (!existsSync(dbPath)) {
    throw new Error(`omp database not found: ${dbPath}`);
  }

  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean; timeout?: number }
    ) => DatabaseSyncLike;
  };

  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    const identityKey = tokens.email
      ? `email:${tokens.email}`
      : `account:${tokens.accountId}`;

    const data = JSON.stringify({
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      accountId: tokens.accountId,
      expires: tokens.expiresAtMs,
      ...(tokens.email ? { email: tokens.email } : {}),
    });

    const nowSec = Math.floor(Date.now() / 1000);

    // Check if a row with this identity_key already exists.
    const row = db.prepare(
      "SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?"
    ) as PreparedStmt;
    const existing = row.get(["openai-codex", identityKey]) as
      | { id: number }
      | undefined;

    if (existing) {
      const update = db.prepare(
        "UPDATE auth_credentials SET data = ?, disabled_cause = NULL, updated_at = ? WHERE id = ?"
      ) as PreparedStmt;
      update.run([data, nowSec, existing.id]);
    } else {
      const insert = db.prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ) as PreparedStmt;
      insert.run(["openai-codex", "oauth", data, identityKey, nowSec, nowSec]);
    }
  } finally {
    db.close();
  }
}

interface DatabaseSyncLike {
  close(): void;
  prepare(sql: string): PreparedStmt;
}

interface PreparedStmt {
  get(params: BindValue[]): unknown;
  run(params: BindValue[]): void;
}

type BindValue = string | number | null;

/**
 * Sync the token set into the specified peer tools. Each target is synced
 * independently — a failure in one target does not abort the others.
 *
 * `"codex"` is handled by the caller (the existing `provider.materialize`
 * call in `doSelect`); this function only handles peer tools.
 */
export async function syncCrossToolCredentials(
  targets: readonly CrossToolSyncTarget[],
  tokens: SyncTokenSet,
  opts: CrossToolSyncOptions = {}
): Promise<SyncTargetResult[]> {
  const results: SyncTargetResult[] = [];

  for (const target of targets) {
    // "codex" is the primary switch — handled by materialize, not here.
    if (target === "codex") continue;

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
      opts.logger?.info(`[pier.codex] cross-tool sync: ${target} ok`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ target, ok: false, error: message });
      opts.logger?.warn(`[pier.codex] cross-tool sync: ${target} failed`, {
        error: message,
      });
    }
  }

  return results;
}

/**
 * Extract a `SyncTokenSet` from a Codex `auth.json` content string.
 * Parses the access_token JWT to derive `expiresAtMs` from the `exp` claim.
 */
export function extractTokenSetFromCodexAuth(
  authContent: string,
  email?: string
): SyncTokenSet {
  const auth = JSON.parse(authContent) as {
    tokens: {
      access_token: string;
      refresh_token: string;
      account_id: string;
    };
  };

  const accessToken = auth.tokens.access_token;
  const refreshToken = auth.tokens.refresh_token;
  const accountId = auth.tokens.account_id;

  // Derive expiry from the access_token JWT `exp` claim (seconds → ms).
  let expiresAtMs = Date.now() + 10 * 60 * 1000; // fallback: 10 min
  try {
    const parts = accessToken.split(".");
    const payloadSegment = parts[1];
    if (parts.length === 3 && payloadSegment !== undefined) {
      const payload = JSON.parse(
        Buffer.from(payloadSegment, "base64url").toString("utf-8")
      ) as { exp?: number };
      if (typeof payload.exp === "number") {
        expiresAtMs = payload.exp * 1000;
      }
    }
  } catch {
    // If JWT parsing fails, use the fallback expiry.
  }

  return {
    accessToken,
    refreshToken,
    accountId,
    ...(email ? { email } : {}),
    expiresAtMs,
  };
}
