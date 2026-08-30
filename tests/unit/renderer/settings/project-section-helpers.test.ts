import { describe, expect, it } from "vitest";
import {
  listedProjectRootForPath,
  registeredRootAfterAdd,
} from "@/pages/settings/components/project/section-helpers.ts";

describe("project settings root helpers", () => {
  const projects = [
    { projectRootPath: "/repo" },
    { projectRootPath: "/other" },
  ];
  const bindings = [
    { projectRootPath: "/repo", worktreePath: "/repo.worktree/feat" },
  ];

  it("listedProjectRootForPath maps a linked worktree to the registered primary checkout", () => {
    expect(listedProjectRootForPath("/repo", projects, bindings)).toBe("/repo");
    expect(
      listedProjectRootForPath("/repo.worktree/feat", projects, bindings)
    ).toBe("/repo");
    expect(
      listedProjectRootForPath("/unregistered", projects, bindings)
    ).toBeNull();
  });

  it("registeredRootAfterAdd prefers the worktree binding written by addProject", () => {
    expect(
      registeredRootAfterAdd(
        {
          projects: [{ projectRootPath: "/repo" }],
          worktreeBindings: bindings,
        },
        "/repo.worktree/feat"
      )
    ).toBe("/repo");
    expect(
      registeredRootAfterAdd(
        {
          projects: [{ projectRootPath: "/repo" }],
          worktreeBindings: [],
        },
        "/repo"
      )
    ).toBe("/repo");
  });
});
