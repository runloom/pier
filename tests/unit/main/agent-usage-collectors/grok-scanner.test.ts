import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGrokUsageScanner } from "../../../../src/main/services/agents/usage-collectors/grok-scanner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function fixture(): Promise<{
  cachePath: string;
  date: string;
  sessionsRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "pier-grok-home-"));
  tempDirs.push(root);
  return {
    cachePath: join(root, "cache", "usage.json"),
    date: new Date().toISOString().slice(0, 10),
    sessionsRoot: join(root, "sessions"),
  };
}

describe("local Grok usage scanner", () => {
  it("publishes turn_completed usage from updates.jsonl", async () => {
    const { cachePath, date, sessionsRoot } = await fixture();
    const sessionDir = join(sessionsRoot, "cwd-a", "session-1");
    await mkdir(sessionDir, { recursive: true });
    const epoch = Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
    await writeFile(
      join(sessionDir, "updates.jsonl"),
      [
        {
          method: "_x.ai/session/update",
          params: {
            sessionId: "session-1",
            update: {
              prompt_id: "prompt-1",
              sessionUpdate: "turn_completed",
              usage: {
                cachedReadTokens: 100,
                inputTokens: 500,
                modelUsage: {
                  "grok-4.5-build": {
                    inputTokens: 500,
                    outputTokens: 40,
                  },
                },
                outputTokens: 40,
                reasoningTokens: 10,
              },
            },
            _meta: { agentTimestampMs: epoch * 1000, eventId: "ev-1" },
          },
          timestamp: epoch,
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8"
    );

    const scanner = createGrokUsageScanner({ cachePath, sessionsRoot });
    const result = await scanner.scan();

    expect(result.input.sourceId).toBe("grok-local-sessions");
    expect(result.input.scope).toEqual({ kind: "machine" });
    expect(result.input.observations).toEqual([
      {
        cachedInputTokens: 100,
        date,
        inputTokens: 500,
        modelId: "grok-4.5-build",
        outputTokens: 40,
        reasoningTokens: 10,
      },
    ]);
  });
});
