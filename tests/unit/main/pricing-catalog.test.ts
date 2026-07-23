import { estimateObservationCostMicrousd } from "@main/services/usage-data/pricing.ts";
import catalog from "@main/services/usage-data/pricing-catalog.json" with {
  type: "json",
};
import type { UsageTokenObservation } from "@pier/plugin-api/main";
import { describe, expect, it } from "vitest";

interface ModelPricingRow {
  aliases?: string[];
  cachedInputMicrousd: number;
  inputMicrousd: number;
  longContext?: {
    cachedInputMicrousd: number;
    inputMicrousd: number;
    outputMicrousd: number;
    threshold: number;
  };
  outputMicrousd: number;
  priority?: {
    cachedInputMicrousd: number;
    inputMicrousd: number;
    outputMicrousd: number;
  };
}

const MODEL_PRICING = (catalog as { models: Record<string, ModelPricingRow> })
  .models;

function observation(
  patch: Partial<UsageTokenObservation> & Pick<UsageTokenObservation, "modelId">
): UsageTokenObservation {
  return {
    cachedInputTokens: 0,
    date: "2026-07-13",
    inputTokens: 1000,
    outputTokens: 100,
    ...patch,
  };
}

/** 默认 observation（1000 in / 100 out）在给定费率下的期望微美元。 */
function plainCost(pricing: ModelPricingRow): number {
  return Math.round(
    1000 * pricing.inputMicrousd + 100 * pricing.outputMicrousd
  );
}

function requirePricing(modelId: string): ModelPricingRow {
  const pricing = MODEL_PRICING[modelId];
  expect(pricing, `catalog missing ${modelId}`).toBeDefined();
  return pricing!;
}

describe("pricing catalog", () => {
  it("prices every canonical model with a plain observation", () => {
    const entries = Object.entries(MODEL_PRICING);
    expect(entries.length).toBeGreaterThan(0);
    for (const [modelId, pricing] of entries) {
      const cost = estimateObservationCostMicrousd(observation({ modelId }));
      expect(cost, `catalog entry ${modelId}`).not.toBeNull();
      expect(cost, `catalog entry ${modelId}`).toBe(plainCost(pricing));
    }
  });

  it("normalizes dated Anthropic ids back to the canonical entry", () => {
    const dated = estimateObservationCostMicrousd(
      observation({ modelId: "claude-sonnet-4-5-20250929" })
    );
    const canonical = estimateObservationCostMicrousd(
      observation({ modelId: "claude-sonnet-4-5" })
    );
    expect(dated).toBe(canonical);
    expect(dated).not.toBeNull();
  });

  it("uses an exact dated model price before the canonical fallback", () => {
    const datedPricing = requirePricing("gpt-4o-2024-05-13");
    const currentPricing = requirePricing("gpt-4o");
    const dated = estimateObservationCostMicrousd(
      observation({ modelId: "gpt-4o-2024-05-13" })
    );
    const current = estimateObservationCostMicrousd(
      observation({ modelId: "gpt-4o" })
    );
    expect(dated).toBe(plainCost(datedPricing));
    expect(current).toBe(plainCost(currentPricing));
    expect(dated).not.toBe(current);
  });

  it("resolves Gemini revision suffixes through wildcard aliases", () => {
    const suffix = estimateObservationCostMicrousd(
      observation({ modelId: "gemini-2.5-pro-002" })
    );
    const canonical = estimateObservationCostMicrousd(
      observation({ modelId: "gemini-2.5-pro" })
    );
    expect(suffix).toBe(canonical);
    expect(suffix).not.toBeNull();
  });

  it("switches Gemini 2.5 Pro to long-context tier when input exceeds 200k tokens", () => {
    const pricing = requirePricing("gemini-2.5-pro");
    expect(pricing.longContext).toBeDefined();
    const short = estimateObservationCostMicrousd(
      observation({
        cachedInputTokens: 0,
        inputTokens: 100_000,
        modelId: "gemini-2.5-pro",
        outputTokens: 0,
      })
    );
    const long = estimateObservationCostMicrousd(
      observation({
        cachedInputTokens: 0,
        inputTokens: 300_000,
        modelId: "gemini-2.5-pro",
        outputTokens: 0,
      })
    );
    expect(short).toBe(Math.round(100_000 * pricing.inputMicrousd));
    expect(long).toBe(Math.round(300_000 * pricing.longContext!.inputMicrousd));
  });

  it("routes Anthropic cached input tokens through the discounted lane", () => {
    const pricing = requirePricing("claude-sonnet-4-5");
    const cost = estimateObservationCostMicrousd(
      observation({
        cachedInputTokens: 1000,
        inputTokens: 1000,
        modelId: "claude-sonnet-4-5",
        outputTokens: 0,
      })
    );
    expect(cost).toBe(Math.round(1000 * pricing.cachedInputMicrousd));
  });

  it("prices grok-4.5 and its common aliases", () => {
    const expected = plainCost(requirePricing("grok-4.5"));
    for (const modelId of [
      "grok-4.5",
      "grok-4.5-latest",
      "xai/grok-4.5",
      "x-ai/grok-4.5",
    ]) {
      expect(
        estimateObservationCostMicrousd(observation({ modelId })),
        modelId
      ).toBe(expected);
    }
  });

  it("does not let the grok-4 hyphen wildcard swallow dotted 4.x ids", () => {
    // `aliases: ["grok-4-*"]` → prefix `grok-4-`；`grok-4.5` 以 `.` 接续，不得命中。
    expect("grok-4.5".startsWith("grok-4-")).toBe(false);
    const grok4Pricing = requirePricing("grok-4");
    const grok45Pricing = requirePricing("grok-4.5");
    const grok4 = estimateObservationCostMicrousd(
      observation({ modelId: "grok-4" })
    );
    const grok45 = estimateObservationCostMicrousd(
      observation({ modelId: "grok-4.5" })
    );
    expect(grok4).toBe(plainCost(grok4Pricing));
    expect(grok45).toBe(plainCost(grok45Pricing));
    expect(grok45).not.toBe(grok4);
  });

  it("returns null for models the catalog has not learned about", () => {
    expect(
      estimateObservationCostMicrousd(
        observation({ modelId: "some-future-model" })
      )
    ).toBeNull();
    expect(
      estimateObservationCostMicrousd(observation({ modelId: "" }))
    ).toBeNull();
  });
});
