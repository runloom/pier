import { describe, expect, it } from "vitest";
import {
  densityFor,
  maxKpisFor,
  processRowLimitFor,
  visibleKpiIds,
} from "@/panel-kits/workbench/core-widgets/system-resources-density.ts";

describe("system-resources density", () => {
  it("uses height only for density", () => {
    expect(densityFor({ h: 2, w: 4 })).toBe("compact");
    expect(densityFor({ h: 2, w: 2 })).toBe("compact");
    expect(densityFor({ h: 3, w: 2 })).toBe("medium");
    expect(densityFor({ h: 4, w: 2 })).toBe("full");
    expect(densityFor({ h: 3, w: 4 })).toBe("medium");
    expect(densityFor({ h: 4, w: 4 })).toBe("full");
  });

  it("limits KPI count by density and width without stack/row arrange", () => {
    expect(maxKpisFor("compact", 2)).toBe(2);
    expect(maxKpisFor("compact", 3)).toBe(2);
    expect(maxKpisFor("medium", 2, 3)).toBe(2);
    expect(maxKpisFor("medium", 4, 3)).toBe(3);
    expect(maxKpisFor("medium", 6, 2)).toBe(4);
    expect(maxKpisFor("full", 4)).toBe(4);
    expect(visibleKpiIds("compact", 2)).toEqual(["totalMemory", "totalCpu"]);
    expect(visibleKpiIds("full", 4)).toEqual([
      "totalMemory",
      "totalCpu",
      "appMemory",
      "workloadMemory",
    ]);
  });

  it("limits process rows by height", () => {
    expect(processRowLimitFor("compact", 2)).toBe(0);
    expect(processRowLimitFor("medium", 3)).toBe(3);
    expect(processRowLimitFor("full", 4)).toBe(6);
    expect(processRowLimitFor("full", 6)).toBe(12);
  });
});
