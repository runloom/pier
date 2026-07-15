// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractOauthFromGrokAuth,
  syncCrossToolCredentials,
} from "../../../packages/plugin-grok/src/main/cross-tool-sync.ts";

const AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    auth_mode: "oidc",
    create_time: "2026-01-01T00:00:00.000Z",
    email: "user@example.com",
    expires_at: "2099-01-01T00:00:00.000Z",
    key: "access-token-xyz",
    refresh_token: "refresh-token-xyz",
    user_id: "user-1",
  },
});

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-cross-tool-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("grok cross-tool sync", () => {
  it("extracts oauth tokens from managed auth.json", () => {
    expect(extractOauthFromGrokAuth(AUTH)).toMatchObject({
      accountId: "user-1",
      accessToken: "access-token-xyz",
      email: "user@example.com",
      kind: "oauth",
      refreshToken: "refresh-token-xyz",
    });
  });

  it("writes xai oauth into opencode and rejects oauth for pi", async () => {
    const opencodeDataDir = join(dir, "opencode");
    const homeDir = join(dir, "home");
    await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(homeDir, ".pi", "agent", "auth.json"),
      JSON.stringify(
        { anthropic: { type: "api_key", key: "keep-me" } },
        null,
        2
      ),
      "utf8"
    );
    const credential = extractOauthFromGrokAuth(AUTH);
    const results = await syncCrossToolCredentials(
      ["opencode", "pi"],
      credential,
      { homeDir, opencodeDataDir }
    );
    expect(results).toEqual([
      { ok: true, target: "opencode" },
      {
        error:
          "pi does not support xAI OAuth; sync a Grok API-key account or set XAI_API_KEY",
        ok: false,
        target: "pi",
      },
    ]);

    const opencodeAuth = JSON.parse(
      await readFile(join(opencodeDataDir, "auth.json"), "utf8")
    ) as {
      xai: {
        access: string;
        accountId: string;
        expires: number;
        refresh: string;
        type: string;
      };
    };
    expect(opencodeAuth.xai).toMatchObject({
      access: "access-token-xyz",
      accountId: "user-1",
      refresh: "refresh-token-xyz",
      type: "oauth",
    });

    const piAuth = JSON.parse(
      await readFile(join(homeDir, ".pi", "agent", "auth.json"), "utf8")
    ) as Record<string, unknown>;
    // OAuth must not be written; leave existing unrelated providers alone.
    expect(piAuth.xai).toBeUndefined();
    expect(piAuth.anthropic).toEqual({ type: "api_key", key: "keep-me" });
  });

  it("writes xai api key into opencode and pi auth.json with tool-specific types", async () => {
    const opencodeDataDir = join(dir, "opencode-api");
    const homeDir = join(dir, "home-api");
    const results = await syncCrossToolCredentials(
      ["opencode", "pi"],
      { apiKey: "xai-secret", kind: "api_key" },
      { homeDir, opencodeDataDir }
    );
    expect(results).toEqual([
      { ok: true, target: "opencode" },
      { ok: true, target: "pi" },
    ]);
    const opencodeAuth = JSON.parse(
      await readFile(join(opencodeDataDir, "auth.json"), "utf8")
    ) as { xai: { key: string; type: string } };
    expect(opencodeAuth.xai).toEqual({ key: "xai-secret", type: "api" });

    const piAuth = JSON.parse(
      await readFile(join(homeDir, ".pi", "agent", "auth.json"), "utf8")
    ) as { xai: { key: string; type: string } };
    expect(piAuth.xai).toEqual({ key: "xai-secret", type: "api_key" });
  });

  it("rolls back an omp API-key selection when disabling another API-key row fails", async () => {
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    const seedDb = new DatabaseSync(dbPath);
    seedDb.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT DEFAULT NULL,
        identity_key TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const nowSec = Math.floor(Date.now() / 1000);
    const insert = seedDb.prepare(
      "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insert.run(
      "xai",
      "api_key",
      JSON.stringify({ key: "old-target" }),
      null,
      nowSec,
      nowSec
    );
    insert.run(
      "xai",
      "api_key",
      JSON.stringify({ key: "old-other" }),
      "duplicate",
      nowSec,
      nowSec
    );
    seedDb.exec(`
      CREATE TRIGGER fail_api_key_disable
      BEFORE UPDATE OF disabled_cause ON auth_credentials
      WHEN OLD.identity_key = 'duplicate' AND NEW.disabled_cause IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'disable failed');
      END;
    `);
    seedDb.close();

    const results = await syncCrossToolCredentials(
      ["omp"],
      { apiKey: "new-secret", kind: "api_key" },
      { homeDir: dir }
    );

    expect(results).toMatchObject([{ ok: false, target: "omp" }]);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT data, disabled_cause FROM auth_credentials WHERE provider = ? AND credential_type = ? ORDER BY id"
      )
      .all("xai", "api_key") as {
      data: string;
      disabled_cause: string | null;
    }[];
    db.close();

    expect(rows.map((row) => JSON.parse(row.data))).toEqual([
      { key: "old-target" },
      { key: "old-other" },
    ]);
    expect(rows.map((row) => row.disabled_cause)).toEqual([null, null]);
  });

  it("selects one omp API key without disabling xai-oauth rows", async () => {
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    const seedDb = new DatabaseSync(dbPath);
    seedDb.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT DEFAULT NULL,
        identity_key TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const nowSec = Math.floor(Date.now() / 1000);
    const insert = seedDb.prepare(
      "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insert.run(
      "xai",
      "api_key",
      JSON.stringify({ key: "old-target" }),
      null,
      nowSec,
      nowSec
    );
    insert.run(
      "xai",
      "api_key",
      JSON.stringify({ key: "old-other" }),
      "duplicate",
      nowSec,
      nowSec
    );
    insert.run(
      "xai-oauth",
      "oauth",
      JSON.stringify({ access: "oauth-token" }),
      "account:oauth-user",
      nowSec,
      nowSec
    );
    seedDb.close();

    await syncCrossToolCredentials(
      ["omp"],
      { apiKey: "new-secret", kind: "api_key" },
      { homeDir: dir }
    );

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const apiRows = db
      .prepare(
        "SELECT data, disabled_cause FROM auth_credentials WHERE provider = ? AND credential_type = ? ORDER BY id"
      )
      .all("xai", "api_key") as {
      data: string;
      disabled_cause: string | null;
    }[];
    const oauthRow = db
      .prepare(
        "SELECT disabled_cause FROM auth_credentials WHERE provider = ? AND credential_type = ?"
      )
      .get("xai-oauth", "oauth") as { disabled_cause: string | null };
    db.close();

    expect(JSON.parse(apiRows[0]?.data ?? "{}")).toEqual({ key: "new-secret" });
    expect(apiRows[0]?.disabled_cause).toBeNull();
    expect(apiRows[1]?.disabled_cause).toBe("superseded by active API key");
    expect(oauthRow.disabled_cause).toBeNull();
  });

  it("rolls back a new omp identity when disabling the old row fails", async () => {
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    const seedDb = new DatabaseSync(dbPath);
    seedDb.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT DEFAULT NULL,
        identity_key TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const nowSec = Math.floor(Date.now() / 1000);
    seedDb
      .prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        "xai-oauth",
        "oauth",
        JSON.stringify({ access: "old-token", refresh: "old-refresh" }),
        "account:old-user",
        nowSec,
        nowSec
      );
    seedDb.exec(`
      CREATE TRIGGER fail_disable
      BEFORE UPDATE OF disabled_cause ON auth_credentials
      WHEN NEW.disabled_cause IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'disable failed');
      END;
    `);
    seedDb.close();

    const credential = extractOauthFromGrokAuth(AUTH);
    const results = await syncCrossToolCredentials(["omp"], credential, {
      homeDir: dir,
    });

    expect(results).toMatchObject([{ ok: false, target: "omp" }]);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const oldRow = db
      .prepare(
        "SELECT disabled_cause FROM auth_credentials WHERE provider = ? AND identity_key = ?"
      )
      .get("xai-oauth", "account:old-user") as {
      disabled_cause: string | null;
    };
    const newRow = db
      .prepare(
        "SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?"
      )
      .get("xai-oauth", "account:user-1");
    db.close();

    expect(oldRow.disabled_cause).toBeNull();
    expect(newRow).toBeUndefined();
  });

  it("disables other xai-oauth rows in omp when syncing a different account", async () => {
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    const seedDb = new DatabaseSync(dbPath);
    seedDb.exec(`
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        data TEXT NOT NULL,
        disabled_cause TEXT DEFAULT NULL,
        identity_key TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const nowSec = Math.floor(Date.now() / 1000);
    seedDb
      .prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        "xai-oauth",
        "oauth",
        JSON.stringify({ access: "old-token", refresh: "old-refresh" }),
        "account:old-user",
        nowSec,
        nowSec
      );
    seedDb.close();

    const credential = extractOauthFromGrokAuth(AUTH);
    await syncCrossToolCredentials(["omp"], credential, { homeDir: dir });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT identity_key, disabled_cause, data FROM auth_credentials WHERE provider = ? ORDER BY id"
      )
      .all("xai-oauth") as {
      data: string;
      disabled_cause: string | null;
      identity_key: string;
    }[];
    db.close();

    expect(rows).toHaveLength(2);
    const oldRow = rows.find((r) => r.identity_key === "account:old-user");
    const newRow = rows.find((r) => r.identity_key === "account:user-1");
    expect(oldRow).toBeDefined();
    expect(oldRow?.disabled_cause).toBe("superseded by active account");
    expect(newRow).toBeDefined();
    expect(newRow?.disabled_cause).toBeNull();
    expect(JSON.parse(newRow?.data ?? "{}")).toMatchObject({
      access: "access-token-xyz",
    });
  });
});
