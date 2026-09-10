import { handleGitReviewTreeKeyDown } from "@plugins/builtin/git/renderer/review/tree/hotkeys.ts";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import { describe, expect, it, vi } from "vitest";

const labels = {
  committed: "Changed Files",
  conflict: "Merge Changes",
  staged: "Staged Changes",
  unstaged: "Changes",
} as const;

describe("git review tree hotkeys", () => {
  it("does not preventDefault on a held Space", () => {
    const model = gitReviewTreeModel(
      [
        {
          entryKey: "ek:a.ts",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "sec:u:a",
              status: "modified",
              targetPath: "a.ts",
            },
          ],
          status: "modified",
        },
      ],
      (name) => name,
      labels,
      { expectedIndexRevision: "1", uncommitted: true }
    );
    const file = model.items.find((item) => item.kind === "file");
    expect(file).toBeTruthy();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
      repeat: true,
    });
    handleGitReviewTreeKeyDown(event, {
      context: {
        i18n: {
          t: (_key: string, _values?: unknown, fallback?: string) =>
            fallback ?? _key,
        },
        notifications: { error: vi.fn(), loading: vi.fn() },
      } as never,
      contextId: "ctx",
      gitRootPath: "/repo",
      mutationBlocked: false,
      searchOpen: false,
      selectedPaths: file ? [file.path] : [],
      treeModel: model,
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
