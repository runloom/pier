import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import {
  diskTargetPartsForAbsolute,
  longestCoveringAnchor,
  terminalOpenUrlAnchors,
  withTerminalOpenAnchor,
} from "../../../src/shared/terminal-open-disk-target.ts";

function ctx(partial: Partial<PanelContext> = {}): PanelContext {
  return {
    contextId: "c",
    projectRootPath: "/repo",
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

describe("diskTargetPartsForAbsolute", () => {
  it("uses longest project anchor as root", () => {
    expect(
      diskTargetPartsForAbsolute(
        "/repo/docs/a.md",
        ctx({ cwd: "/repo", projectRootPath: "/repo" })
      )
    ).toEqual({
      absolutePath: "/repo/docs/a.md",
      relativePath: "docs/a.md",
      root: "/repo",
    });
  });

  it("falls back to parent/leaf outside anchors", () => {
    expect(diskTargetPartsForAbsolute("/tmp/outside.md", ctx())).toEqual({
      absolutePath: "/tmp/outside.md",
      relativePath: "outside.md",
      root: "/tmp",
    });
  });
});

describe("withTerminalOpenAnchor", () => {
  it("sets projectRootPath to the disk root", () => {
    expect(
      withTerminalOpenAnchor(ctx({ projectRootPath: "/repo" }), "/repo/docs")
    ).toMatchObject({ projectRootPath: "/repo/docs" });
  });
});
