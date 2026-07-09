import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import {
  formatProjectPath,
  projectAnchor,
} from "../../../src/plugins/builtin/files/renderer/files-project-anchor.ts";

function ctx(
  partial: Partial<PanelContext> &
    Pick<PanelContext, "contextId" | "projectRootPath" | "updatedAt">
): PanelContext {
  return partial;
}

describe("projectAnchor", () => {
  it("returns null when context is missing", () => {
    expect(projectAnchor(undefined)).toBeNull();
  });

  it("prefers projectRootPath over worktree/git/cwd", () => {
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "/repo",
          updatedAt: 1,
          worktreeRoot: "/repo-wt",
          gitRoot: "/repo-git",
          cwd: "/repo/src",
        })
      )
    ).toBe("/repo");
  });

  it("falls back worktreeRoot → gitRoot → cwd when projectRootPath is empty", () => {
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          worktreeRoot: "/wt",
        })
      )
    ).toBe("/wt");
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          gitRoot: "/git",
        })
      )
    ).toBe("/git");
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          cwd: "/cwd",
        })
      )
    ).toBe("/cwd");
  });
});

describe("formatProjectPath", () => {
  it("returns absolute path when home is null", () => {
    expect(formatProjectPath("/Users/a/proj", null)).toBe("/Users/a/proj");
  });

  it("folds home to ~", () => {
    expect(formatProjectPath("/Users/a", "/Users/a")).toBe("~");
    expect(formatProjectPath("/Users/a/proj", "/Users/a")).toBe("~/proj");
  });

  it("strips trailing separators before compare", () => {
    expect(formatProjectPath("/Users/a/proj/", "/Users/a/")).toBe("~/proj");
  });
});
