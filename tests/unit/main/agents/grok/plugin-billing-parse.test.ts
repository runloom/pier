import { describe, expect, it } from "vitest";
import { parseGrokBillingResult } from "../../../../../packages/plugin-grok/src/main/billing-parse.ts";

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
  it("maps prepaid balance cents into a currency metric", () => {
    expect(
      parseGrokBillingResult({
        config: {
          creditUsagePercent: 10,
          prepaidBalance: { val: 1250 },
        },
      }).metrics
    ).toContainEqual({
      currency: "USD",
      format: "currency",
      id: "grok:prepaid-balance",
      kind: "scalar",
      value: 12.5,
    });
  });

  it("maps period and product windows from credits format when populated", () => {
    const result = parseGrokBillingResult(CREDITS_FIXTURE);
    expect(result.status).toBe("ok");
    expect(result.metrics.map((metric) => metric.id)).toEqual([
      "grok:period",
      "grok:product:Api",
      "grok:product:GrokBuild",
    ]);
    expect(result.metrics[0]).toMatchObject({
      groupId: "grok:period",
      kind: "quota",
      name: "Weekly limit",
      usedPercent: 100,
      windowMinutes: 10_080,
    });
  });

  it("maps used/monthlyLimit cents from default billing as monthly spend", () => {
    const result = parseGrokBillingResult(DEFAULT_FIXTURE);
    expect(result.status).toBe("ok");
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]).toMatchObject({
      id: "grok:period",
      kind: "quota",
      // Cash path must not be labeled as credit "limit".
      name: "Monthly spend",
      usedPercent: expect.closeTo((4112 / 15_000) * 100, 5),
      windowMinutes: 44_640,
    });
  });

  it("prefers creditUsagePercent over cash monthly when both are present", () => {
    const result = parseGrokBillingResult({
      config: {
        creditUsagePercent: 91,
        currentPeriod: {
          end: "2026-07-21T00:00:00.000Z",
          start: "2026-07-14T00:00:00.000Z",
          type: "USAGE_PERIOD_TYPE_WEEKLY",
        },
        monthlyLimit: { val: 15_000 },
        productUsage: [
          { product: "GrokBuild", usagePercent: 80 },
          { product: "Api", usagePercent: 11 },
        ],
        used: { val: 417 },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.metrics[0]).toMatchObject({
      id: "grok:period",
      name: "Weekly limit",
      usedPercent: 91,
      windowMinutes: 10_080,
    });
    // Must not surface cash monthly as the period meter.
    expect(
      result.metrics.some(
        (metric) => metric.kind === "quota" && metric.name === "Monthly spend"
      )
    ).toBe(false);
    expect(result.metrics.map((metric) => metric.id)).toEqual([
      "grok:period",
      "grok:product:GrokBuild",
      "grok:product:Api",
    ]);
  });

  it("treats a currentPeriod without percent meters as a fresh 0% window", () => {
    const result = parseGrokBillingResult(SPARSE_CREDITS_FIXTURE);
    expect(result.status).toBe("ok");
    expect(result.metrics).toEqual([
      {
        groupId: "grok:period",
        id: "grok:period",
        kind: "quota",
        name: "Weekly limit",
        resetsAt: Date.parse("2026-07-21T05:50:57.340339+00:00"),
        usedPercent: 0,
        windowMinutes: 10_080,
      },
    ]);
  });

  it("does not invent a period window from an empty currentPeriod object", () => {
    expect(
      parseGrokBillingResult({
        config: {
          currentPeriod: {},
          onDemandCap: { val: 0 },
          prepaidBalance: { val: 0 },
        },
      })
    ).toMatchObject({
      status: "error",
      error: "No Grok quota windows in billing response",
      metrics: [],
    });
  });

  it("still errors when billing has no period identity and no meters", () => {
    expect(parseGrokBillingResult({ config: {} })).toMatchObject({
      status: "error",
      error: "No Grok quota windows in billing response",
      metrics: [],
    });
  });

  it("does not invent a weekly window from type-only currentPeriod plus monthly dates", () => {
    const result = parseGrokBillingResult({
      config: {
        billingPeriodEnd: "2026-08-01T00:00:00+00:00",
        billingPeriodStart: "2026-07-01T00:00:00+00:00",
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
        monthlyLimit: { val: 15_000 },
        used: { val: 4112 },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.metrics[0]).toMatchObject({
      id: "grok:period",
      name: "Monthly spend",
    });
    expect(
      result.metrics.some(
        (metric) => metric.kind === "quota" && metric.name === "Weekly limit"
      )
    ).toBe(false);
  });

  it("does not invent a period window from type-only currentPeriod", () => {
    expect(
      parseGrokBillingResult({
        config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } },
      })
    ).toMatchObject({
      status: "error",
      error: "No Grok quota windows in billing response",
      metrics: [],
    });
  });

  it("keeps a lone product instead of synthesizing 0% when currentPeriod has dates", () => {
    const result = parseGrokBillingResult({
      config: {
        currentPeriod: {
          end: "2026-07-21T00:00:00.000Z",
          start: "2026-07-14T00:00:00.000Z",
          type: "USAGE_PERIOD_TYPE_WEEKLY",
        },
        productUsage: [{ product: "Api", usagePercent: 73 }],
      },
    });
    expect(result.status).toBe("ok");
    expect(result.metrics.map((metric) => metric.id)).toEqual([
      "grok:product:Api",
    ]);
    expect(result.metrics[0]).toMatchObject({ usedPercent: 73 });
  });

  it("keeps product percents instead of synthesizing 0% when the period total is missing", () => {
    const result = parseGrokBillingResult({
      config: {
        currentPeriod: {
          end: "2026-07-21T00:00:00.000Z",
          start: "2026-07-14T00:00:00.000Z",
          type: "USAGE_PERIOD_TYPE_WEEKLY",
        },
        productUsage: [
          { product: "GrokBuild", usagePercent: 80 },
          { product: "Api", usagePercent: 11 },
        ],
      },
    });
    expect(result.status).toBe("ok");
    expect(result.metrics.map((metric) => metric.id)).toEqual([
      "grok:product:GrokBuild",
      "grok:product:Api",
    ]);
  });

  it("prefers a synthesized weekly window over cash monthly at rollover", () => {
    const result = parseGrokBillingResult({
      config: {
        ...SPARSE_CREDITS_FIXTURE.config,
        monthlyLimit: { val: 15_000 },
        used: { val: 4112 },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.metrics[0]).toMatchObject({
      id: "grok:period",
      name: "Weekly limit",
      usedPercent: 0,
    });
    expect(
      result.metrics.some(
        (metric) => metric.kind === "quota" && metric.name === "Monthly spend"
      )
    ).toBe(false);
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
    expect(result.metrics.map((metric) => metric.id)).toEqual(["grok:period"]);
  });

  it("keeps a single product window when no period total is present", () => {
    expect(
      parseGrokBillingResult({
        config: { productUsage: [{ product: "Api", usagePercent: 73 }] },
      })
    ).toMatchObject({
      status: "ok",
      metrics: [{ id: "grok:product:Api", usedPercent: 73 }],
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
    expect(result.metrics.at(-1)).toMatchObject({
      id: "grok:on-demand",
      groupId: "grok:on-demand",
      kind: "quota",
      name: "On-demand",
      usedPercent: 25,
    });
  });
});
