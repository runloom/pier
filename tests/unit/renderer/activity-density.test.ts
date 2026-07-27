import { describe, expect, it } from "vitest";
import {
  activityDensityFor,
  activityRowLimitFor,
  activityShowIndexFooter,
  activityShowList,
  activityShowRowMeta,
} from "@/panel-kits/workbench/core-widgets/activity/activity-density.ts";

describe("activity density", () => {
  it("uses height for density (not width-forced compact)", () => {
    expect(activityDensityFor({ h: 2, w: 6 })).toBe("compact");
    expect(activityDensityFor({ h: 2, w: 3 })).toBe("compact");
    // h=3 即使较窄也是 medium，避免「大半卡空白 + 三粒胶囊」
    expect(activityDensityFor({ h: 3, w: 3 })).toBe("medium");
    expect(activityDensityFor({ h: 3, w: 4 })).toBe("medium");
    expect(activityDensityFor({ h: 5, w: 4 })).toBe("full");
  });

  it("hides list body on compact cards", () => {
    expect(activityShowList("compact")).toBe(false);
    expect(activityShowList("medium")).toBe(true);
    expect(activityShowList("full")).toBe(true);
  });

  it("limits rows by density", () => {
    expect(activityRowLimitFor("compact", 2)).toBe(0);
    expect(activityRowLimitFor("medium", 3)).toBe(5);
    expect(activityRowLimitFor("full", 6)).toBe(16);
  });

  it("shows meta on full or wide medium", () => {
    expect(activityShowRowMeta("compact", 6)).toBe(false);
    expect(activityShowRowMeta("medium", 4)).toBe(false);
    expect(activityShowRowMeta("medium", 5)).toBe(true);
    expect(activityShowRowMeta("full", 4)).toBe(true);
  });

  it("shows index footer only when not compact and tall enough", () => {
    expect(activityShowIndexFooter("compact", 6)).toBe(false);
    expect(activityShowIndexFooter("medium", 3)).toBe(false);
    expect(activityShowIndexFooter("medium", 4)).toBe(true);
    expect(activityShowIndexFooter("full", 4)).toBe(true);
  });
});
