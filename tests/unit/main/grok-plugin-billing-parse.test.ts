import { describe, expect, it } from "vitest";
import { parseGrokBillingResult } from "../../../packages/plugin-grok/src/main/billing-parse.ts";

const CREDITS_FIXTURE = {
  config: {
    billingPeriodEnd: "2026-07-21T05:50:57.340339+00:00",
    billingPeriodStart: "2026-07-14T05:50:57.340339+00:00",
    creditUsagePercent: 100,
    currentPeriod: {
      end: "2026-07-21T05:50:57.340339+00:00",
      start: "2026-07-14T05:50:57.340339+00:00",
      type: "USAGE_PERIOD_TYPE_WEEKLY",
    },
    onDemandCap: { val: "0" },
    onDemandUsed: { val: "0" },
    prepaidBalance: { val: "0" },
    productUsage: [
      { product: "Api", usagePercent: 99 },
      { product: "GrokBuild", usagePercent: 1 },
    ],
  },
};

/** Live default `/v1/billing` shape observed when format=credits is sparse. */
const DEFAULT_FIXTURE = {
  config: {
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    history: [],
    monthlyLimit: { val: 15_000 },
    onDemandCap: { val: 0 },
    used: { val: 4112 },
  },
};

const SPARSE_CREDITS_FIXTURE = {
  config: {
    billingPeriodEnd: "2026-07-21T05:50:57.340339+00:00",
    billingPeriodStart: "2026-07-14T05:50:57.340339+00:00",
    currentPeriod: {
      end: "2026-07-21T05:50:57.340339+00:00",
      start: "2026-07-14T05:50:57.340339+00:00",
      type: "USAGE_PERIOD_TYPE_WEEKLY",
    },
    isUnifiedBillingUser: true,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
  },
};

describe("parseGrokBillingResult", () => {
  it("maps period and product windows from credits format when populated", () => {
    const result = parseGrokBillingResult(CREDITS_FIXTURE);
    expect(result.status).toBe("ok");
    expect(result.windows.map((w) => w.id)).toEqual([
      "grok:period",
      "grok:product:Api",
      "grok:product:GrokBuild",
    ]);
    expect(result.windows[0]).toMatchObject({
      limitId: "period",
      limitName: "Weekly limit",
      usedPercent: 100,
      windowMinutes: 10_080,
    });
  });

  it("maps used/monthlyLimit cents from default billing endpoint", () => {
    const result = parseGrokBillingResult(DEFAULT_FIXTURE);
    expect(result.status).toBe("ok");
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]).toMatchObject({
      id: "grok:period",
      limitId: "period",
      limitName: "Monthly limit",
      usedPercent: expect.closeTo((4112 / 15_000) * 100, 5),
      windowMinutes: 44_640,
    });
  });

  it("returns error for sparse credits response with no usable meters", () => {
    expect(parseGrokBillingResult(SPARSE_CREDITS_FIXTURE)).toMatchObject({
      status: "error",
      error: "No Grok quota windows in billing response",
      windows: [],
    });
  });

  it("omits one valid product duplicate when another product row is invalid", () => {
    const result = parseGrokBillingResult({
      config: {
        creditUsagePercent: 42,
        currentPeriod: {
          end: "2026-07-21T00:00:00.000Z",
          start: "2026-07-14T00:00:00.000Z",
          type: "USAGE_PERIOD_TYPE_WEEKLY",
        },
        productUsage: [
          { product: "Api", usagePercent: 42 },
          { product: "GrokBuild", usagePercent: "not-a-number" },
        ],
      },
    });

    expect(result.status).toBe("ok");
    expect(result.windows.map((window) => window.id)).toEqual(["grok:period"]);
  });

  it("keeps a single product window when no period total is present", () => {
    expect(
      parseGrokBillingResult({
        config: { productUsage: [{ product: "Api", usagePercent: 73 }] },
      })
    ).toMatchObject({
      status: "ok",
      windows: [{ id: "grok:product:Api", usedPercent: 73 }],
    });
  });

  it("includes on-demand window when cap > 0", () => {
    const result = parseGrokBillingResult({
      config: {
        ...CREDITS_FIXTURE.config,
        onDemandCap: { val: "20000" },
        onDemandUsed: { val: "5000" },
      },
    });
    expect(result.windows.at(-1)).toMatchObject({
      id: "grok:on-demand",
      limitId: "on-demand",
      limitName: "On-demand",
      usedPercent: 25,
    });
  });
});
