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

describe("pricing catalog", () => {
  it("prices every canonical model with a plain observation", () => {
    const entries = Object.entries(MODEL_PRICING);
    expect(entries.length).toBeGreaterThan(0);
    for (const [modelId, pricing] of entries) {
      const cost = estimateObservationCostMicrousd(observation({ modelId }));
      expect(cost, `catalog entry ${modelId}`).not.toBeNull();
      expect(cost, `catalog entry ${modelId}`).toBe(
        Math.round(1000 * pricing.inputMicrousd + 100 * pricing.outputMicrousd)
      );
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
    const dated = estimateObservationCostMicrousd(
      observation({ modelId: "gpt-4o-2024-05-13" })
    );
    const current = estimateObservationCostMicrousd(
      observation({ modelId: "gpt-4o" })
    );
    expect(dated).toBe(6500);
    expect(current).toBe(3500);
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
    // short: 100_000 * 1.25 = 125_000
    // long : 300_000 * 2.5  = 750_000
    expect(short).toBe(125_000);
    expect(long).toBe(750_000);
  });

  it("routes Anthropic cached input tokens through the discounted lane", () => {
    const cost = estimateObservationCostMicrousd(
      observation({
        cachedInputTokens: 1000,
        inputTokens: 1000,
        modelId: "claude-sonnet-4-5",
        outputTokens: 0,
      })
    );
    // cached: 1000 * 0.3 = 300
    expect(cost).toBe(300);
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
