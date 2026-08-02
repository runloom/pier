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

  it("paints running soft-shimmer on true top edge (not under selection)", () => {
    // 与选中线同盒同槽：外层 ::before top:1px，inset-inline:0 满宽
    expect(css).toContain('.dv-tab:has([data-tab-status="running"])::before');
    expect(css).toContain("pier-tab-running-shimmer");
    expect(css).toContain("--pier-tab-running-accent");
    expect(css).toContain("--pier-tab-shimmer-base");
    expect(css).toContain("--pier-tab-shimmer-highlight");
    expect(css).toContain("inset-inline: 0");
    // soft shimmer：300% 渐变 + 单向扫光（对齐状态栏 agent 扫光语汇）
    expect(css).toContain("background-size: 300% 100%");
    expect(css).toContain("pier-tab-running-shimmer 1.1s linear infinite");
    // 禁止旧硬边 bounce / 「线下一轨」叠层（running 块内不得再 top:2/3 挂在选中线下）
    expect(css).not.toContain("pier-tab-running-bg");
    expect(css).not.toContain("pier-tab-running-bounce");
    expect(css).not.toContain("background-size: 25% 100%");
    const runningBeforeStart = css.indexOf(
      '.dv-tab:has([data-tab-status="running"])::before'
    );
    expect(runningBeforeStart).toBeGreaterThanOrEqual(0);
    const runningBeforeBlock = css.slice(
      runningBeforeStart,
      runningBeforeStart + 500
    );
    expect(runningBeforeBlock).toContain("top: 1px");
    expect(runningBeforeBlock).not.toContain("top: 2px");
    expect(runningBeforeBlock).not.toContain("top: 3px");
    // running 时顶缘由 shimmer 独占：关闭实心选中 ::after
    expect(css).toMatch(
      /:has\(\[data-tab-status="running"\]\)::after[\s\S]*?display:\s*none/
    );
    // accent：S2/S1 muted / S3 primary（与选中铬同色，禁止 status-info 压暗）
    expect(css).toContain("--pier-tab-running-accent: var(--muted-foreground)");
    expect(css).toContain("--pier-tab-running-accent: var(--primary)");
    expect(css).not.toContain(
      "--pier-tab-running-accent: var(--status-info-fg)"
    );
    expect(css).toContain("var(--pier-tab-running-accent) 78%");
    expect(css).toContain("var(--foreground)");
    // S3 running 用 2px 顶缘对齐原选中权重
    expect(css).toContain(
      '> .dv-tab.dv-active-tab:has([data-tab-status="running"])::before'
    );
    expect(css).toContain("height: 2px");
    // 内层 DOM 条在 dockview 中裁成 a11y 锚点；菜单仍可见同款 shimmer
    expect(css).toContain("pier-tab-running-bar--menu");
    expect(css).toContain(
      ".dv-tab .pier-tab-running-bar:not(.pier-tab-running-bar--menu)"
    );
  });
});
