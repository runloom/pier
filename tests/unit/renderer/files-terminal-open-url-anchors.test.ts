import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import {
  longestCoveringAnchor,
  terminalOpenUrlAnchors,
} from "../../../src/plugins/builtin/files/renderer/files-terminal-open-url-anchors.ts";

function ctx(partial: Partial<PanelContext>): PanelContext {
  return {
    contextId: "c",
    projectRootPath: "",
    updatedAt: 1,
    ...partial,
  };
}

describe("terminalOpenUrlAnchors", () => {
  it("collects non-empty anchors", () => {
    expect(
      terminalOpenUrlAnchors(
        ctx({
          cwd: "/repo/src",
          gitRoot: "/repo",
          openedPath: "/repo/README.md",
          projectRootPath: "/repo",
          worktreeRoot: "/repo-wt",
        })
      )
    ).toEqual(["/repo", "/repo-wt", "/repo", "/repo/src", "/repo/README.md"]);
  });
});

describe("longestCoveringAnchor", () => {
  it("picks the longest covering prefix", () => {
    expect(
      longestCoveringAnchor("/repo-wt/src/a.md", [
        "/repo",
        "/repo-wt",
        "/repo-wt/src",
      ])
    ).toBe("/repo-wt/src");
  });

  it("returns null when outside all anchors", () => {
    expect(longestCoveringAnchor("/other/a.md", ["/repo"])).toBeNull();
  });
});
