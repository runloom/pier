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
    expect(css).toContain("2px muted");
    expect(css).toContain("1px muted");
  });

  it("keeps S3 primary only for active-group while window is focused", () => {
    expect(css).toContain(".dv-groupview.dv-active-group");
    expect(css).toContain("background-color: var(--primary)");
  });

  it("uses 2px muted for inactive-group S2 (thick + default color)", () => {
    const s2Start = css.indexOf(
      "/* — S2 指示线: 失焦 group 选中 tab → 顶缘 2px muted（粗+默认色） — */"
    );
    expect(s2Start).toBeGreaterThanOrEqual(0);
    const s2Block = css.slice(s2Start, s2Start + 450);
    expect(s2Block).toContain(".dv-groupview.dv-inactive-group");
    expect(s2Block).toContain("top: 0");
    expect(s2Block).toContain("height: 2px");
    expect(s2Block).toContain("background-color: var(--muted-foreground)");
  });

  it("demotes active-group S3 to S2 when window is unfocused", () => {
    const demoteStart = css.indexOf(
      "/* — 窗口失焦: active-group 也降为 S2（仅改色；高度仍 2px 由 S3 基线继承） — */"
    );
    expect(demoteStart).toBeGreaterThanOrEqual(0);
    const demoteBlock = css.slice(demoteStart, demoteStart + 450);
    expect(demoteBlock).toContain(':root[data-window-focused="false"]');
    expect(demoteBlock).toContain(".dv-groupview.dv-active-group");
    expect(demoteBlock).toContain(".dv-tab.dv-active-tab::after");
    // 降档只改色（primary → muted）；高度沿用 S3 的 2px，块内不再重复 height
    expect(demoteBlock).toContain("background-color: var(--muted-foreground)");
    expect(demoteBlock).not.toContain("height:");
  });

  it("paints running solid slider flush to top edge (not under selection)", () => {
    // 与选中线同盒同槽：外层 ::before top:0 挨紧顶部，inset-inline:0 满宽
    expect(css).toContain('.dv-tab:has([data-tab-status="running"])::before');
    expect(css).toContain("pier-tab-running-slider");
    expect(css).toContain("--pier-tab-running-accent");
    expect(css).toContain("--pier-tab-shimmer-trough");
    expect(css).toContain("--pier-tab-shimmer-highlight");
    expect(css).not.toContain("--pier-tab-shimmer-base");
    expect(css).toContain("inset-inline: 0");
    // slider：稳底 trough + 纯色块 background-image
    expect(css).toContain("background-color: var(--pier-tab-shimmer-trough)");
    expect(css).toContain("pier-tab-running-slider 1.5s infinite ease-in-out");
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
    // S1 默认：细 1px + top:0 挨紧顶部
    expect(runningBeforeBlock).toContain("top: 0");
    expect(runningBeforeBlock).toContain("height: 1px");
    expect(runningBeforeBlock).not.toContain("top: 1px");
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
    // S3 running：2px 粗轨 + primary 路径（:root:not window-focused false）
    const s3RunningBeforeStart = css.indexOf(
      ':root:not([data-window-focused="false"])\n  .dockview-theme-pier\n  .dv-groupview.dv-active-group\n  > .dv-tabs-and-actions-container\n  .dv-tabs-container\n  > .dv-tab.dv-active-tab:has([data-tab-status="running"])::before'
    );
    expect(s3RunningBeforeStart).toBeGreaterThanOrEqual(0);
    const s3RunningBeforeBlock = css.slice(
      s3RunningBeforeStart,
      s3RunningBeforeStart + 350
    );
    expect(s3RunningBeforeBlock).toContain("height: 2px");
    // 内层 DOM 条在 dockview 中裁成 a11y 锚点；overflow 菜单不再复用顶轨 shimmer
    expect(css).not.toContain("pier-tab-running-bar--menu");
    expect(css).toContain(".dv-tab .pier-tab-running-bar");
  });

  it("locks S2 running track at 2px for inactive-group and window-blur", () => {
    // 切片止于 S3 注释之前，避免 S3 的 height:2px 误满足断言。
    const s2RunningHeightStart = css.indexOf(
      "/*\n * — S2: 失焦 group 选中 / 窗口失焦降档 — 粗 2px + muted（默认色）。"
    );
    const s3RunningStart = css.indexOf(
      "/*\n * — S3: 真聚焦 — accent = primary"
    );
    expect(s2RunningHeightStart).toBeGreaterThanOrEqual(0);
    expect(s3RunningStart).toBeGreaterThan(s2RunningHeightStart);
    const s2RunningBlock = css.slice(s2RunningHeightStart, s3RunningStart);
    expect(s2RunningBlock).toContain(".dv-groupview.dv-inactive-group");
    expect(s2RunningBlock).toContain(':root[data-window-focused="false"]');
    expect(s2RunningBlock).toContain(
      '.dv-tab.dv-active-tab:has([data-tab-status="running"])::before'
    );
    expect(s2RunningBlock).toContain("height: 2px");
  });

  it("tunes running shimmer for light chrome (clean progress bar style)", () => {
    expect(css).toContain(
      ':root.light .dockview-theme-pier .dv-tab:has([data-tab-status="running"])'
    );
    // 亮色：加深轨道 (35%) + 纯色高光，经典进度条语汇，干净清晰
    expect(css).toContain("var(--pier-tab-running-accent) 35%");
    expect(css).toContain(
      "--pier-tab-shimmer-highlight: var(--pier-tab-running-accent)"
    );
    expect(css).toContain(':root.light:not([data-window-focused="false"])');
    const lightS3GlowStart = css.indexOf(
      "亮色 S3：浅色高光 glow 在浅底上几乎不可读且易发雾"
    );
    expect(lightS3GlowStart).toBeGreaterThanOrEqual(0);
    expect(css.slice(lightS3GlowStart, lightS3GlowStart + 500)).toContain(
      "box-shadow: none"
    );
  });
});
