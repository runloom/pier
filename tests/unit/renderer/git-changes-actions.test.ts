import { describe, expect, it } from "vitest";
import { GIT_CHANGES_ACTION_CONTRIBUTIONS } from "@/panel-kits/git-changes/register-actions.ts";

describe("git-changes actions", () => {
  it("declares the open-changes command contribution", () => {
    const open = GIT_CHANGES_ACTION_CONTRIBUTIONS.find(
      (action) => action.id === "pier.git.changes.open"
    );
    expect(open).toBeDefined();
    expect(open?.categoryKey).toBe("git");
    expect(open?.titleKey).toBe("commandPalette.action.openGitChanges");
    expect(open?.surfaces).toContain("command-palette");
  });
});
