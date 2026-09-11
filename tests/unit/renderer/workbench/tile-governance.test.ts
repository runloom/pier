import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md";
const SHELL_CANVAS = ".pier/canvases/workbench-shell";

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
    const spec = read(SPEC);
    const agents = read("AGENTS.md");
    expect(spec).toContain(SHELL_CANVAS);
    expect(spec).toContain("不得当治理对照物");
    expect(agents).toContain(`${SHELL_CANVAS}/`);
    expect(read(".pier/canvases/README.md")).not.toContain("workbench-shell");
    expect(existsSync(join(ROOT, SHELL_CANVAS))).toBe(false);
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

  it("locks sidebar visual vocabulary in spec §5.3", () => {
    const spec = read(SPEC);
    const agents = read("AGENTS.md");
    expect(spec).toContain("### 5.3 侧栏视觉词汇（L0 行形）");
    expect(spec).toContain("任务在项目树之下");
    expect(spec).toContain("分支名、`↑↓`");
    expect(spec).toContain("**不得出现**");
    expect(spec).toContain("本机目录");
    expect(spec).toContain("**分组标题**");
    expect(spec).toContain("普通终端用终端图标");
    expect(spec).toContain("欢迎态 `~` 不进侧栏");
    expect(spec).toContain("所有可点单行 **28px**");
    expect(spec).toContain("项目 < 工作树 < 会话");
    expect(spec).toContain("无身份色块、无仓库/文件夹图标");
    expect(spec).toContain("B1 主窗口");
    expect(agents).toContain("分支名不进侧栏");
    expect(agents).toContain("§5.3");
  });
});
