import { parseRateLimitsResult } from "@main/services/agent-accounts/codex-usage.ts";
import { describe, expect, it } from "vitest";

/** 本机 codex-cli 0.142.5 实测响应（account/rateLimits/read）。 */
const REAL_RPC_RESULT = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: {
      usedPercent: 11,
      windowDurationMins: 300,
      resetsAt: 1_783_283_542,
    },
    secondary: {
      usedPercent: 49,
      windowDurationMins: 10_080,
      resetsAt: 1_783_389_343,
    },
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    individualLimit: null,
    planType: "pro",
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {},
  rateLimitResetCredits: { availableCount: 1 },
};

describe("parseRateLimitsResult", () => {
  it("解析实测完整响应", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.status).toBe("ok");
    expect(usage.session).toEqual({
      usedPercent: 11,
      windowMinutes: 300,
      resetsAt: 1_783_283_542_000, // epoch 秒 ×1000 → 毫秒
    });
    expect(usage.weekly).toEqual({
      usedPercent: 49,
      windowMinutes: 10_080,
      resetsAt: 1_783_389_343_000,
    });
  });

  it("resetsAt 从 epoch 秒转为 epoch 毫秒", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    // 验证毫秒级时间戳（2026 年范围）
    expect(usage.session?.resetsAt).toBeGreaterThan(1_700_000_000_000);
    expect(usage.weekly?.resetsAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("windowDurationMins 映射到 windowMinutes", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.session?.windowMinutes).toBe(300);
    expect(usage.weekly?.windowMinutes).toBe(10_080);
  });

  it("缺少 rateLimits 时返回 error", () => {
    const usage = parseRateLimitsResult({});
    expect(usage.status).toBe("error");
    expect(usage.error).toBeDefined();
  });

  it("缺少 primary/secondary 时对应字段为 undefined", () => {
    const usage = parseRateLimitsResult({
      rateLimits: { limitId: "codex" },
    });
    expect(usage.status).toBe("ok");
    expect(usage.session).toBeUndefined();
    expect(usage.weekly).toBeUndefined();
  });

  it("null 输入返回 error", () => {
    const usage = parseRateLimitsResult(null);
    expect(usage.status).toBe("error");
  });
});
