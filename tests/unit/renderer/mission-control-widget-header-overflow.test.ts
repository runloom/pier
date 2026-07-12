import { describe, expect, it } from "vitest";
import { fitWidgetHeaderActionWidths } from "@/panel-kits/mission-control/use-widget-header-overflow.ts";

describe("mission control widget header overflow", () => {
  it("keeps every action direct when the measured widths fit", () => {
    expect(fitWidgetHeaderActionWidths(320, [24, 24, 24, 24], 24, 4)).toBe(4);
  });

  it("moves lower-priority trailing actions behind More as space contracts", () => {
    expect(fitWidgetHeaderActionWidths(228, [24, 24, 24, 24], 24, 4)).toBe(2);
    expect(fitWidgetHeaderActionWidths(170, [24, 24, 24, 24], 24, 4)).toBe(0);
  });

  it("uses measured button widths instead of assuming identical actions", () => {
    expect(fitWidgetHeaderActionWidths(220, [24, 40, 40], 24, 4)).toBe(2);
  });

  it("does not reserve More when there are no actions", () => {
    expect(fitWidgetHeaderActionWidths(120, [], 24, 4)).toBe(0);
  });
});
