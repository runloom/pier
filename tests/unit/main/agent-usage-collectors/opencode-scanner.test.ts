import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeUsageScanner } from "../../../../src/main/services/agents/usage-collectors/opencode-scanner.ts";

/**
 * OpenCode scanner smoke tests。数据源是 v1.2.0 之前的 JSON storage 布局：
 *   `<messageRoot>/<sessionID>/<messageID>.json`
 * 每文件一个 message 对象；只有 role=assistant 的 message 才有 tokens。
 */

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(): Promise<{
  cachePath: string;
  messageRoot: string;
  sessionDir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-opencode-scan-"));
  tempDirs.push(dir);
  const messageRoot = join(dir, "storage", "session", "message");
  const sessionDir = join(messageRoot, "session-abc");
  await mkdir(sessionDir, { recursive: true });
  return { cachePath: join(dir, "cache.json"), messageRoot, sessionDir };
}

function assistantJson(opts: {
  cache?: { read: number; write: number };
  createdMsAgoMs?: number;
  input: number;
  messageId?: string;
  modelID?: string;
  output: number;
  reasoning?: number;
  sessionID?: string;
}): string {
  const now = Date.now();
  return JSON.stringify({
    cost: 0.001,
    id: opts.messageId ?? "msg_default",
    modelID: opts.modelID ?? "claude-sonnet-4-5",
    providerID: "anthropic",
    role: "assistant",
    sessionID: opts.sessionID ?? "session-abc",
    time: {
      completed: now,
      created: now - (opts.createdMsAgoMs ?? 60_000),
    },
    tokens: {
      cache: {
        read: opts.cache?.read ?? 0,
        write: opts.cache?.write ?? 0,
      },
      input: opts.input,
      output: opts.output,
      reasoning: opts.reasoning ?? 0,
    },
  });
}

describe("OpenCode usage scanner", () => {
  it("extracts a single assistant message and maps cache buckets", async () => {
    const { cachePath, messageRoot, sessionDir } = await fixture();
    await writeFile(
      join(sessionDir, "msg-1.json"),
      assistantJson({
        cache: { read: 50, write: 25 },
        input: 100,
        messageId: "msg_1",
        output: 200,
      }),
      "utf8"
    );
    const scanner = createOpenCodeUsageScanner({ cachePath, messageRoot });

    const result = await scanner.scan();

    expect(result.input.observations).toHaveLength(1);
    const [observation] = result.input.observations;
    expect(observation).toMatchObject({
      cachedInputTokens: 50,
      // 100 raw + 25 cache.write + 50 cache.read
      inputTokens: 175,
      modelId: "claude-sonnet-4-5",
      outputTokens: 200,
      reasoningTokens: 0,
    });
    expect(result.input.sourceId).toBe("opencode-local-sessions");
    expect(result.diagnostics.parsedFiles).toBe(1);
  });

  it("skips user messages (no tokens field)", async () => {
    const { cachePath, messageRoot, sessionDir } = await fixture();
    await writeFile(
      join(sessionDir, "user-msg.json"),
      JSON.stringify({
        id: "msg_user",
        role: "user",
        sessionID: "session-abc",
        time: { created: Date.now() },
      }),
      "utf8"
    );
    const scanner = createOpenCodeUsageScanner({ cachePath, messageRoot });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
    expect(result.diagnostics.parsedFiles).toBe(1);
  });

  it("drops assistant messages older than the coverage window", async () => {
    const { cachePath, messageRoot, sessionDir } = await fixture();
    await writeFile(
      join(sessionDir, "ancient.json"),
      JSON.stringify({
        id: "msg_ancient",
        modelID: "claude-sonnet-4-5",
        role: "assistant",
        sessionID: "session-abc",
        // 100 天前
        time: { created: Date.now() - 100 * 24 * 3600 * 1000 },
        tokens: {
          cache: { read: 0, write: 0 },
          input: 999,
          output: 999,
          reasoning: 0,
        },
      }),
      "utf8"
    );
    const scanner = createOpenCodeUsageScanner({ cachePath, messageRoot });

    const result = await scanner.scan();

    // mtime 是刚写入（最近），会进 candidate；parser 通过 time.created 过滤掉。
    expect(result.input.observations).toEqual([]);
  });

  it("reuses cached files on second scan when mtime + size unchanged", async () => {
    const { cachePath, messageRoot, sessionDir } = await fixture();
    await writeFile(
      join(sessionDir, "msg-a.json"),
      assistantJson({ input: 10, messageId: "msg_a", output: 20 }),
      "utf8"
    );
    const scanner = createOpenCodeUsageScanner({ cachePath, messageRoot });

    await scanner.scan();
    const second = await scanner.scan();

    expect(second.diagnostics.reusedFiles).toBe(1);
    expect(second.diagnostics.parsedFiles).toBe(0);
    expect(second.input.observations).toHaveLength(1);
  });

  it("returns empty when message root does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-scan-empty-"));
    tempDirs.push(dir);
    const scanner = createOpenCodeUsageScanner({
      cachePath: join(dir, "cache.json"),
      messageRoot: join(dir, "does-not-exist"),
    });

    const result = await scanner.scan();

    expect(result.input.observations).toEqual([]);
    expect(result.diagnostics.candidateFiles).toBe(0);
  });
});
