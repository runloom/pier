import { describe, expect, it } from "vitest";
// The updater is a plain Node ESM script (`.mjs`); import the pure helpers under test.
import {
  canFillFromOpenRouter,
  catalogKeyFor,
  finalizeCatalogDiff,
  openRouterModelToEntry,
  shouldInclude,
} from "../../../../scripts/update-model-pricing.mjs";

describe("model pricing updater", () => {
  it("keeps dated pricing identities separate while folding latest", () => {
    expect(catalogKeyFor("gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
    expect(catalogKeyFor("gpt-4o-latest")).toBe("gpt-4o");
    expect(catalogKeyFor("openai/gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
  });

  it("finalizeCatalogDiff reports no-op and reuses previous entry objects", () => {
    const current = {
      "gpt-4o": {
        aliases: ["openai/gpt-4o"],
        cachedInputMicrousd: 1,
        inputMicrousd: 2,
        outputMicrousd: 6,
      },
    };
    // Same values, different key order / fresh object (merge noise).
    const next = {
      "gpt-4o": {
        inputMicrousd: 2,
        outputMicrousd: 6,
        cachedInputMicrousd: 1,
        aliases: ["openai/gpt-4o"],
      },
    };

    const result = finalizeCatalogDiff(current, next);

    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toBe(1);
    // Keep disk entry so rewrite does not churn property order.
    expect(next["gpt-4o"]).toBe(current["gpt-4o"]);
  });

  it("finalizeCatalogDiff detects price and alias changes", () => {
    const current = {
      "gpt-4o": {
        aliases: ["openai/gpt-4o"],
        inputMicrousd: 2,
        outputMicrousd: 6,
      },
    };
    const next = {
      "gpt-4o": {
        aliases: ["openai/gpt-4o", "openrouter/openai/gpt-4o"],
        inputMicrousd: 3,
        outputMicrousd: 6,
      },
      "new-model": {
        inputMicrousd: 1,
        outputMicrousd: 2,
      },
    };

    const result = finalizeCatalogDiff(current, next);

    expect(result.unchanged).toBe(0);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toContain("gpt-4o");
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toContain("new-model");
    expect(next["gpt-4o"]).not.toBe(current["gpt-4o"]);
  });

  it("unprefixes xAI LiteLLM keys into canonical grok ids", () => {
    expect(catalogKeyFor("xai/grok-4.5")).toBe("grok-4.5");
    expect(catalogKeyFor("xai/grok-4.5-latest")).toBe("grok-4.5");
    expect(catalogKeyFor("xai/grok-4.3")).toBe("grok-4.3");
    expect(shouldInclude("xai/grok-4.5", { mode: "chat" })).toBe(true);
    expect(shouldInclude("xai/grok-code-fast-1", { mode: "chat" })).toBe(true);
  });

  it("builds a catalog entry from OpenRouter pricing for fill-missing", () => {
    expect(
      openRouterModelToEntry({
        id: "x-ai/grok-4.5",
        pricing: {
          completion: "0.000006",
          input_cache_read: "0.0000005",
          prompt: "0.000002",
        },
      })
    ).toEqual({
      cachedInputMicrousd: 0.5,
      inputMicrousd: 2,
      outputMicrousd: 6,
    });
  });

  it("only fill-misses versioned models from trusted OpenRouter providers", () => {
    expect(canFillFromOpenRouter("x-ai/grok-4.5", "grok-4.5")).toBe(true);
    expect(canFillFromOpenRouter("openai/gpt-5.6-sol", "gpt-5.6-sol")).toBe(
      true
    );
    expect(canFillFromOpenRouter("x-ai/grok", "grok")).toBe(false);
    expect(canFillFromOpenRouter("openai/gpt", "gpt")).toBe(false);
    expect(canFillFromOpenRouter("some-random/gpt-5", "gpt-5")).toBe(false);
  });

  it("allows OpenRouter fill-missing for moonshotai kimi-k3", () => {
    // LiteLLM 尚无 kimi-k3 时，脚本应能从 OpenRouter 补入
    expect(canFillFromOpenRouter("moonshotai/kimi-k3", "kimi-k3")).toBe(true);
    expect(shouldInclude("kimi-k3", { mode: "chat" })).toBe(true);
    expect(
      openRouterModelToEntry({
        id: "moonshotai/kimi-k3",
        pricing: {
          completion: "0.000015",
          input_cache_read: "0.0000003",
          prompt: "0.000003",
        },
      })
    ).toEqual({
      cachedInputMicrousd: 0.3,
      inputMicrousd: 3,
      outputMicrousd: 15,
    });
  });
});
