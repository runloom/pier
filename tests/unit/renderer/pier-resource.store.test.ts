import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollPierResourceOnce,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";

const SNAPSHOT = {
  appProcesses: [
    {
      cpuPercent: 0.1,
      memoryBytes: 100 * 1024 * 1024,
      pid: 1,
      role: "main" as const,
      typeName: "Browser",
    },
  ],
  meta: {
    cpuWarmingUp: false,
    platform: "darwin" as const,
    treeCapability: "full" as const,
  },
  sampledAt: 1000,
  sessions: [],
  summary: {
    hostMemoryFreeBytes: 4 * 1024 * 1024 * 1024,
    hostMemoryTotalBytes: 16 * 1024 * 1024 * 1024,
    hotCount: 0,
    pierAppCpuPercent: 0.1,
    pierAppMemoryBytes: 100 * 1024 * 1024,
    terminalCount: 0,
    totalRelatedCpuPercent: 0.1,
    totalRelatedMemoryBytes: 100 * 1024 * 1024,
    workloadCpuPercent: 0,
    workloadMemoryBytes: 0,
  },
};

describe("pier-resource store errors", () => {
  beforeEach(() => {
    usePierResourceStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
  });

  it("records error when snapshot fails and clears on success", async () => {
    const snapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(SNAPSHOT);
    (
      window as unknown as {
        pier: { resources: { snapshot: typeof snapshot } };
      }
    ).pier = { resources: { snapshot } };

    await pollPierResourceOnce();
    expect(usePierResourceStore.getState().error).toMatch(/boom/);
    expect(usePierResourceStore.getState().snapshot).toBeNull();

    await pollPierResourceOnce();
    expect(usePierResourceStore.getState().error).toBeNull();
    expect(usePierResourceStore.getState().snapshot).not.toBeNull();
    expect(usePierResourceStore.getState().cpuHistory).toHaveLength(1);
  });
});
