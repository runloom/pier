import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { CrossToolSyncTarget } from "../shared/accounts.ts";

/**
 * Cross-tool Grok/xAI credential sync.
 *
 * Verified local shapes (2026-07-15):
 * - Grok `~/.grok/auth.json` OIDC entry: `{ key, refresh_token, expires_at, user_id, email, ... }`
 * - OpenCode `~/.local/share/opencode/auth.json`: provider key `xai`
 *   - oauth: `{ type: "oauth", access, refresh, expires, accountId? }`
 *   - api: `{ type: "api", key }`
 * - pi `~/.pi/agent/auth.json`: provider key `xai`
 *   - api only: `{ type: "api_key", key }`
 *   - no xAI OAuth handler; OIDC sync must not write a fake oauth entry
 * - omp `~/.omp/agent/agent.db` `auth_credentials`:
 *   - provider `xai-oauth`, credential_type `oauth`,
 *     identity_key `account:<user_id>`,
 *     data `{ access, refresh, expires }`
 *   - api_key rows use provider `xai`, credential_type `api_key`, data `{ key }`
 */

export type GrokSyncCredential =
  | {
      kind: "oauth";
      accessToken: string;
      accountId: string;
      email?: string;
      expiresAtMs: number;
      refreshToken: string;
    }
  | {
      kind: "api_key";
      apiKey: string;
      label?: string;
    };

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

function oauthAuthEntry(
  tokens: Extract<GrokSyncCredential, { kind: "oauth" }>
) {
  return {
    type: "oauth",
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    accountId: tokens.accountId,
    expires: tokens.expiresAtMs,
  };
}

function opencodeAuthEntry(credential: GrokSyncCredential) {
  if (credential.kind === "oauth") {
    return oauthAuthEntry(credential);
  }
  return {
    type: "api",
    key: credential.apiKey,
  };
}

function piAuthEntry(credential: GrokSyncCredential) {
  if (credential.kind === "oauth") {
    throw new Error(
      "pi does not support xAI OAuth; sync a Grok API-key account or set XAI_API_KEY"
    );
  }
  // pi AuthStorage only accepts type "api_key" (not OpenCode's "api").
  return {
    type: "api_key",
    key: credential.apiKey,
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
  credential: GrokSyncCredential,
  opts: CrossToolSyncOptions
): Promise<void> {
  await syncJsonProvider(
    opencodeAuthPath(opts),
    "xai",
    opencodeAuthEntry(credential)
  );
}

async function syncPi(
  credential: GrokSyncCredential,
  opts: CrossToolSyncOptions
): Promise<void> {
  await syncJsonProvider(piAuthPath(opts), "xai", piAuthEntry(credential));
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
  credential: GrokSyncCredential,
  opts: CrossToolSyncOptions
): Promise<void> {
  const dbPath = ompDbPath(opts);
  if (!existsSync(dbPath) && credential.kind === "oauth") {
    // Match Codex: require omp to have been opened at least once.
    throw new Error("omp database not found");
  }
  if (!existsSync(dirname(dbPath))) {
    await mkdir(dirname(dbPath), { recursive: true });
  }

  const require = createRequire(import.meta.url);
  // Prefer node:sqlite DatabaseSync when available (Node 22+).
  let DatabaseSync: new (path: string) => DatabaseSyncLike;
  try {
    ({ DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => DatabaseSyncLike;
    });
  } catch {
    throw new Error("omp database driver unavailable (node:sqlite)");
  }

  const db = new DatabaseSync(dbPath);
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    if (credential.kind === "oauth") {
      const identityKey = `account:${credential.accountId}`;
      const data = JSON.stringify({
        access: credential.accessToken,
        refresh: credential.refreshToken,
        expires: credential.expiresAtMs,
      });
      runImmediateTransaction(db, () => {
        const row = db.prepare(
          "SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?"
        ) as PreparedStmt;
        const existing = row.get("xai-oauth", identityKey) as
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
          insert.run("xai-oauth", "oauth", data, identityKey, nowSec, nowSec);
          targetId = Number(
            (
              (
                db.prepare("SELECT last_insert_rowid() AS id") as PreparedStmt
              ).get() as { id: number } | undefined
            )?.id
          );
        }
        // Disable other xai-oauth rows so omp's credential selector can only
        // pick the active account. omp selects the most recently updated
        // non-disabled row; leaving stale rows enabled lets it choose a
        // wrong-account token after a switch.
        const disableOthers = db.prepare(
          "UPDATE auth_credentials SET disabled_cause = 'superseded by active account', updated_at = ? WHERE provider = ? AND id != ? AND disabled_cause IS NULL"
        ) as PreparedStmt;
        disableOthers.run(nowSec, "xai-oauth", targetId);
      });
      return;
    }

    const data = JSON.stringify({ key: credential.apiKey });
    runImmediateTransaction(db, () => {
      const row = db.prepare(
        "SELECT id FROM auth_credentials WHERE provider = ? AND credential_type = ? AND identity_key IS NULL"
      ) as PreparedStmt;
      const existing = row.get("xai", "api_key") as { id: number } | undefined;
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
        insert.run("xai", "api_key", data, null, nowSec, nowSec);
        targetId = Number(
          (
            (
              db.prepare("SELECT last_insert_rowid() AS id") as PreparedStmt
            ).get() as { id: number } | undefined
          )?.id
        );
      }
      const disableOthers = db.prepare(
        "UPDATE auth_credentials SET disabled_cause = 'superseded by active API key', updated_at = ? WHERE provider = ? AND credential_type = ? AND id != ? AND disabled_cause IS NULL"
      ) as PreparedStmt;
      disableOthers.run(nowSec, "xai", "api_key", targetId);
    });
  } finally {
    db.close();
  }
}

export async function syncCrossToolCredentials(
  targets: readonly CrossToolSyncTarget[],
  credential: GrokSyncCredential,
  opts: CrossToolSyncOptions = {}
): Promise<SyncTargetResult[]> {
  const results: SyncTargetResult[] = [];
  for (const target of targets) {
    if (target === "grok") continue;
    try {
      switch (target) {
        case "opencode":
          await syncOpencode(credential, opts);
          break;
        case "pi":
          await syncPi(credential, opts);
          break;
        case "omp":
          await syncOmp(credential, opts);
          break;
        default:
          break;
      }
      results.push({ target, ok: true });
      opts.logger?.info(`[pier.grok] cross-tool sync: ${target} ok`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ target, ok: false, error: message });
      opts.logger?.warn(`[pier.grok] cross-tool sync: ${target} failed`, {
        error: message,
      });
    }
  }
  return results;
}

/**
 * Extract oauth credential from managed Grok auth.json content.
 */
export function extractOauthFromGrokAuth(
  authContent: string
): Extract<GrokSyncCredential, { kind: "oauth" }> {
  const data = JSON.parse(authContent) as unknown;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid Grok auth.json");
  }

  const parseEntryTime = (value: unknown): number => {
    if (typeof value === "string" && value.length > 0) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Number.NEGATIVE_INFINITY;
  };

  let best: {
    createTime: number;
    entry: Record<string, unknown>;
    entryKey: string;
    expiresAt: number;
  } | null = null;

  for (const [entryKey, value] of Object.entries(data)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    const key = entry.key;
    if (typeof key !== "string" || key.length === 0) continue;
    const createTime = parseEntryTime(entry.create_time);
    const expiresAt = parseEntryTime(entry.expires_at);
    if (
      !best ||
      createTime > best.createTime ||
      (createTime === best.createTime && expiresAt > best.expiresAt)
    ) {
      best = { createTime, entry, entryKey, expiresAt };
    }
  }
  if (!best) {
    throw new Error("No usable Grok OIDC entry in auth.json");
  }

  const accessToken = String(best.entry.key);
  if (
    typeof best.entry.refresh_token !== "string" ||
    best.entry.refresh_token.length === 0
  ) {
    // Peers would try to refresh with whatever sits in `refresh`; writing the
    // access token there just produces confusing downstream auth failures.
    throw new Error(
      "Grok login has no refresh token; re-login before syncing to other tools"
    );
  }
  const refreshToken = best.entry.refresh_token;
  let accountId = best.entryKey;
  if (typeof best.entry.user_id === "string" && best.entry.user_id.length > 0) {
    accountId = best.entry.user_id;
  } else if (
    typeof best.entry.principal_id === "string" &&
    best.entry.principal_id.length > 0
  ) {
    accountId = best.entry.principal_id;
  }
  const email =
    typeof best.entry.email === "string" && best.entry.email.length > 0
      ? best.entry.email
      : undefined;

  let expiresAtMs = Date.now() + 10 * 60 * 1000;
  if (typeof best.entry.expires_at === "string") {
    const ms = Date.parse(best.entry.expires_at);
    if (Number.isFinite(ms)) expiresAtMs = ms;
  } else {
    // Try JWT exp on access token.
    try {
      const parts = accessToken.split(".");
      const payloadSegment = parts[1];
      if (parts.length === 3 && payloadSegment) {
        const payload = JSON.parse(
          Buffer.from(payloadSegment, "base64url").toString("utf-8")
        ) as { exp?: number };
        if (typeof payload.exp === "number") {
          expiresAtMs = payload.exp * 1000;
        }
      }
    } catch {
      /* fallback */
    }
  }

  return {
    kind: "oauth",
    accessToken,
    refreshToken,
    accountId,
    expiresAtMs,
    ...(email ? { email } : {}),
  };
}
