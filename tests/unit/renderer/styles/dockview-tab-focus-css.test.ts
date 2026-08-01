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
    const demoteStart = css.indexOf(
      "/* — 窗口失焦: active-group 也降为 S2 (dockview 不会因 OS blur 翻 inactive-group) — */"
    );
    expect(demoteStart).toBeGreaterThanOrEqual(0);
    const demoteBlock = css.slice(demoteStart, demoteStart + 450);
    expect(demoteBlock).toContain(':root[data-window-focused="false"]');
    expect(demoteBlock).toContain(".dv-groupview.dv-active-group");
    expect(demoteBlock).toContain(".dv-tab.dv-active-tab::after");
    expect(demoteBlock).toContain("height: 1px");
    expect(demoteBlock).toContain("background-color: var(--muted-foreground)");
  });

  it("paints running track on outer .dv-tab::before full-bleed below selection", () => {
    // 与选中线同盒：外层 ::before，inset-inline:0 → 100% 宽贴边
    expect(css).toContain('.dv-tab:has([data-tab-status="running"])::before');
    expect(css).toContain("pier-tab-running-bg");
    expect(css).toContain("--pier-tab-running-accent");
    expect(css).toContain("inset-inline: 0");
    // 硬边定宽 25% 位移
    expect(css).toContain("background-size: 25% 100%");
    expect(css).toContain("1.15s cubic-bezier(0.45, 0.05, 0.55, 0.95)");
    // 选中线不因 running 关掉
    expect(css).not.toMatch(
      /active-tab:has\(\[data-tab-status="running"\]\)::after\s*\{[^}]*display:\s*none/s
    );
    // S1 浅顶边
    expect(css).toContain(
      '.dv-tab.dv-inactive-tab:has([data-tab-status="running"])::after'
    );
    // accent：S2 muted / S3 primary
    expect(css).toContain("--pier-tab-running-accent: var(--muted-foreground)");
    expect(css).toContain("--pier-tab-running-accent: var(--primary)");
    expect(css).toContain("var(--pier-tab-running-accent) 20%");
    expect(css).toContain("var(--pier-tab-running-accent) 80%");
    // 内层 DOM 条在 dockview 中裁成 a11y 锚点；菜单仍可见
    expect(css).toContain("pier-tab-running-bar--menu");
    expect(css).toContain(
      ".dv-tab .pier-tab-running-bar:not(.pier-tab-running-bar--menu)"
    );
  });
});
