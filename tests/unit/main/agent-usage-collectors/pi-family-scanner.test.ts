import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiFamilyUsageScanner } from "../../../../src/main/services/agents/usage-collectors/pi-family-scanner.ts";

/**
 * pi / omp 家族 scanner smoke tests。pi 与 omp 共享同一 parser+scanner，仅
 * sessions root 不同——本测试覆盖两家共通行为：
 * - 首行 header + 后续 message entries 解析
 * - `cacheWrite` 并入 inputTokens，`cacheRead` 归入 cachedInputTokens
 * - user / toolResult / thinking 等非 assistant 消息跳过
 * - 无 assistant 观测的会话返回空
 * - 缓存复用未变文件
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(): Promise<{
  cachePath: string;
  cwdDir: string;
  sessionsRoot: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-pi-family-scan-"));
  tempDirs.push(dir);
  const sessionsRoot = join(dir, "sessions");
  const cwdDir = join(sessionsRoot, "-work-project");
  await mkdir(cwdDir, { recursive: true });
  return {
    cachePath: join(dir, "cache.json"),
    cwdDir,
    sessionsRoot,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sessionHeader(opts: { cwd?: string; id?: string } = {}): string {
  return `${JSON.stringify({
    cwd: opts.cwd ?? "/work/project",
    id: opts.id ?? "session-default",
    timestamp: "2026-07-01T00:00:00.000Z",
    type: "session",
    version: 3,
  })}\n`;
}

function assistantEntry(opts: {
  entryId?: string;
  model?: string;
  parentId?: string | null;
  timestamp: string;
  usage: {
    cacheRead?: number;
    cacheWrite?: number;
    input: number;
    output: number;
  };
}): string {
  return `${JSON.stringify({
    id: opts.entryId ?? "entry-default",
    message: {
      model: opts.model ?? "claude-sonnet-4-5",
      provider: "anthropic",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1_720_868_460_000,
      usage: {
        cacheRead: opts.usage.cacheRead ?? 0,
        cacheWrite: opts.usage.cacheWrite ?? 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: opts.usage.input,
        output: opts.usage.output,
        totalTokens:
          opts.usage.input +
          opts.usage.output +
          (opts.usage.cacheRead ?? 0) +
          (opts.usage.cacheWrite ?? 0),
      },
    },
    parentId: opts.parentId ?? null,
    timestamp: opts.timestamp,
    type: "message",
  })}\n`;
}

function userEntry(opts: { timestamp: string }): string {
  return `${JSON.stringify({
    id: "user-entry",
    message: { content: "hi", role: "user", timestamp: 1_720_868_400_000 },
    parentId: null,
    timestamp: opts.timestamp,
    type: "message",
  })}\n`;
}

describe("pi/omp family usage scanner", () => {
  it("extracts assistant usage and maps cacheRead/cacheWrite into buckets", async () => {
    const { cachePath, cwdDir, sessionsRoot } = await fixture();
    const date = today();
    await writeFile(
      join(cwdDir, `1720868460000_${crypto.randomUUID()}.jsonl`),
      [
        sessionHeader({ id: "session-a" }),
        userEntry({ timestamp: `${date}T09:59:00.000Z` }),
        assistantEntry({
          entryId: "assist-1",
          timestamp: `${date}T10:01:00.000Z`,
          usage: { cacheRead: 50, cacheWrite: 25, input: 100, output: 200 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createPiFamilyUsageScanner({
      cachePath,
      sessionsRoot,
      sourceId: "test-source",
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([
      {
        // 100 raw + 25 cache_write + 50 cache_read
        cachedInputTokens: 50,
        date,
        inputTokens: 175,
        modelId: "claude-sonnet-4-5",
        outputTokens: 200,
        reasoningTokens: 0,
      },
    ]);
    expect(result.input.sourceId).toBe("test-source");
    expect(result.diagnostics.parsedFiles).toBe(1);
  });

  it("skips non-assistant messages (user, toolResult, unknown types)", async () => {
    const { cachePath, cwdDir, sessionsRoot } = await fixture();
    const date = today();
    await writeFile(
      join(cwdDir, "session-b.jsonl"),
      [
        sessionHeader({ id: "session-b" }),
        userEntry({ timestamp: `${date}T09:59:00.000Z` }),
        // toolResult message → 无 usage，跳过
        `${JSON.stringify({ id: "tr", message: { content: [], isError: false, role: "toolResult", timestamp: 1, toolCallId: "x", toolName: "bash" }, parentId: null, timestamp: `${date}T10:00:00.000Z`, type: "message" })}\n`,
        // 未识别 type 也跳过
        `${JSON.stringify({ id: "tc", parentId: null, timestamp: `${date}T10:00:30.000Z`, type: "thinking_level_change", thinkingLevel: "high" })}\n`,
        assistantEntry({
          entryId: "assist-b",
          timestamp: `${date}T10:01:00.000Z`,
          usage: { input: 10, output: 20 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createPiFamilyUsageScanner({
      cachePath,
      sessionsRoot,
      sourceId: "test-source",
    });

    const result = await scanner.scan();

    expect(result.input.observations).toHaveLength(1);
    expect(result.input.observations[0]?.inputTokens).toBe(10);
  });

  it("drops assistant entries outside the coverage window", async () => {
    const { cachePath, cwdDir, sessionsRoot } = await fixture();
    await writeFile(
      join(cwdDir, "session-old.jsonl"),
      [
        sessionHeader({ id: "session-old" }),
        assistantEntry({
          entryId: "old-assist",
          timestamp: "2000-01-01T00:00:00.000Z",
          usage: { input: 999, output: 999 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createPiFamilyUsageScanner({
      cachePath,
      sessionsRoot,
      sourceId: "test-source",
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
  });

  it("reuses cached file on second scan when mtime and size are unchanged", async () => {
    const { cachePath, cwdDir, sessionsRoot } = await fixture();
    const date = today();
    await writeFile(
      join(cwdDir, "session-c.jsonl"),
      [
        sessionHeader({ id: "session-c" }),
        assistantEntry({
          entryId: "assist-c",
          timestamp: `${date}T10:00:00.000Z`,
          usage: { input: 100, output: 200 },
        }),
      ].join(""),
      "utf8"
    );
    const scanner = createPiFamilyUsageScanner({
      cachePath,
      sessionsRoot,
      sourceId: "test-source",
    });

    await scanner.scan();
    const second = await scanner.scan();

    expect(second.diagnostics.reusedFiles).toBe(1);
    expect(second.diagnostics.parsedFiles).toBe(0);
    expect(second.input.observations).toHaveLength(1);
  });

  it("returns empty coverage when sessions root does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-pi-family-scan-empty-"));
    tempDirs.push(dir);
    const scanner = createPiFamilyUsageScanner({
      cachePath: join(dir, "cache.json"),
      sessionsRoot: join(dir, "does-not-exist"),
      sourceId: "test-source",
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
    expect(result.diagnostics.candidateFiles).toBe(0);
  });
});
