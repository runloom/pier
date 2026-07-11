import {
  formatBytes,
  formatCompactNumber,
  formatCount,
  formatDurationShort,
  formatPercent,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import { describe, expect, it } from "vitest";

describe("formatCompactNumber", () => {
  it("en：3.1B / 79.7M / 4.2K", () => {
    expect(formatCompactNumber(3_100_000_000, "en")).toBe("3.1B");
    expect(formatCompactNumber(79_700_000, "en")).toBe("79.7M");
    expect(formatCompactNumber(4190, "en")).toBe("4.2K");
  });

  it("zh-CN 走本地化单位（亿/万）", () => {
    expect(formatCompactNumber(3_100_000_000, "zh-CN")).toContain("亿");
  });

  it("非有限值回退占位", () => {
    expect(formatCompactNumber(Number.NaN, "en")).toBe("—");
  });
});

describe("formatCount", () => {
  it("千分位整数", () => {
    expect(formatCount(4190, "en")).toBe("4,190");
  });
});

describe("formatBytes", () => {
  it("1024 进制换算", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(812 * 1024 ** 2, "en")).toBe("812 MB");
    expect(formatBytes(38.2 * 1024 ** 3, "en")).toBe("38.2 GB");
  });

  it("负数/非法回退占位", () => {
    expect(formatBytes(-1, "en")).toBe("—");
  });
});

describe("formatPercent", () => {
  it("0-1 比例 → 百分数", () => {
    expect(formatPercent(0.63, "en")).toBe("63%");
  });
});

describe("formatDurationShort", () => {
  it("小时/分钟/秒三档", () => {
    expect(formatDurationShort(94 * 3_600_000 + 47 * 60_000)).toBe("94h 47m");
    expect(formatDurationShort(12 * 60_000 + 3000)).toBe("12m 3s");
    expect(formatDurationShort(45_000)).toBe("45s");
  });

  it("中文使用自然时长单位", () => {
    expect(formatDurationShort(159 * 3_600_000 + 18 * 60_000, "zh-CN")).toBe(
      "6天 15小时"
    );
    expect(formatDurationShort(58 * 60_000 + 32_000, "zh-CN")).toBe(
      "58分钟 32秒"
    );
  });
});

describe("formatRelativeTime", () => {
  it("按量级选单位", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now - 42_000, now, "en")).toBe("42 seconds ago");
    expect(formatRelativeTime(now - 3 * 60_000, now, "en")).toBe(
      "3 minutes ago"
    );
  });
});
