// @vitest-environment node
// node:sqlite 是 Node 24 内置模块，需要 node env 让 vitest 保留 built-in
// 而不是尝试 bundle 到 jsdom client 环境。

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeSqliteScanner } from "../../../../src/main/services/agents/usage-collectors/opencode-sqlite-scanner.ts";

/**
 * OpenCode SQLite scanner smoke tests。用 `node:sqlite` 直接在 tmpdir 建
 * 真实 SQLite 文件（不用 :memory: 因为 openSqliteReader 需要文件路径）。
 *
 * 覆盖点：
 * - DB 缺失 / 表缺失 / 列缺失时优雅返回 schemaValid=false
 * - 完整 schema + assistant 行 → 抽 observation
 * - user 行（无 tokens 字段）跳过、不计入 malformed
 * - malformed JSON data 计入 diagnostics 但不阻塞
 * - cache.read / cache.write 归并策略正确
 * - 时间窗过滤（time_created 老于 cutoff 的行跳过）
 * - message id 作 fingerprint 去重（罕见但保底）
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(): Promise<{ dbPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pier-opencode-sqlite-"));
  tempDirs.push(dir);
  return { dbPath: join(dir, "opencode.db") };
}

function initSchema(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    data TEXT NOT NULL
  )`);
  return db;
}

function insertAssistant(
  db: DatabaseSync,
  opts: {
    cacheRead?: number;
    cacheWrite?: number;
    id?: string;
    input: number;
    modelID?: string;
    output: number;
    reasoning?: number;
    sessionId?: string;
    timeMsAgo?: number;
  }
): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)"
  ).run(
    opts.id ?? "msg_default",
    opts.sessionId ?? "session-1",
    now - (opts.timeMsAgo ?? 60_000),
    JSON.stringify({
      cost: 0.001,
      id: opts.id ?? "msg_default",
      modelID: opts.modelID ?? "claude-sonnet-4-5",
      providerID: "anthropic",
      role: "assistant",
      sessionID: opts.sessionId ?? "session-1",
      time: { created: now - (opts.timeMsAgo ?? 60_000) },
      tokens: {
        cache: {
          read: opts.cacheRead ?? 0,
          write: opts.cacheWrite ?? 0,
        },
        input: opts.input,
        output: opts.output,
        reasoning: opts.reasoning ?? 0,
      },
    })
  );
}

describe("OpenCode SQLite usage scanner", () => {
  it("returns null when the database file does not exist", async () => {
    const { dbPath } = await fixture();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result).toBeNull();
  });

  it("reports schemaValid=false when the message table is missing", async () => {
    const { dbPath } = await fixture();
    // Create empty DB with unrelated table
    const setup = new DatabaseSync(dbPath);
    setup.exec("CREATE TABLE other (x INTEGER)");
    setup.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.diagnostics.schemaValid).toBe(false);
    expect(result?.input.observations).toEqual([]);
  });

  it("reports schemaValid=false when required columns are missing", async () => {
    const { dbPath } = await fixture();
    const setup = new DatabaseSync(dbPath);
    // schema drift: `time_created` missing
    setup.exec(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)"
    );
    setup.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.diagnostics.schemaValid).toBe(false);
  });

  it("extracts assistant tokens and maps cache fields", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    insertAssistant(db, {
      cacheRead: 50,
      cacheWrite: 25,
      id: "msg_a",
      input: 100,
      output: 200,
    });
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.diagnostics.schemaValid).toBe(true);
    expect(result?.input.observations).toHaveLength(1);
    const [observation] = result?.input.observations ?? [];
    expect(observation).toMatchObject({
      cachedInputTokens: 50,
      // 100 raw + 25 cache.write + 50 cache.read
      inputTokens: 175,
      modelId: "claude-sonnet-4-5",
      outputTokens: 200,
      reasoningTokens: 0,
    });
  });

  it("skips user messages (role != assistant) without counting malformed", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)"
    ).run(
      "msg_user",
      "session-1",
      now - 60_000,
      JSON.stringify({ id: "msg_user", role: "user", sessionID: "session-1" })
    );
    insertAssistant(db, { id: "msg_a", input: 10, output: 20 });
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.input.observations).toHaveLength(1);
    expect(result?.diagnostics.malformedRows).toBe(0);
    expect(result?.diagnostics.rowsRead).toBe(2);
  });

  it("counts truly malformed JSON in diagnostics.malformedRows", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    const now = Date.now();
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)"
    ).run("bad_msg", "session-1", now - 60_000, "{not-valid-json");
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.diagnostics.malformedRows).toBe(1);
    expect(result?.input.observations).toEqual([]);
    expect(result?.input.coverage.complete).toBe(false);
  });

  it("filters out rows older than the coverage window", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    // Insert row 100 days ago; SELECT WHERE time_created >= cutoff excludes it.
    insertAssistant(db, {
      id: "old_msg",
      input: 999,
      output: 999,
      timeMsAgo: 100 * 24 * 3600 * 1000,
    });
    insertAssistant(db, { id: "new_msg", input: 10, output: 20 });
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.input.observations).toHaveLength(1);
    expect(result?.input.observations[0]?.inputTokens).toBe(10);
  });

  it("deduplicates rows sharing the same message id", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    // Two rows same id — schema PRIMARY KEY would normally reject, drop the
    // primary key constraint by dropping/recreating for this test only.
    db.exec("DROP TABLE message");
    db.exec(
      "CREATE TABLE message (id TEXT, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL)"
    );
    insertAssistant(db, { id: "shared", input: 10, output: 20 });
    insertAssistant(db, { id: "shared", input: 10, output: 20 });
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const result = await scanner.scan();

    expect(result?.input.observations).toHaveLength(1);
  });

  it("coalesces overlapping scans into one in-flight task", async () => {
    const { dbPath } = await fixture();
    const db = initSchema(dbPath);
    insertAssistant(db, { input: 10, output: 20 });
    db.close();
    const scanner = createOpenCodeSqliteScanner({ dbPath });

    const first = scanner.scan();
    const second = scanner.scan();

    expect(await first).toBe(await second);
  });
});
