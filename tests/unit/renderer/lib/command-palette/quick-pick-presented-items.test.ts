import { describe, expect, it } from "vitest";
import { quickPickPresentedItems } from "@/components/common/command-palette-quick-pick-view.tsx";
import type { QuickPick, QuickPickItem } from "@/lib/command-palette/types.ts";

function item(id: string, label: string): QuickPickItem {
  return { id, label };
}

function pick(
  items: readonly QuickPickItem[],
  overrides?: Partial<QuickPick>
): QuickPick {
  return {
    items,
    onAccept: () => undefined,
    title: "test",
    ...overrides,
  };
}

describe("quickPickPresentedItems", () => {
  it("reorders via quickPickResults by default when not loading", () => {
    const items = [item("loose", "feature/deploy-vault"), item("exact", "dev")];
    const results = quickPickPresentedItems(pick(items), "dev");
    expect(results.map((entry) => entry.label)).toEqual([
      "dev",
      "feature/deploy-vault",
    ]);
  });

  it("preserves main ranking when preserveItemOrder is true", () => {
    const items = [
      item("main-rank-1", "src/main/ipc/theme.ts"),
      item("main-rank-2", "src/plugins/theme.ts"),
      item("main-rank-3", "theme.ts"),
    ];
    const results = quickPickPresentedItems(
      pick(items, { preserveItemOrder: true }),
      "theme"
    );
    expect(results.map((entry) => entry.id)).toEqual([
      "main-rank-1",
      "main-rank-2",
      "main-rank-3",
    ]);
  });

  it("still preserves order for sections when preserveItemOrder is true", () => {
    const results = quickPickPresentedItems(
      {
        onAccept: () => undefined,
        preserveItemOrder: true,
        sections: [
          {
            heading: "Files",
            id: "files",
            items: [
              item("a", "alpha-theme"),
              item("b", "theme"),
              item("c", "beta"),
            ],
          },
        ],
        title: "test",
      },
      "theme"
    );
    expect(results.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});
