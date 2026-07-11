import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanLocalCodexUsage } from "../../../packages/plugin-codex/src/main/local-usage-scanner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("local Codex usage scanner", () => {
  it("publishes machine-scoped model token observations from session JSONL", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "pier-codex-home-"));
    tempDirs.push(codexHome);
    const date = new Date().toISOString().slice(0, 10);
    const sessionsDir = join(codexHome, "sessions", ...date.split("-"));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, "session.jsonl"),
      [
        {
          payload: { id: "session-1" },
          timestamp: `${date}T01:00:00Z`,
          type: "session_meta",
        },
        {
          payload: { model: "gpt-5.4" },
          timestamp: `${date}T01:01:00Z`,
          type: "turn_context",
        },
        {
          payload: {
            info: {
              last_token_usage: {
                cached_input_tokens: 20,
                input_tokens: 100,
                output_tokens: 25,
                reasoning_output_tokens: 5,
              },
            },
            type: "token_count",
          },
          timestamp: `${date}T01:02:00Z`,
          type: "event_msg",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8"
    );

    const result = await scanLocalCodexUsage(codexHome);

    expect(result.scope).toEqual({ kind: "machine" });
    expect(result.sourceId).toBe("codex-local-sessions");
    expect(result.observations).toEqual([
      {
        cachedInputTokens: 20,
        date,
        inputTokens: 100,
        modelId: "gpt-5.4",
        outputTokens: 25,
        reasoningTokens: 5,
      },
    ]);
  });
});
