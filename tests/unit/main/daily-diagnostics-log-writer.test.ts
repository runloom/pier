import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogRecord } from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDailyDiagnosticsLogWriter,
  sanitizeLogRecordForDisk,
} from "../../../src/main/diagnostics/daily-diagnostics-log-writer.ts";

const ROTATED_LOG_RE = /^app-2026-07-06\.\d+\.jsonl$/;

describe("daily diagnostics log writer", () => {
  let root: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:20:30.000Z"));
    root = await mkdtemp(join(tmpdir(), "pier-diagnostics-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { force: true, recursive: true });
  });

  it("writes sanitized records to app-YYYY-MM-DD.jsonl", async () => {
    const writer = createDailyDiagnosticsLogWriter({ diagnosticsDir: root });

    await writer.append({
      level: "warn",
      scope: "terminal.boot",
      msg: "boot pending with Bearer abcdef123456",
      ts: 123,
      ctx: {
        panelId: "panel-1",
        apiKey: "sk-secret",
        error: new Error("failed with ghp_abcdefghijklmnopqrstuvwxyz"),
      },
    });

    const raw = await readFile(join(root, "app-2026-07-06.jsonl"), "utf8");
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(parsed.v).toBe(1);
    expect(parsed.createdAt).toBe("2026-07-06T10:20:30.000Z");
    expect(parsed.process).toBe("main");
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.scope).toBe("terminal.boot");
    expect(parsed.msg).toBe("boot pending with Bearer [redacted]");
    expect(parsed.ctx).toMatchObject({
      panelId: "panel-1",
      apiKey: "[redacted]",
      error: {
        name: "Error",
        message: "failed with gh[token-redacted]",
      },
    });
  });

  it("rolls over by day and prunes expired app logs only", async () => {
    await writeFile(join(root, "app-2026-06-20.jsonl"), "old\n", "utf8");
    await writeFile(join(root, "app-2026-06-23.jsonl"), "fresh\n", "utf8");
    await writeFile(join(root, "agent-events.jsonl"), "keep\n", "utf8");
    const writer = createDailyDiagnosticsLogWriter({ diagnosticsDir: root });

    await writer.pruneExpiredLogs();
    await writer.append({ level: "info", msg: "today", ts: 1 });
    vi.setSystemTime(new Date("2026-07-07T00:00:01.000Z"));
    await writer.append({ level: "info", msg: "tomorrow", ts: 2 });

    const files = await readdir(root);
    expect(files).not.toContain("app-2026-06-20.jsonl");
    expect(files).toContain("app-2026-06-23.jsonl");
    expect(files).toContain("app-2026-07-06.jsonl");
    expect(files).toContain("app-2026-07-07.jsonl");
    expect(files).toContain("agent-events.jsonl");
  });

  it("serializes circular, long, and oversized values without throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const record: LogRecord = {
      level: "error",
      scope: "test",
      msg: "x".repeat(2100),
      ts: 1,
      ctx: {
        circular,
        token: "secret",
        items: Array.from({ length: 120 }, (_, index) => index),
        manyKeys: Object.fromEntries(
          Array.from({ length: 120 }, (_, index) => [`key-${index}`, index])
        ),
      },
    };

    const sanitized = sanitizeLogRecordForDisk(record);
    expect(sanitized.msg).toHaveLength(2000);
    expect(sanitized.ctx).toMatchObject({
      circular: { self: "[circular]" },
      token: "[redacted]",
    });
    const ctx = sanitized.ctx as {
      items: unknown[];
      manyKeys: Record<string, unknown>;
    };
    expect(ctx.items).toHaveLength(101);
    expect(ctx.items.at(-1)).toBe("[truncated 20 items]");
    expect(ctx.manyKeys.__truncatedKeys).toBe(20);

    const writer = createDailyDiagnosticsLogWriter({ diagnosticsDir: root });
    await writer.append({
      level: "info",
      scope: "large",
      msg: "large ctx",
      ts: 1,
      ctx: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `chunk-${index}`,
          "z".repeat(2000),
        ])
      ),
    });

    const raw = await readFile(join(root, "app-2026-07-06.jsonl"), "utf8");
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(64 * 1024);
    expect(parsed.ctx).toMatchObject({
      diagnosticsTruncated: true,
      originalScope: "large",
      originalMsg: "large ctx",
    });
  });

  it("redacts only exact sensitive keys while preserving Pier diagnostic ids", () => {
    const sanitized = sanitizeLogRecordForDisk({
      level: "info",
      msg: "ctx",
      ts: 1,
      ctx: {
        apiKey: "sk-secret",
        accessToken: "access-secret",
        session: "session-secret",
        cookie: "cookie-secret",
        sessionId: "session-1",
        terminalSessionId: "terminal-session-1",
        cancellationToken: "cancel-1",
        authorized: true,
      },
    });

    expect(sanitized.ctx).toMatchObject({
      apiKey: "[redacted]",
      accessToken: "[redacted]",
      session: "[redacted]",
      cookie: "[redacted]",
      sessionId: "session-1",
      terminalSessionId: "terminal-session-1",
      cancellationToken: "cancel-1",
      authorized: true,
    });
  });

  it("preserves sanitized Error cause chains", () => {
    const error = new Error("outer");
    error.cause = new Error("root with Bearer abcdef123456");
    const sanitized = sanitizeLogRecordForDisk({
      level: "error",
      msg: "failed",
      ts: 1,
      ctx: { error },
    });

    expect(sanitized.ctx).toMatchObject({
      error: {
        name: "Error",
        message: "outer",
        cause: {
          name: "Error",
          message: "root with Bearer [redacted]",
        },
      },
    });
  });

  it("reports append failures through a non-recursive callback", async () => {
    const onWriteError = vi.fn();
    const notDirectory = join(root, "not-directory");
    await writeFile(notDirectory, "file", "utf8");
    const writer = createDailyDiagnosticsLogWriter({
      diagnosticsDir: join(notDirectory, "child"),
      onWriteError,
    });

    await writer.append({ level: "info", msg: "cannot write", ts: 1 });

    expect(onWriteError).toHaveBeenCalledTimes(1);
  });

  it("rotates active files and prunes oldest rotated files by numeric order", async () => {
    const writer = createDailyDiagnosticsLogWriter({
      diagnosticsDir: root,
      maxBytesPerFile: 512,
    });
    for (let index = 0; index < 20; index++) {
      await writer.append({
        level: "info",
        scope: "rotate.test",
        msg: `pad ${index.toString().padStart(3, "0")} ${"x".repeat(80)}`,
        ts: index,
      });
    }

    let files = (await readdir(root)).sort();
    expect(files).toContain("app-2026-07-06.jsonl");
    const rotated = files.filter((file) => ROTATED_LOG_RE.test(file));
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.length).toBeLessThan(15);
    const firstRotated = rotated[0];
    if (!firstRotated) {
      throw new Error("missing rotated diagnostics file");
    }
    const firstRotatedContent = await readFile(
      join(root, firstRotated),
      "utf8"
    );
    expect(
      firstRotatedContent.split("\n").filter(Boolean).length
    ).toBeGreaterThan(1);

    await writeFile(
      join(root, "app-2026-07-06.10.jsonl"),
      "x".repeat(1000),
      "utf8"
    );
    await writeFile(
      join(root, "app-2026-07-06.2.jsonl"),
      "x".repeat(1000),
      "utf8"
    );
    await writeFile(
      join(root, "app-2026-07-06.1.jsonl"),
      "x".repeat(1000),
      "utf8"
    );
    const pruningWriter = createDailyDiagnosticsLogWriter({
      diagnosticsDir: root,
      retentionDays: 365,
      maxDirBytes: 2000,
    });
    await pruningWriter.pruneExpiredLogs();

    files = await readdir(root);
    expect(files).not.toContain("app-2026-07-06.1.jsonl");
    expect(files).not.toContain("app-2026-07-06.2.jsonl");
    expect(files).toContain("app-2026-07-06.10.jsonl");
    expect(files).toContain("app-2026-07-06.jsonl");
  });
});
