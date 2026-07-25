import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKimiUsageScanner,
  parseKimiDefaultModel,
} from "../../../../src/main/services/agents/usage-collectors/kimi-scanner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("parseKimiDefaultModel", () => {
  it("strips provider prefix from default_model", () => {
    expect(parseKimiDefaultModel('default_model = "kimi-code/k3"\n')).toBe(
      "k3"
    );
    expect(parseKimiDefaultModel('default_model = "kimi-for-coding"\n')).toBe(
      "kimi-for-coding"
    );
  });
});

describe("local Kimi usage scanner", () => {
  it("publishes StatusUpdate token_usage from wire.jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-kimi-home-"));
    tempDirs.push(root);
    const sessionsRoot = join(root, "sessions");
    const sessionDir = join(sessionsRoot, "group-a", "session-k1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(root, "config.toml"),
      'default_model = "kimi-code/k3"\n',
      "utf8"
    );
    const date = new Date().toISOString().slice(0, 10);
    const epoch = Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
    await writeFile(
      join(sessionDir, "wire.jsonl"),
      [
        { type: "metadata", protocol_version: "1.10" },
        {
          timestamp: epoch,
          message: {
            type: "StatusUpdate",
            payload: {
              message_id: "msg-1",
              token_usage: {
                input_cache_creation: 0,
                input_cache_read: 200,
                input_other: 300,
                output: 50,
              },
            },
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8"
    );

    const scanner = createKimiUsageScanner({
      cachePath: join(root, "cache.json"),
      configPaths: [join(root, "config.toml")],
      sessionsRoots: [sessionsRoot],
    });
    const result = await scanner.scan();

    expect(result.input.sourceId).toBe("kimi-local-sessions");
    expect(result.input.observations).toEqual([
      {
        cachedInputTokens: 200,
        date,
        inputTokens: 500,
        modelId: "k3",
        outputTokens: 50,
        reasoningTokens: 0,
      },
    ]);
  });
});
