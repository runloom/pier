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
});
