import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalUsageScanner,
  selectRecentCandidatePaths,
} from "../../../packages/plugin-codex/src/main/local-usage-scanner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function tokenEvent(
  date: string,
  lastInput: number,
  cumulativeInput: number
): Record<string, unknown> {
  return {
    payload: {
      info: {
        last_token_usage: {
          cached_input_tokens: 20,
          input_tokens: lastInput,
          output_tokens: 25,
          reasoning_output_tokens: 5,
        },
        total_token_usage: {
          cached_input_tokens: 20,
          input_tokens: cumulativeInput,
          output_tokens: 25,
          reasoning_output_tokens: 5,
          total_tokens: cumulativeInput + 25,
        },
      },
      type: "token_count",
    },
    timestamp: `${date}T01:02:00Z`,
    type: "event_msg",
  };
}

async function writeSession(
  codexHome: string,
  name: string,
  events: Record<string, unknown>[]
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const sessionsDir = join(codexHome, "sessions", ...date.split("-"));
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, `${name}.jsonl`),
    events.map((line) => JSON.stringify(line)).join("\n"),
    "utf8"
  );
}

async function fixture(): Promise<{
  cachePath: string;
  codexHome: string;
  date: string;
}> {
  const codexHome = await mkdtemp(join(tmpdir(), "pier-codex-home-"));
  tempDirs.push(codexHome);
  return {
    cachePath: join(codexHome, "cache", "usage.json"),
    codexHome,
    date: new Date().toISOString().slice(0, 10),
  };
}

describe("local Codex usage scanner", () => {
  it("keeps the newest session files when the scan is capped", () => {
    expect(
      selectRecentCandidatePaths(
        [
          { date: "2026-07-10", path: "/sessions/old.jsonl" },
          { date: "2026-07-12", path: "/sessions/new.jsonl" },
          { date: "2026-07-11", path: "/sessions/middle.jsonl" },
        ],
        2
      )
    ).toEqual(["/sessions/new.jsonl", "/sessions/middle.jsonl"]);
  });

  it("publishes machine-scoped model token observations from session JSONL", async () => {
    const { cachePath, codexHome, date } = await fixture();
    await writeSession(codexHome, "session", [
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
      tokenEvent(date, 100, 100),
    ]);
    const scanner = createLocalUsageScanner({ cachePath, codexHome });

    const result = await scanner.scan();

    expect(result.input.scope).toEqual({ kind: "machine" });
    expect(result.input.sourceId).toBe("codex-local-sessions");
    expect(result.input.observations).toEqual([
      {
        cachedInputTokens: 20,
        date,
        inputTokens: 100,
        modelId: "gpt-5.4",
        outputTokens: 25,
        reasoningTokens: 5,
      },
    ]);
    expect(result.diagnostics).toMatchObject({
      parsedFiles: 1,
      reusedFiles: 0,
    });
  });

  it("reuses unchanged files from the persistent aggregate cache", async () => {
    const { cachePath, codexHome, date } = await fixture();
    await writeSession(codexHome, "session", [
      {
        payload: { id: "session-1" },
        timestamp: `${date}T01:00:00Z`,
        type: "session_meta",
      },
      tokenEvent(date, 100, 100),
    ]);
    const scanner = createLocalUsageScanner({ cachePath, codexHome });
    await scanner.scan();

    const warm = await scanner.scan();

    expect(warm.diagnostics).toMatchObject({ parsedFiles: 0, reusedFiles: 1 });
  });

  it("backfills token events that precede a file's only model context", async () => {
    const { cachePath, codexHome, date } = await fixture();
    await writeSession(codexHome, "session", [
      {
        payload: { id: "session-1" },
        timestamp: `${date}T01:00:00Z`,
        type: "session_meta",
      },
      tokenEvent(date, 100, 100),
      {
        payload: { model: "gpt-5.6-sol", service_tier: "priority" },
        timestamp: `${date}T01:03:00Z`,
        type: "turn_context",
      },
    ]);

    const result = await createLocalUsageScanner({
      cachePath,
      codexHome,
    }).scan();

    expect(result.input.observations[0]).toMatchObject({
      modelId: "gpt-5.6-sol",
      serviceTier: "priority",
    });
  });

  it("deduplicates fork history written before the child model context", async () => {
    const { cachePath, codexHome, date } = await fixture();
    const copiedEvent = tokenEvent(date, 100, 100);
    const modelContext = {
      payload: { model: "gpt-5.6-sol" },
      timestamp: `${date}T01:01:00Z`,
      type: "turn_context",
    };
    await writeSession(codexHome, "parent", [
      {
        payload: { id: "parent" },
        timestamp: `${date}T01:00:00Z`,
        type: "session_meta",
      },
      modelContext,
      copiedEvent,
    ]);
    await writeSession(codexHome, "fork", [
      {
        payload: { forked_from_id: "parent", id: "fork" },
        timestamp: `${date}T02:00:00Z`,
        type: "session_meta",
      },
      copiedEvent,
      modelContext,
    ]);

    const result = await createLocalUsageScanner({
      cachePath,
      codexHome,
    }).scan();

    expect(result.input.observations).toHaveLength(1);
    expect(result.diagnostics.deduplicatedEvents).toBe(1);
  });

  it("deduplicates copied fork history while retaining new branch usage", async () => {
    const { cachePath, codexHome, date } = await fixture();
    const parentEvent = tokenEvent(date, 100, 100);
    await writeSession(codexHome, "parent", [
      {
        payload: { id: "parent" },
        timestamp: `${date}T01:00:00Z`,
        type: "session_meta",
      },
      parentEvent,
    ]);
    await writeSession(codexHome, "fork", [
      {
        payload: { forked_from_id: "parent", id: "fork" },
        timestamp: `${date}T02:00:00Z`,
        type: "session_meta",
      },
      parentEvent,
      tokenEvent(date, 50, 150),
    ]);
    const scanner = createLocalUsageScanner({ cachePath, codexHome });

    const result = await scanner.scan();

    expect(result.input.observations).toHaveLength(2);
    expect(
      result.input.observations.reduce(
        (sum, observation) => sum + observation.inputTokens,
        0
      )
    ).toBe(150);
    expect(
      result.input.observations.reduce(
        (sum, observation) => sum + observation.outputTokens,
        0
      )
    ).toBe(50);
    expect(result.diagnostics).toMatchObject({
      deduplicatedEvents: 1,
      forkedFiles: 1,
      uniqueEvents: 2,
    });
    expect(result.input.coverage.complete).toBe(true);
  });

  it("coalesces overlapping scans into one in-flight task", async () => {
    const { cachePath, codexHome } = await fixture();
    const scanner = createLocalUsageScanner({ cachePath, codexHome });

    const first = scanner.scan();
    const second = scanner.scan();

    expect(second).toBe(first);
    await first;
  });

  it("reports malformed log lines as incomplete coverage", async () => {
    const { cachePath, codexHome, date } = await fixture();
    const sessionsDir = join(codexHome, "sessions", ...date.split("-"));
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "broken.jsonl"), "{not-json", "utf8");
    const scanner = createLocalUsageScanner({ cachePath, codexHome });

    const result = await scanner.scan();

    expect(result.diagnostics.malformedLines).toBe(1);
    expect(result.input.coverage.complete).toBe(false);
  });
});
