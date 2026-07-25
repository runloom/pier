import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(process.cwd(), "src/renderer/app/globals.css"),
  "utf8"
);

describe("Pier dockview tab focus CSS", () => {
  it("documents S1/S2/S3 including window focus", () => {
    expect(css).toContain("窗口失焦");
    expect(css).toContain("data-window-focused");
    expect(css).toContain("2px primary");
    expect(css).toContain("1px muted");
  });

  it("keeps S3 primary only for active-group while window is focused", () => {
    expect(css).toContain(".dv-groupview.dv-active-group");
    expect(css).toContain("background-color: var(--primary)");
  });

  it("uses 1px muted for inactive-group S2", () => {
    const s2Start = css.indexOf(
      "/* — S2 指示线: 失焦 group 选中 tab → 顶部 1px muted — */"
    );
    expect(s2Start).toBeGreaterThanOrEqual(0);
    const s2Block = css.slice(s2Start, s2Start + 450);
    expect(s2Block).toContain(".dv-groupview.dv-inactive-group");
    expect(s2Block).toContain("height: 1px");
    expect(s2Block).toContain("background-color: var(--muted-foreground)");
    expect(s2Block).not.toContain("height: 2px");
  });

  it("demotes active-group S3 to S2 when window is unfocused", () => {
    expect(css).toContain(':root[data-window-focused="false"]');
    const demoteStart = css.indexOf(':root[data-window-focused="false"]');
    expect(demoteStart).toBeGreaterThanOrEqual(0);
    const demoteBlock = css.slice(demoteStart, demoteStart + 400);
    expect(demoteBlock).toContain(".dv-groupview.dv-active-group");
    expect(demoteBlock).toContain(".dv-tab.dv-active-tab::after");
    expect(demoteBlock).toContain("height: 1px");
    expect(demoteBlock).toContain("background-color: var(--muted-foreground)");
  });
});
