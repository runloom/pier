import { describe, expect, it } from "vitest";
import {
  boardParamsMatch,
  encodeScopeId,
} from "../../../../packages/plugin-tasks/src/main/scope-id.ts";

describe("task board scope id", () => {
  it("keeps Linear projects and providers on separate cache/watch keys", () => {
    expect(encodeScopeId({ provider: "linear", repo: "FL" })).not.toBe(
      encodeScopeId({
        projectId: "proj-1",
        provider: "linear",
        repo: "FL",
      })
    );
    expect(encodeScopeId({ provider: "github", repo: "acme/app" })).not.toBe(
      encodeScopeId({ provider: "linear", repo: "acme/app" })
    );
  });

  it("rejects a team-wide snapshot for a project-scoped watch", () => {
    expect(
      boardParamsMatch(
        { provider: "linear", repo: "FL" },
        { projectId: "proj-1", provider: "linear", repo: "FL" }
      )
    ).toBe(false);
    expect(
      boardParamsMatch(
        { projectId: "proj-1", provider: "linear", repo: "FL" },
        { projectId: "proj-1", provider: "linear", repo: "FL" }
      )
    ).toBe(true);
  });
});
