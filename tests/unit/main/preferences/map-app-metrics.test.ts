import { describe, expect, it } from "vitest";
import {
  mapAppMetrics,
  mapProcessTypeToRole,
  sumAppProcessCpu,
  sumAppProcessMemory,
} from "../../../../src/main/services/pier-resource/map-app-metrics.ts";

describe("mapProcessTypeToRole", () => {
  it("maps Chromium process types to product roles", () => {
    expect(mapProcessTypeToRole("Browser")).toBe("main");
    expect(mapProcessTypeToRole("Tab")).toBe("window");
    expect(mapProcessTypeToRole("GPU")).toBe("gpu");
    expect(mapProcessTypeToRole("Utility")).toBe("utility");
    expect(mapProcessTypeToRole("Zygote")).toBe("other");
  });
});

describe("mapAppMetrics", () => {
  const sample = [
    {
      cpu: { percentCPUUsage: 25 },
      memory: { workingSetSize: 100 },
      pid: 1,
      type: "Browser",
    },
    {
      cpu: { percentCPUUsage: 50 },
      memory: { workingSetSize: 200 },
      pid: 2,
      type: "Tab",
    },
  ] as const;

  it("converts KB working set to bytes and percent points to ratio", () => {
    const rows = mapAppMetrics(sample, { cpuWarmingUp: false });
    expect(rows).toEqual([
      {
        cpuPercent: 0.25,
        memoryBytes: 100 * 1024,
        pid: 1,
        role: "main",
        typeName: "Browser",
      },
      {
        cpuPercent: 0.5,
        memoryBytes: 200 * 1024,
        pid: 2,
        role: "window",
        typeName: "Tab",
      },
    ]);
    expect(sumAppProcessMemory(rows)).toBe(300 * 1024);
    expect(sumAppProcessCpu(rows)).toBeCloseTo(0.75);
  });

  it("nulls CPU while warming up", () => {
    const rows = mapAppMetrics(sample, { cpuWarmingUp: true });
    expect(rows.every((row) => row.cpuPercent === null)).toBe(true);
    expect(sumAppProcessCpu(rows)).toBeNull();
  });
});
