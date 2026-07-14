import { describe, expect, it } from "vitest";
import { catalogKeyFor } from "../../../scripts/update-model-pricing.mjs";

describe("model pricing updater", () => {
  it("keeps dated pricing identities separate while folding latest", () => {
    expect(catalogKeyFor("gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
    expect(catalogKeyFor("gpt-4o-latest")).toBe("gpt-4o");
    expect(catalogKeyFor("openai/gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
  });
});
