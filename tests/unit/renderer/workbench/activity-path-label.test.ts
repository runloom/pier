import { describe, expect, it } from "vitest";
import {
  activityRowMetaText,
  shortProjectLabel,
} from "@/panel-kits/workbench/core-widgets/activity/path-label.ts";

describe("shortProjectLabel", () => {
  it("returns the last path segment", () => {
    expect(shortProjectLabel("/Users/me/ABC/pier")).toBe("pier");
    expect(shortProjectLabel("C:\\\\repos\\\\pier\\\\")).toBe("pier");
  });

  it("returns undefined for empty", () => {
    expect(shortProjectLabel(undefined)).toBeUndefined();
    expect(shortProjectLabel("")).toBeUndefined();
    expect(shortProjectLabel("/")).toBeUndefined();
  });
});

describe("activityRowMetaText", () => {
  it("joins kind with short path when present", () => {
    expect(activityRowMetaText("智能体", "/tmp/my-app")).toBe(
      "智能体 · my-app"
    );
    expect(activityRowMetaText("Agent", undefined)).toBe("Agent");
  });
});
