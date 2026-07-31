import { describe, expect, it } from "vitest";
import {
  WORKBENCH_KPI_ITEM_MIN_WIDTH,
  workbenchDensityFor,
  workbenchKpiCollectionClassName,
  workbenchKpiCollectionStyle,
  workbenchKpiGridTemplateColumns,
  workbenchKpiLayoutMode,
  workbenchMaxKpisFor,
} from "@/lib/workbench/kpi-auto-layout.ts";

describe("workbench kpi auto-layout", () => {
  it("forces single KPI full width without grid columns", () => {
    const cls = workbenchKpiCollectionClassName(1);
    expect(cls).toContain("block");
    expect(cls).toContain("w-full");
    expect(workbenchKpiCollectionStyle(1)).toBeUndefined();
    expect(workbenchKpiGridTemplateColumns(1)).toBeUndefined();
    expect(workbenchKpiLayoutMode(1)).toBe("single");
  });

  it("sets content-intrinsic auto-fit columns via inline style (not Tailwind arbitrary)", () => {
    const cls = workbenchKpiCollectionClassName(3);
    expect(cls).toContain("grid");
    expect(cls).toContain("content-start");
    // 列定义必须走 style，避免动态 class / 未生成 CSS 变量导致永远单列
    expect(cls).not.toContain("grid-cols-");
    expect(cls).not.toContain("auto-fit");

    const style = workbenchKpiCollectionStyle(3);
    expect(style?.gridTemplateColumns).toContain("auto-fit");
    expect(style?.gridTemplateColumns).toContain("minmax");
    expect(style?.gridTemplateColumns).toContain(WORKBENCH_KPI_ITEM_MIN_WIDTH);
    expect(style?.gridTemplateColumns).toBe(workbenchKpiGridTemplateColumns(3));
    expect(workbenchKpiLayoutMode(3)).toBe("auto-fit");
  });

  it("does not invent stack/row modes", () => {
    expect(workbenchKpiLayoutMode(0)).toBe("empty");
    expect(workbenchKpiLayoutMode(2)).toBe("auto-fit");
    expect(workbenchKpiGridTemplateColumns(4)).not.toMatch(/stack|row/);
  });

  it("uses height only for density structure", () => {
    expect(workbenchDensityFor({ h: 2, w: 6 })).toBe("compact");
    expect(workbenchDensityFor({ h: 3, w: 2 })).toBe("medium");
    expect(workbenchDensityFor({ h: 4, w: 2 })).toBe("full");
  });

  it("caps KPI count by density and width without arrange axis", () => {
    expect(workbenchMaxKpisFor("compact", 6)).toBe(2);
    expect(workbenchMaxKpisFor("medium", 2)).toBe(2);
    expect(workbenchMaxKpisFor("medium", 4)).toBe(3);
    expect(workbenchMaxKpisFor("medium", 6)).toBe(4);
    expect(workbenchMaxKpisFor("full", 2)).toBe(4);
  });
});
