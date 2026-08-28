import { describe, expect, it } from "vitest";
import { groupCreateActions } from "@/components/workspace/add-panel-create-menu.ts";
import type { Action, ActionCategoryKey } from "@/lib/actions/types.ts";

function action(id: string, category: ActionCategoryKey): Action {
  return {
    category,
    handler: () => undefined,
    id,
    metadata: { categoryKey: category },
    title: () => id,
  };
}

describe("groupCreateActions", () => {
  it("omits an empty panel group after workbench teardown", () => {
    const groups = groupCreateActions(
      [
        action("pier.worktree.create", "worktree"),
        action("pier.files.newFile", "file"),
        action("pier.panel.newTerminal", "run"),
      ],
      new Map()
    );

    expect(groups.map((group) => group.category)).toEqual([
      "run",
      "file",
      "worktree",
    ]);
  });

  it("places the file group after panel and before worktree when panel actions exist", () => {
    const groups = groupCreateActions(
      [
        action("pier.worktree.create", "worktree"),
        action("pier.files.newFile", "file"),
        action("pier.panel.newTab", "panel"),
        action("pier.panel.newTerminal", "run"),
      ],
      new Map()
    );

    expect(groups.map((group) => group.category)).toEqual([
      "run",
      "panel",
      "file",
      "worktree",
    ]);
  });
});
