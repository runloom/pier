import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollSystemStatsOnce,
  useSystemStatsStore,
} from "@/stores/system-stats.store.ts";

describe("system-stats store errors", () => {
  beforeEach(() => {
    useSystemStatsStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
  });

  it("records error when snapshot fails and clears on success", async () => {
    const snapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        appMemoryRss: 1,
        cpuCount: 8,
        cpuUsage: 0.1,
        loadAvg1: 1,
        loadAvg5: 1,
        loadAvg15: 1,
        memoryFree: 1,
        memoryTotal: 2,
        sampledAt: 1,
      });
    (
      window as unknown as {
        pier: { systemStats: { snapshot: typeof snapshot } };
      }
    ).pier = { systemStats: { snapshot } };

    await pollSystemStatsOnce();
    expect(useSystemStatsStore.getState().error).toMatch(/boom/);
    expect(useSystemStatsStore.getState().snapshot).toBeNull();

    await pollSystemStatsOnce();
    expect(useSystemStatsStore.getState().error).toBeNull();
    expect(useSystemStatsStore.getState().snapshot).not.toBeNull();
  });
});
