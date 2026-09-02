import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("panel tear-off governance", () => {
  it("locks the gold-standard spec and owner modules", () => {
    const spec = readFileSync(
      join(
        ROOT,
        "docs/superpowers/specs/2026-09-01-panel-tear-off-gold-standard.md"
      ),
      "utf8"
    );
    expect(spec).toContain("面板撕窗金标准");
    expect(spec).toContain("不得弹回条上再变成新窗口");
    expect(spec).toContain("runtime-moved");
    expect(spec).toContain("data-pier-panel-transfer-in-transit");
    expect(spec).toContain("revealHost");
    expect(spec).toContain("isDragReleaseOutsideThisWindow");
    expect(spec).toContain("分类与 HTML5 `drop` 都必须忽略这些 window id");
    expect(spec).toContain("含正在销毁的预创建窗");

    const tearOff = readFileSync(
      join(ROOT, "src/renderer/components/workspace/transfer/tear-off.ts"),
      "utf8"
    );
    expect(tearOff).toContain("PANEL_TRANSFER_IN_TRANSIT_ATTR");
    expect(tearOff).toContain("holdForClaim");
    expect(tearOff).toContain(":has([data-panel-tab-id=");
    expect(tearOff).toContain("isDragReleaseOutsideThisWindow");

    const speculative = readFileSync(
      join(ROOT, "src/main/services/panel-transfer/speculative-window.ts"),
      "utf8"
    );
    expect(speculative).toContain("revealHost");
    expect(speculative).toContain("ensure(");
    expect(speculative).toContain("dyingIds");

    const dnd = readFileSync(
      join(ROOT, "src/renderer/components/workspace/transfer/dnd.ts"),
      "utf8"
    );
    expect(dnd).toContain("hidePanelTransferTearOff");
    expect(dnd).toContain("isDragReleaseOutsideThisWindow");

    const commit = readFileSync(
      join(ROOT, "src/main/services/panel-transfer/commit.ts"),
      "utf8"
    );
    const showAt = commit.indexOf("releaseRendererShow");
    const releaseAt = commit.indexOf("releaseSource failed");
    expect(showAt).toBeGreaterThan(0);
    expect(releaseAt).toBeGreaterThan(showAt);

    const css = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    expect(css).toContain(
      ".dockview-theme-pier .dv-tab[data-pier-panel-transfer-in-transit]"
    );
  });
});
