import { describe, expect, it } from "vitest";
import { mapPool } from "../../../../src/shared/agent-lifecycle/map-pool.ts";

describe("mapPool", () => {
  it("preserves order and respects concurrency", async () => {
    let live = 0;
    let maxLive = 0;
    const items = [1, 2, 3, 4, 5];
    const out = await mapPool(items, 2, async (n) => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 20));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxLive).toBeLessThanOrEqual(2);
    expect(maxLive).toBeGreaterThan(1);
  });

  it("returns empty for empty input", async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([]);
  });
});
