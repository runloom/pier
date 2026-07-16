import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";
import { isFilesProjectStatusVisible } from "../../../src/plugins/builtin/files/renderer/files-project-status-item.tsx";

function makeStatusContext(panelContext?: PanelContext) {
  return {
    context: panelContext,
    cwd: panelContext?.cwd ?? null,
    getGroupId: () => null,
    panelId: "terminal-1",
    title: "Terminal",
  };
}

describe("isFilesProjectStatusVisible", () => {
  it("returns false when context is undefined", () => {
    expect(isFilesProjectStatusVisible(makeStatusContext(undefined))).toBe(
      false
    );
  });

  it("returns false when context has no project root", () => {
    expect(
      isFilesProjectStatusVisible(
        makeStatusContext({
          contextId: "x",
          projectRootPath: "",
          updatedAt: 1,
        } as PanelContext)
      )
    ).toBe(false);
  });

  it("returns true when context has projectRootPath", () => {
    expect(
      isFilesProjectStatusVisible(
        makeStatusContext({
          contextId: "c",
          projectRootPath: "/repo",
          updatedAt: 1,
        } as PanelContext)
      )
    ).toBe(true);
  });

  it("returns true when context has worktreeRoot", () => {
    expect(
      isFilesProjectStatusVisible(
        makeStatusContext({
          contextId: "c",
          projectRootPath: "",
          worktreeRoot: "/wt",
          updatedAt: 1,
        } as PanelContext)
      )
    ).toBe(true);
  });
});
