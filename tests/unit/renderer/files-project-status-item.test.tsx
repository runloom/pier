import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** 固定 max-w-40 / max-w-[…] 会在状态栏仍有空位时提前 ellipsis。 */
const FIXED_STATUS_MAX_WIDTH_RE = /max-w-(?:40|64|\[)/;

describe("files project status item width policy", () => {
  it("does not hard-cap project label width with max-w-40/64", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/files-project-status-item.tsx"
      ),
      "utf8"
    );
    expect(source).not.toMatch(FIXED_STATUS_MAX_WIDTH_RE);
    expect(source).toContain("min-w-0 truncate");
  });
});

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
