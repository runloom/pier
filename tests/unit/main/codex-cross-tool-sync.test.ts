// @vitest-environment node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { syncCrossToolCredentials } from "../../../packages/plugin-codex/src/main/cross-tool-sync.ts";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { force: true, recursive: true });
    dir = "";
  }
});

function seedOmpDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
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
  db.close();
}

describe("cross-tool omp credential sync", () => {
  it("writes openai-codex oauth credentials into omp agent.db", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-codex-cross-tool-"));
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    seedOmpDb(dbPath);

    const results = await syncCrossToolCredentials(
      ["omp"],
      {
        accessToken: "access-token",
        accountId: "acct-1",
        email: "user@example.com",
        expiresAtMs: 1_700_000_000_000,
        refreshToken: "refresh-token",
      },
      { homeDir: dir }
    );

    expect(results).toEqual([{ ok: true, target: "omp" }]);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare(
        "SELECT provider, credential_type, identity_key, data FROM auth_credentials WHERE provider = ?"
      )
      .get("openai-codex") as {
      credential_type: string;
      data: string;
      identity_key: string;
      provider: string;
    };
    db.close();

    expect(row).toMatchObject({
      credential_type: "oauth",
      identity_key: "email:user@example.com",
      provider: "openai-codex",
    });
    expect(JSON.parse(row.data)).toMatchObject({
      access: "access-token",
      accountId: "acct-1",
      email: "user@example.com",
      refresh: "refresh-token",
    });
  });

  it("rolls back a new omp identity when disabling the old row fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-codex-cross-tool-rollback-"));
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    seedOmpDb(dbPath);

    const seedDb = new DatabaseSync(dbPath);
    const nowSec = Math.floor(Date.now() / 1000);
    seedDb
      .prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        "openai-codex",
        "oauth",
        JSON.stringify({ access: "old-token", refresh: "old-refresh" }),
        "email:old@example.com",
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

    const results = await syncCrossToolCredentials(
      ["omp"],
      {
        accessToken: "new-token",
        accountId: "acct-new",
        email: "new@example.com",
        expiresAtMs: 1_700_000_000_000,
        refreshToken: "new-refresh",
      },
      { homeDir: dir }
    );

    expect(results).toMatchObject([{ ok: false, target: "omp" }]);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const oldRow = db
      .prepare(
        "SELECT disabled_cause FROM auth_credentials WHERE provider = ? AND identity_key = ?"
      )
      .get("openai-codex", "email:old@example.com") as {
      disabled_cause: string | null;
    };
    const newRow = db
      .prepare(
        "SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?"
      )
      .get("openai-codex", "email:new@example.com");
    db.close();

    expect(oldRow.disabled_cause).toBeNull();
    expect(newRow).toBeUndefined();
  });

  it("disables other openai-codex oauth rows when syncing a different account", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-codex-cross-tool-multi-"));
    const ompHome = join(dir, ".omp", "agent");
    await mkdir(ompHome, { recursive: true });
    const dbPath = join(ompHome, "agent.db");
    seedOmpDb(dbPath);

    // Seed an existing row for a different account.
    const seedDb = new DatabaseSync(dbPath);
    const nowSec = Math.floor(Date.now() / 1000);
    seedDb
      .prepare(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        "openai-codex",
        "oauth",
        JSON.stringify({ access: "old-token", refresh: "old-refresh" }),
        "email:old@example.com",
        nowSec,
        nowSec
      );
    seedDb.close();

    await syncCrossToolCredentials(
      ["omp"],
      {
        accessToken: "new-token",
        accountId: "acct-new",
        email: "new@example.com",
        expiresAtMs: 1_700_000_000_000,
        refreshToken: "new-refresh",
      },
      { homeDir: dir }
    );

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT identity_key, disabled_cause, data FROM auth_credentials WHERE provider = ? ORDER BY id"
      )
      .all("openai-codex") as {
      data: string;
      disabled_cause: string | null;
      identity_key: string;
    }[];
    db.close();

    expect(rows).toHaveLength(2);
    const oldRow = rows.find((r) => r.identity_key === "email:old@example.com");
    const newRow = rows.find((r) => r.identity_key === "email:new@example.com");
    expect(oldRow).toBeDefined();
    expect(oldRow?.disabled_cause).toBe("superseded by active account");
    expect(newRow).toBeDefined();
    expect(newRow?.disabled_cause).toBeNull();
    expect(JSON.parse(newRow?.data ?? "{}")).toMatchObject({
      access: "new-token",
    });
  });
});
