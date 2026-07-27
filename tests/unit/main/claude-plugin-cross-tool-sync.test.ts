// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractTokensFromClaudeEnvelope,
  syncCrossToolCredentials,
} from "../../../packages/plugin-claude/src/main/cross-tool-sync.ts";

const ENVELOPE = JSON.stringify({
  claudeAiOauth: {
    accessToken: "access-token-claude",
    expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
    refreshToken: "refresh-token-claude",
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "pro",
  },
});

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-claude-cross-tool-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("claude cross-tool sync", () => {
  it("extracts oauth tokens from a Claude credential envelope", () => {
    expect(
      extractTokensFromClaudeEnvelope(ENVELOPE, {
        accountId: "acct-1",
        email: "user@example.com",
      })
    ).toMatchObject({
      accessToken: "access-token-claude",
      accountId: "acct-1",
      email: "user@example.com",
      expiresAtMs: Date.parse("2099-01-01T00:00:00.000Z"),
      refreshToken: "refresh-token-claude",
    });
  });

  it("rejects envelopes without a refresh token", () => {
    expect(() =>
      extractTokensFromClaudeEnvelope(
        JSON.stringify({
          claudeAiOauth: { accessToken: "only-access" },
        })
      )
    ).toThrow(/refresh token/i);
  });

  it("writes anthropic oauth into opencode and pi, preserving unrelated providers", async () => {
    const opencodeDataDir = join(dir, "opencode");
    const homeDir = join(dir, "home");
    await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
    await writeFile(
      join(homeDir, ".pi", "agent", "auth.json"),
      JSON.stringify({ openai: { type: "api_key", key: "keep-me" } }, null, 2),
      "utf8"
    );
    const tokens = extractTokensFromClaudeEnvelope(ENVELOPE, {
      accountId: "acct-1",
      email: "user@example.com",
    });
    const results = await syncCrossToolCredentials(["opencode", "pi"], tokens, {
      homeDir,
      opencodeDataDir,
    });
    expect(results).toEqual([
      { ok: true, target: "opencode" },
      { ok: true, target: "pi" },
    ]);

    const opencodeAuth = JSON.parse(
      await readFile(join(opencodeDataDir, "auth.json"), "utf8")
    ) as {
      anthropic: {
        access: string;
        accountId: string;
        expires: number;
        refresh: string;
        type: string;
      };
    };
    expect(opencodeAuth.anthropic).toMatchObject({
      access: "access-token-claude",
      accountId: "acct-1",
      expires: tokens.expiresAtMs,
      refresh: "refresh-token-claude",
      type: "oauth",
    });

    const piAuth = JSON.parse(
      await readFile(join(homeDir, ".pi", "agent", "auth.json"), "utf8")
    ) as {
      anthropic: {
        access: string;
        accountId: string;
        expires: number;
        refresh: string;
        type: string;
      };
      openai: { key: string; type: string };
    };
    expect(piAuth.openai).toEqual({ type: "api_key", key: "keep-me" });
    expect(piAuth.anthropic).toMatchObject({
      access: "access-token-claude",
      accountId: "acct-1",
      expires: tokens.expiresAtMs,
      refresh: "refresh-token-claude",
      type: "oauth",
    });
  });

  it("upserts omp anthropic oauth and disables other anthropic rows", async () => {
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
        "anthropic",
        "oauth",
        JSON.stringify({ access: "old", refresh: "old-r", expires: 1 }),
        "email:other@example.com",
        nowSec,
        nowSec
      );
    seedDb.close();

    const tokens = extractTokensFromClaudeEnvelope(ENVELOPE, {
      accountId: "acct-1",
      email: "user@example.com",
    });
    const results = await syncCrossToolCredentials(["omp"], tokens, {
      homeDir: dir,
    });
    expect(results).toEqual([{ ok: true, target: "omp" }]);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT identity_key, data, disabled_cause FROM auth_credentials WHERE provider = ? ORDER BY id"
      )
      .all("anthropic") as {
      data: string;
      disabled_cause: string | null;
      identity_key: string;
    }[];
    db.close();

    expect(rows).toHaveLength(2);
    const active = rows.find(
      (row) => row.identity_key === "email:user@example.com"
    );
    expect(active?.disabled_cause).toBeNull();
    expect(JSON.parse(active?.data ?? "{}")).toMatchObject({
      access: "access-token-claude",
      accountId: "acct-1",
      email: "user@example.com",
      refresh: "refresh-token-claude",
    });
    const other = rows.find(
      (row) => row.identity_key === "email:other@example.com"
    );
    expect(other?.disabled_cause).toMatch(/superseded/i);
  });
});
