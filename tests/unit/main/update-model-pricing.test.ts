import { describe, expect, it } from "vitest";
// The updater is a plain Node ESM script (`.mjs`); import the pure helpers under test.
import {
  canFillFromOpenRouter,
  catalogKeyFor,
  openRouterModelToEntry,
  shouldInclude,
} from "../../../scripts/update-model-pricing.mjs";

describe("model pricing updater", () => {
  it("keeps dated pricing identities separate while folding latest", () => {
    expect(catalogKeyFor("gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
    expect(catalogKeyFor("gpt-4o-latest")).toBe("gpt-4o");
    expect(catalogKeyFor("openai/gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
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
});
