import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md";
const WITHDRAWN_CANVAS = ".pier/canvases/workbench-shell";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("workbench worktree tiles design", () => {
  it("is documented in AGENTS.md as the unique workbench-tile authority", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### 工作台骨架：工作树 tile 与主 / 子窗口");
    expect(agents).toContain(
      "tests/unit/renderer/workbench/tile-governance.test.ts"
    );
    expect(spec).toContain("锚 tile");
    expect(spec).toContain("隐藏集");
    expect(spec).toContain("tile 状态栏");
    expect(spec).toContain("侧栏**工作树**行点击");
    expect(spec).toContain("含隐藏集");
    expect(spec).toContain("欢迎态的 `~` 区域不进侧栏");
    expect(spec).toContain("工作区级插件目的地");
    expect(spec).toContain("sidebarEntries");
    expect(spec).toContain("「任务」只有一条");
  });

  it("does not treat a workbench-shell canvas as visual authority", () => {
    expect(existsSync(join(ROOT, WITHDRAWN_CANVAS))).toBe(false);
    expect(read("AGENTS.md")).not.toContain(WITHDRAWN_CANVAS);
    expect(read(SPEC)).not.toContain(WITHDRAWN_CANVAS);
    expect(read(".pier/canvases/README.md")).not.toContain("workbench-shell");
  });

  it("keeps worktree facts on the tile status bar, not on tabs", () => {
    const spec = read(SPEC);
    expect(spec).toContain("tile 底部的一条状态栏");
    expect(spec).toContain("tab 上不重复工作树标识");
    expect(spec).toContain("每终端状态栏与窗口级状态行都不存在");
    expect(spec).toContain("tile 状态栏（tile **底部**一行，28px）");
  });

  it("splits sidebar worktree switch from session locate", () => {
    const spec = read(SPEC);
    expect(spec).toContain("侧栏**工作树**行点击");
    expect(spec).toContain("侧栏**会话**行点击");
    expect(spec).toContain("品牌图标");
    expect(spec).toContain("工作区级插件目的地");
    expect(spec).toContain("「任务」只有一条");
  });
});
