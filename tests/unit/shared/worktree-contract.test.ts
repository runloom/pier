import { worktreeCreationDefaultsSchema } from "@shared/contracts/worktree.ts";
import { describe, expect, it } from "vitest";

describe("worktreeCreationDefaultsSchema", () => {
  it("accepts creation defaults without the removed setupCommand field", () => {
    expect(
      worktreeCreationDefaultsSchema.parse({
        copyPatterns: [".env*"],
        rootPath: "/repo.worktree",
      })
    ).toEqual({
      copyPatterns: [".env*"],
      rootPath: "/repo.worktree",
    });
  });
});
