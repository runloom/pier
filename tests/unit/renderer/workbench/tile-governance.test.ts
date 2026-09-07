import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md";
const CHROME = ".pier/canvases/workbench-shell/chrome.tsx";
const RAIL = ".pier/canvases/workbench-shell/rail.tsx";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("workbench worktree tiles design", () => {
  it("is documented in AGENTS.md and is the unique workbench-shell authority", () => {
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

  it("keeps worktree facts on the canvas tile status bar, not on tabs", () => {
    const chrome = read(CHROME);
    const tabStrip = chrome.slice(
      chrome.indexOf("export function TabStrip"),
      chrome.indexOf("export function TerminalView")
    );
    expect(tabStrip).not.toContain("Swatch");
    expect(tabStrip).not.toContain("worktree");
    expect(chrome).toContain("export function TileStatusBar");
    const tile = chrome.slice(
      chrome.indexOf("export function Tile("),
      chrome.indexOf("export function Window(")
    );
    expect(tile.indexOf("{props.children}")).toBeLessThan(
      tile.indexOf("<TileStatusBar")
    );
  });

  it("splits sidebar worktree switch from session locate on the canvas rail", () => {
    const rail = read(RAIL);
    expect(rail.includes("切换到")).toBe(true);
    expect(rail.includes("定位")).toBe(true);
    expect(rail).toContain("onLocateSession");
    expect(rail).toContain("onOpenDestination");
    expect(rail).toContain("SIDEBAR_DESTINATIONS");
    expect(rail).toContain("打开");
    expect(rail).not.toContain("onOpenEntry");
    expect(read(CHROME)).not.toContain("slice(0, 1)");
    expect(read(".pier/canvases/workbench-shell/brands.tsx")).toContain(
      "data-agent"
    );
  });
});
