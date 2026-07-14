import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUsageDataService,
  type UsageDataService,
} from "@main/services/usage-data/usage-data-service.ts";
import type { UsageDataPublishInput } from "@pier/plugin-api/main";
import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-usage-broadcast-"));
  tempDirs.push(dir);
  return dir;
}

async function readyService(): Promise<UsageDataService> {
  const service = createUsageDataService({ userDataDir: await tempDir() });
  await service.init();
  return service;
}

function publishInput(
  overrides: Partial<UsageDataPublishInput> = {}
): UsageDataPublishInput {
  return {
    coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
    observations: [],
    observedAt: 1,
    scope: { kind: "machine" },
    sourceId: "local-sessions",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("usage data broadcast", () => {
  it("delivers a fresh aggregate to subscribers after every publish", async () => {
    const service = await readyService();
    const received: UsageAggregateSnapshot[] = [];
    service.subscribe((snapshot) => received.push(snapshot));

    service.publish(
      "pier.codex",
      publishInput({
        coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
        observations: [
          {
            cachedInputTokens: 0,
            date: "2026-07-11",
            inputTokens: 1000,
            modelId: "gpt-5-codex",
            outputTokens: 100,
          },
        ],
      })
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.sources).toHaveLength(1);
    expect(received[0]!.overall.summary.sourceCount).toBe(1);
    expect(received[0]!.overall.buckets).toHaveLength(1);

    service.publish(
      "pier.claude",
      publishInput({
        observations: [
          {
            cachedInputTokens: 0,
            date: "2026-07-11",
            inputTokens: 500,
            modelId: "claude-sonnet-4-5",
            outputTokens: 50,
          },
        ],
        observedAt: 2,
      })
    );

    expect(received).toHaveLength(2);
    expect(received[1]!.sources).toHaveLength(2);
    expect(received[1]!.overall.summary.sourceCount).toBe(2);
  });

  it("stops delivering to a subscriber after unsubscribe", async () => {
    const service = await readyService();
    const received: UsageAggregateSnapshot[] = [];
    const unsubscribe = service.subscribe((snapshot) =>
      received.push(snapshot)
    );

    service.publish("pier.codex", publishInput());
    expect(received).toHaveLength(1);

    unsubscribe();

    service.publish("pier.codex", publishInput({ observedAt: 2 }));
    expect(received).toHaveLength(1);
  });

  it("plugin facade registerSource prefixes plugin id and fires on refreshAll", async () => {
    const service = await readyService();
    const codex = service.createPluginFacade("pier.codex", true);
    let rescanCalls = 0;
    codex.registerSource({
      id: "local-sessions",
      rescan: () => {
        rescanCalls += 1;
        return Promise.resolve();
      },
    });
    await service.refreshAll();
    expect(rescanCalls).toBe(1);
  });

  it("propagates rescan errors from refreshAll but still broadcasts", async () => {
    const service = await readyService();
    const codex = service.createPluginFacade("pier.codex", true);
    codex.registerSource({
      id: "local-sessions",
      rescan: () => Promise.reject(new Error("scan boom")),
    });
    const received: number[] = [];
    service.subscribe((snapshot) =>
      received.push(snapshot.overall.summary.sourceCount)
    );
    await expect(service.refreshAll()).rejects.toThrow("scan boom");
    expect(received).toHaveLength(1);
  });

  it("refreshAll republishes the current aggregate without touching state", async () => {
    const service = await readyService();

    service.publish(
      "pier.codex",
      publishInput({
        observations: [
          {
            cachedInputTokens: 0,
            date: "2026-07-11",
            inputTokens: 100,
            modelId: "gpt-5-codex",
            outputTokens: 10,
          },
        ],
      })
    );

    const received: UsageAggregateSnapshot[] = [];
    service.subscribe((snapshot) => received.push(snapshot));

    await service.refreshAll();
    await service.refreshAll();

    expect(received).toHaveLength(2);
    expect(
      received[0]!.sources[0]!.snapshot.buckets[0]!.tokens.totalTokens
    ).toBe(110);
    expect(received[1]).toEqual(received[0]);
  });

  it("isolates listener errors from other subscribers", async () => {
    const service = await readyService();
    let goodCalls = 0;
    service.subscribe(() => {
      throw new Error("boom");
    });
    service.subscribe(() => {
      goodCalls += 1;
    });

    service.publish("pier.codex", publishInput());
    expect(goodCalls).toBe(1);
  });
});
