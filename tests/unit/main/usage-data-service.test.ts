import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageDataService } from "@main/services/usage-data/usage-data-service.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-usage-data-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("usage data service", () => {
  it("prices, aggregates and persists normalized token observations", async () => {
    const userDataDir = await tempDir();
    const service = createUsageDataService({ userDataDir });
    await service.init();

    const snapshot = service.publish("pier.codex", {
      coverage: { complete: true, from: "2026-07-10", to: "2026-07-11" },
      observations: [
        {
          cachedInputTokens: 200,
          date: "2026-07-11",
          inputTokens: 1000,
          modelId: "gpt-5-codex",
          outputTokens: 100,
        },
      ],
      observedAt: 1,
      scope: { kind: "machine" },
      sourceId: "local-sessions",
    });

    expect(snapshot.buckets[0]).toMatchObject({
      estimatedCostMicrousd: 2025,
      pricingStatus: "complete",
      tokens: { totalTokens: 1100 },
    });
    expect(snapshot.summary).toMatchObject({
      estimatedCostMicrousd: 2025,
      periodTokens: 1100,
    });
    await service.flush();

    const reloaded = createUsageDataService({ userDataDir });
    await reloaded.init();
    expect(
      reloaded.read("pier.codex", "local-sessions", { kind: "machine" })
    ).toEqual(snapshot);
  });

  it("keeps unknown models as unpriced tokens", async () => {
    const service = createUsageDataService({ userDataDir: await tempDir() });
    await service.init();
    const snapshot = service.publish("pier.codex", {
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observations: [
        {
          cachedInputTokens: 0,
          date: "2026-07-11",
          inputTokens: 12,
          modelId: "future-model",
          outputTokens: 3,
          totalTokens: 20,
        },
      ],
      observedAt: 1,
      scope: { kind: "machine" },
      sourceId: "local-sessions",
    });

    expect(snapshot.buckets[0]).toMatchObject({
      estimatedCostMicrousd: null,
      pricingStatus: "unpriced",
      tokens: { totalTokens: 20 },
    });
  });

  it("prices GPT-5.6 model variants using the official standard rates", async () => {
    const service = createUsageDataService({ userDataDir: await tempDir() });
    await service.init();
    const snapshot = service.publish("pier.codex", {
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observations: [
        {
          cachedInputTokens: 200,
          date: "2026-07-11",
          inputTokens: 1000,
          modelId: "gpt-5.6-sol",
          outputTokens: 100,
        },
        {
          cachedInputTokens: 100,
          date: "2026-07-11",
          inputTokens: 500,
          modelId: "gpt-5.6-terra",
          outputTokens: 50,
        },
      ],
      observedAt: 1,
      scope: { kind: "machine" },
      sourceId: "local-sessions",
    });

    expect(snapshot.summary.estimatedCostMicrousd).toBe(8875);
    expect(snapshot.buckets[0]?.pricingStatus).toBe("complete");
  });

  it("applies long-context pricing per request rather than per daily total", async () => {
    const service = createUsageDataService({ userDataDir: await tempDir() });
    await service.init();

    const snapshot = service.publish("pier.codex", {
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observations: [
        {
          cachedInputTokens: 0,
          date: "2026-07-11",
          inputTokens: 200_000,
          modelId: "gpt-5.4",
          outputTokens: 0,
        },
        {
          cachedInputTokens: 0,
          date: "2026-07-11",
          inputTokens: 200_000,
          modelId: "gpt-5.4",
          outputTokens: 0,
        },
      ],
      observedAt: 1,
      scope: { kind: "machine" },
      sourceId: "local-sessions",
    });

    expect(snapshot.summary.estimatedCostMicrousd).toBe(1_000_000);
  });

  it("permission-gates publication while allowing own-data reads", async () => {
    const service = createUsageDataService({ userDataDir: await tempDir() });
    await service.init();
    const facade = service.createPluginFacade("pier.codex", false);

    await expect(
      facade.publish({
        coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
        observations: [],
        observedAt: 1,
        scope: { kind: "machine" },
        sourceId: "local-sessions",
      })
    ).rejects.toThrow("usage:publish");
    await expect(
      facade.read("local-sessions", { kind: "machine" })
    ).resolves.toBeNull();
  });
});
