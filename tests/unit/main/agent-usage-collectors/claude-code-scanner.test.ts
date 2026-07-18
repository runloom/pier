import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeUsageScanner } from "../../../../src/main/services/agents/usage-collectors/claude-code-scanner.ts";
import {
  readLocalUsageCache,
  writeLocalUsageCache,
} from "../../../../src/main/services/agents/usage-collectors/file-cache.ts";

/**
 * Claude Code scanner smoke tests。覆盖：
 * - 基础 assistant message → observation 提取
 * - `cache_creation_input_tokens` 归入 `inputTokens`；`cache_read_input_tokens` 归入 `cachedInputTokens`
 * - stream-json 重复 chunk 用 `message.id` 去重
 * - date 窗口过滤（老 timestamp 不进 observation）
 * - 缓存复用：文件 mtime + size 未变时不重解析
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(): Promise<{
  cachePath: string;
  claudeProjectsRoot: string;
  projectDir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-claude-scan-"));
  tempDirs.push(dir);
  const claudeProjectsRoot = join(dir, "projects");
  const projectDir = join(claudeProjectsRoot, "-Users-me-project");
  await mkdir(projectDir, { recursive: true });
  return {
    cachePath: join(dir, "cache.json"),
    claudeProjectsRoot,
    projectDir,
  };
}

interface UsageFields {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens: number;
  output_tokens: number;
  service_tier?: string;
}

function assistantLine(opts: {
  messageId?: string;
  model?: string;
  sessionId?: string;
  timestamp: string;
  usage: UsageFields;
  uuid?: string;
}): string {
  return `${JSON.stringify({
    message: {
      id: opts.messageId ?? "msg_default",
      model: opts.model ?? "claude-sonnet-4-5",
      role: "assistant",
      type: "message",
      usage: opts.usage,
    },
    sessionId: opts.sessionId ?? "session-1",
    timestamp: opts.timestamp,
    type: "assistant",
    uuid: opts.uuid ?? "uuid-default",
  })}\n`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("Claude Code usage scanner", () => {
  it("extracts assistant usage and maps cache fields into input/cached buckets", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    const date = today();
    await writeFile(
      join(projectDir, "session-a.jsonl"),
      assistantLine({
        messageId: "msg_a",
        model: "claude-sonnet-4-5",
        sessionId: "session-a",
        timestamp: `${date}T10:00:00.000Z`,
        usage: {
          cache_creation_input_tokens: 25,
          cache_read_input_tokens: 50,
          input_tokens: 100,
          output_tokens: 200,
          service_tier: "standard",
        },
      }),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([
      {
        // 100 raw + 25 cache_creation + 50 cache_read
        cachedInputTokens: 50,
        date,
        inputTokens: 175,
        modelId: "claude-sonnet-4-5",
        outputTokens: 200,
        reasoningTokens: 0,
        serviceTier: "standard",
      },
    ]);
    expect(result.input.sourceId).toBe("claude-code-local-sessions");
    expect(result.diagnostics.parsedFiles).toBe(1);
    expect(result.diagnostics.uniqueEvents).toBe(1);
  });

  it("deduplicates repeated stream-json chunks via message.id within one session", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    const date = today();
    await writeFile(
      join(projectDir, "session-b.jsonl"),
      [
        assistantLine({
          messageId: "msg_shared",
          sessionId: "session-b",
          timestamp: `${date}T10:00:00.000Z`,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        assistantLine({
          messageId: "msg_shared",
          sessionId: "session-b",
          timestamp: `${date}T10:00:00.100Z`,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    const result = await scanner.scan();

    expect(result.input.observations).toHaveLength(1);
    expect(result.diagnostics.deduplicatedEvents).toBe(1);
  });

  it("drops assistant lines outside the coverage window", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    await writeFile(
      join(projectDir, "session-old.jsonl"),
      assistantLine({
        sessionId: "session-old",
        timestamp: "2000-01-01T00:00:00.000Z",
        usage: { input_tokens: 999, output_tokens: 999 },
      }),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
    expect(result.diagnostics.parsedFiles).toBe(1);
  });

  it("skips non-assistant lines (user, summary, system)", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    const date = today();
    await writeFile(
      join(projectDir, "session-c.jsonl"),
      [
        `${JSON.stringify({ leafUuid: "u1", summary: "Test", type: "summary" })}\n`,
        `${JSON.stringify({ message: { content: "hi", role: "user" }, sessionId: "session-c", timestamp: `${date}T09:59:00.000Z`, type: "user", uuid: "u1" })}\n`,
        assistantLine({
          messageId: "msg_c",
          sessionId: "session-c",
          timestamp: `${date}T10:00:00.000Z`,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    const result = await scanner.scan();

    expect(result.input.observations).toHaveLength(1);
    expect(result.input.observations[0]?.inputTokens).toBe(10);
  });

  it("reuses cached observations for unchanged files across scans", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    const date = today();
    await writeFile(
      join(projectDir, "session-d.jsonl"),
      assistantLine({
        messageId: "msg_d",
        sessionId: "session-d",
        timestamp: `${date}T10:00:00.000Z`,
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    await scanner.scan();
    const second = await scanner.scan();

    expect(second.diagnostics.reusedFiles).toBe(1);
    expect(second.diagnostics.parsedFiles).toBe(0);
    expect(second.input.observations).toHaveLength(1);
  });

  it("drops cached observations that fall outside the current coverage window", async () => {
    const { cachePath, claudeProjectsRoot, projectDir } = await fixture();
    const date = today();
    const sessionPath = join(projectDir, "session-stale-window.jsonl");
    await writeFile(
      sessionPath,
      assistantLine({
        messageId: "msg_current",
        sessionId: "session-stale-window",
        timestamp: `${date}T10:00:00.000Z`,
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      "utf8"
    );
    const scanner = createClaudeCodeUsageScanner({
      cachePath,
      claudeProjectsRoot,
    });

    await scanner.scan();

    const cache = await readLocalUsageCache(cachePath);
    const entry = cache.entries[sessionPath];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("expected cached session entry");
    }
    entry.observations.push({
      fingerprint: "stale-window",
      usage: {
        cachedInputTokens: 0,
        date: "2000-01-01",
        inputTokens: 999,
        modelId: "claude-sonnet-4-5",
        outputTokens: 999,
        reasoningTokens: 0,
        serviceTier: null,
      },
    });
    await writeLocalUsageCache(cachePath, cache.entries);

    const second = await scanner.scan();
    expect(second.diagnostics.reusedFiles).toBe(1);
    expect(second.diagnostics.uniqueEvents).toBe(1);
    expect(second.input.observations).toEqual([
      expect.objectContaining({
        date,
        inputTokens: 100,
        outputTokens: 200,
      }),
    ]);
    expect(second.input.coverage.from <= date).toBe(true);
    expect(second.input.coverage.to >= date).toBe(true);
    for (const observation of second.input.observations) {
      expect(observation.date >= second.input.coverage.from).toBe(true);
      expect(observation.date <= second.input.coverage.to).toBe(true);
    }
  });

  it("returns empty coverage cleanly when projects root is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-claude-scan-empty-"));
    tempDirs.push(dir);
    const scanner = createClaudeCodeUsageScanner({
      cachePath: join(dir, "cache.json"),
      claudeProjectsRoot: join(dir, "does-not-exist"),
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
    expect(result.diagnostics.candidateFiles).toBe(0);
  });
});
