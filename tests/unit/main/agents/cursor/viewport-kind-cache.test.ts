import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createViewportKindCache } from "../../../../../src/main/services/agents/integrations/transcript/viewport-kind-cache.ts";

const QUESTION = "Question 1 of 1\n↑/↓ option · Space select · Esc to skip";
const IDLE = "Thinking...\nGrep pattern";
const RECONCILER = join(
  process.cwd(),
  "src/main/services/agents/integrations/transcript/cursor-reconciler.ts"
);

describe("viewport kind cache", () => {
  it("does not rescan when the viewport string is unchanged", () => {
    const kindOf = vi.fn((text: string) =>
      text.includes("Question") ? ("question" as const) : null
    );
    const cache = createViewportKindCache(kindOf);
    expect(cache.kindFor("a", QUESTION)).toBe("question");
    expect(cache.kindFor("a", QUESTION)).toBe("question");
    expect(kindOf).toHaveBeenCalledTimes(1);
  });

  it("caches a null kind so unchanged idle screens are not rescanned", () => {
    const kindOf = vi.fn(() => null);
    const cache = createViewportKindCache(kindOf);
    expect(cache.kindFor("a", IDLE)).toBeNull();
    expect(cache.kindFor("a", IDLE)).toBeNull();
    expect(kindOf).toHaveBeenCalledTimes(1);
  });

  it("rescans after clear", () => {
    const kindOf = vi.fn((text: string) =>
      text.includes("Question") ? ("question" as const) : null
    );
    const cache = createViewportKindCache(kindOf);
    cache.kindFor("a", QUESTION);
    cache.clear("a");
    expect(cache.kindFor("a", QUESTION)).toBe("question");
    expect(kindOf).toHaveBeenCalledTimes(2);
  });

  it("moves cached text to the new scope on rekey", () => {
    const kindOf = vi.fn((text: string) =>
      text.includes("Question") ? ("question" as const) : null
    );
    const cache = createViewportKindCache(kindOf);
    expect(cache.kindFor("old", QUESTION)).toBe("question");
    cache.rekey("old", "new");
    expect(cache.kindFor("new", QUESTION)).toBe("question");
    expect(kindOf).toHaveBeenCalledTimes(1);
    expect(cache.kindFor("old", QUESTION)).toBe("question");
    expect(kindOf).toHaveBeenCalledTimes(2);
  });

  it("is rekeyed when cursor reconciler transfers panel ownership", () => {
    expect(readFileSync(RECONCILER, "utf8")).toContain(
      "viewportKindCache.rekey(sourceKey, targetKey)"
    );
  });
});
