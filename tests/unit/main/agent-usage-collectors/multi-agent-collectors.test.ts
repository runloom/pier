import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClineUsageCollector } from "../../../../src/main/services/agents/usage-collectors/cline.ts";
import { createCopilotUsageCollector } from "../../../../src/main/services/agents/usage-collectors/copilot.ts";
import { createDroidUsageCollector } from "../../../../src/main/services/agents/usage-collectors/droid.ts";
import { createLogger } from "../../../../src/shared/logger.ts";

const tempDirs: string[] = [];
const logger = createLogger("test");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-usage-home-"));
  tempDirs.push(dir);
  return dir;
}

describe("multi-agent usage collectors", () => {
  it("reads Copilot session.shutdown modelMetrics", async () => {
    const home = await tempHome();
    const sessionDir = join(home, ".copilot", "session-state", "s1");
    await mkdir(sessionDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(sessionDir, "events.jsonl"),
      `${JSON.stringify({
        id: "ev-1",
        timestamp: `${date}T12:00:00.000Z`,
        type: "session.shutdown",
        data: {
          modelMetrics: {
            "gpt-5-mini": {
              usage: {
                cacheReadTokens: 10,
                inputTokens: 100,
                outputTokens: 20,
                reasoningTokens: 5,
              },
            },
          },
          sessionStartTime: Date.parse(`${date}T12:00:00.000Z`),
        },
      })}\n`,
      "utf8"
    );

    const collector = createCopilotUsageCollector({
      env: { HOME: home } as NodeJS.ProcessEnv,
      logger,
      userDataDir: join(home, "ud"),
    });
    const input = await collector.rescan();
    expect(input?.sourceId).toBe("copilot-local-sessions");
    expect(input?.observations).toEqual([
      {
        cachedInputTokens: 10,
        date,
        inputTokens: 100,
        modelId: "gpt-5-mini",
        outputTokens: 20,
        reasoningTokens: 5,
      },
    ]);
  });

  it("reads Cline session metadata.usage", async () => {
    const home = await tempHome();
    const sid = "1000_abc";
    const sessionDir = join(home, ".cline", "data", "sessions", sid);
    await mkdir(sessionDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(sessionDir, `${sid}.json`),
      JSON.stringify({
        model: "gpt-5.5",
        started_at: `${date}T01:00:00.000Z`,
        metadata: {
          usage: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            inputTokens: 50,
            outputTokens: 8,
          },
        },
      }),
      "utf8"
    );

    const collector = createClineUsageCollector({
      env: { HOME: home } as NodeJS.ProcessEnv,
      logger,
      userDataDir: join(home, "ud"),
    });
    const input = await collector.rescan();
    expect(input?.sourceId).toBe("cline-local-sessions");
    expect(input?.observations).toEqual([
      {
        cachedInputTokens: 0,
        date,
        inputTokens: 50,
        modelId: "gpt-5.5",
        outputTokens: 8,
        reasoningTokens: 0,
      },
    ]);
  });

  it("reads Droid factory session tokenUsage", async () => {
    const home = await tempHome();
    const sessionDir = join(home, ".factory", "sessions", "cwd-a");
    await mkdir(sessionDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(sessionDir, "sid.settings.json"),
      JSON.stringify({
        model: "claude-opus-4-8",
        providerLockTimestamp: `${date}T10:00:00.000Z`,
        inclusiveTokenUsage: {
          cacheCreationTokens: 0,
          cacheReadTokens: 20,
          inputTokens: 80,
          outputTokens: 12,
          thinkingTokens: 3,
        },
      }),
      "utf8"
    );

    const collector = createDroidUsageCollector({
      env: { HOME: home } as NodeJS.ProcessEnv,
      logger,
      userDataDir: join(home, "ud"),
    });
    const input = await collector.rescan();
    expect(input?.sourceId).toBe("droid-local-sessions");
    expect(input?.observations).toEqual([
      {
        cachedInputTokens: 20,
        date,
        inputTokens: 100,
        modelId: "claude-opus-4-8",
        outputTokens: 12,
        reasoningTokens: 3,
      },
    ]);
  });
});
