import { describe, expect, it } from "vitest";
import { quickPickResults } from "@/lib/command-palette/quick-pick-search.ts";
import type { QuickPickItem } from "@/lib/command-palette/types.ts";

function item(
  id: string,
  label: string,
  extra?: Partial<QuickPickItem>
): QuickPickItem {
  return { id, label, ...extra };
}

describe("quickPickResults", () => {
  it("returns items unchanged for an empty query", () => {
    const items = [item("a", "alpha"), item("b", "beta")];
    expect(quickPickResults(items, "  ")).toEqual(items);
  });

  it("ranks an exact label match above an earlier loose subsequence match", () => {
    const items = [
      item("refs/heads/feature/deploy-vault", "feature/deploy-vault"),
      item("refs/heads/dev", "dev"),
    ];
    const results = quickPickResults(items, "dev");
    expect(results.map((entry) => entry.label)).toEqual([
      "dev",
      "feature/deploy-vault",
    ]);
  });

  it("ranks prefix matches above substring matches", () => {
    const items = [
      item("refs/heads/my-dev", "my-dev"),
      item("refs/heads/dev-tools", "dev-tools"),
    ];
    const results = quickPickResults(items, "dev");
    expect(results.map((entry) => entry.label)).toEqual([
      "dev-tools",
      "my-dev",
    ]);
  });

  it("keeps source order for equally ranked matches", () => {
    const items = [
      item("refs/heads/zebra", "zebra", { searchTerms: ["match"] }),
      item("refs/heads/alpha", "alpha", { searchTerms: ["match"] }),
    ];
    const results = quickPickResults(items, "match");
    expect(results.map((entry) => entry.label)).toEqual(["zebra", "alpha"]);
  });

  it("still matches scattered subsequences as the weakest tier", () => {
    const items = [
      item("refs/heads/feature/deploy-vault", "feature/deploy-vault"),
    ];
    const results = quickPickResults(items, "dev");
    expect(results).toHaveLength(1);
  });

  it("drops items that do not match at all", () => {
    const items = [item("refs/heads/main", "main")];
    expect(quickPickResults(items, "dev")).toHaveLength(0);
  });
});
