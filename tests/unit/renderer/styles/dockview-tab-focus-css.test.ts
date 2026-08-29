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
    expect(css).toContain(".dv-tab .pier-tab-running-bar");
    expect(css).toContain("pier-tab-running-slider");
    expect(css).toContain("--pier-tab-running-accent");
    expect(css).toContain("--pier-tab-shimmer-trough");
    expect(css).toContain("--pier-tab-shimmer-highlight");
    expect(css).not.toContain("--pier-tab-shimmer-base");
    // slider：稳底 trough + 纯色块 background-image
    expect(css).toContain("background-color: var(--pier-tab-shimmer-trough)");
    expect(css).toContain("pier-tab-running-slider 1.5s infinite ease-in-out");
    // 禁止旧硬边 bounce / 「线下一轨」叠层（running 块内不得再 top:2/3 挂在选中线下）
    expect(css).not.toContain("pier-tab-running-bg");
    expect(css).not.toContain("pier-tab-running-bounce");
    expect(css).not.toContain("background-size: 25% 100%");
    const runningBarStart = css.indexOf(
      ".dockview-theme-pier .dv-tab .pier-tab-running-bar"
    );
    expect(runningBarStart).toBeGreaterThanOrEqual(0);
    const runningBarBlock = css.slice(runningBarStart, runningBarStart + 650);
    // S1 默认：细 1px + top:0 挨紧顶部；S2/S3 再抬到 2px
    expect(runningBarBlock).toContain("top: 0");
    expect(runningBarBlock).toContain("left: 0");
    expect(runningBarBlock).toContain("width: 100%");
    expect(runningBarBlock).toContain("height: 1px");
    expect(runningBarBlock).not.toContain("overflow: hidden");
    expect(runningBarBlock).not.toContain("height: 2px");
    expect(runningBarBlock).not.toContain("top: 1px");
    expect(runningBarBlock).not.toContain("top: 2px");
    expect(runningBarBlock).not.toContain("top: 3px");
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
    const s3RunningBarStart = css.indexOf(
      ':root:not([data-window-focused="false"])\n  .dockview-theme-pier\n  .dv-groupview.dv-active-group\n  > .dv-tabs-and-actions-container\n  .dv-tabs-container\n  > .dv-tab.dv-active-tab\n  .pier-tab-running-bar'
    );
    expect(s3RunningBarStart).toBeGreaterThanOrEqual(0);
    const s3RunningBarBlock = css.slice(
      s3RunningBarStart,
      s3RunningBarStart + 350
    );
    expect(s3RunningBarBlock).toContain("height: 2px");
    expect(css).not.toContain("pier-tab-running-bar--menu");
  });

  it("keeps dockview tab dividers off the running track slot", () => {
    expect(css).toContain("--dv-tab-divider-color: transparent");
    expect(css).not.toContain(
      '.dv-tab:not(:first-child):has([data-tab-status="running"])::before'
    );
    const reduceStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(reduceStart).toBeGreaterThanOrEqual(0);
    const reduceBlock = css.slice(reduceStart, reduceStart + 500);
    expect(reduceBlock).toContain(".dv-tab .pier-tab-running-bar");
    expect(reduceBlock).not.toContain(
      '.dv-tab:not(:first-child):has([data-tab-status="running"])::before'
    );
  });

  it("paints loomdesk-style short ticks as real nodes, not dockview ::before", () => {
    expect(css).toContain('[data-slot="panel-tab-separator"]');
    expect(css).toContain(".dv-tabs-container.dv-horizontal .dv-tab::before");
    const killStart = css.indexOf(
      ".dockview-theme-pier .dv-tabs-container.dv-horizontal .dv-tab::before"
    );
    expect(killStart).toBeGreaterThanOrEqual(0);
    expect(css.slice(killStart, killStart + 120)).toContain("content: none");

    const tickStart = css.indexOf(
      '.dockview-theme-pier [data-slot="panel-tab-separator"]'
    );
    expect(tickStart).toBeGreaterThanOrEqual(0);
    const tickBlock = css.slice(tickStart, tickStart + 420);
    expect(tickBlock).toContain("width: 1px");
    expect(tickBlock).toContain("height: 0.875rem");
    expect(tickBlock).toContain("top: 50%");
    expect(tickBlock).toContain("left: 0");
    expect(tickBlock).toContain("translateY(-50%)");
    expect(tickBlock).toContain("var(--foreground) 14%");
    expect(tickBlock).not.toContain("var(--foreground) 20%");
    expect(tickBlock).not.toContain("var(--foreground) 32%");
    expect(css).toContain(".dv-tab:not(.dv-tab ~ .dv-tab)");
    expect(css).toContain(
      '.dv-tab.dv-active-tab [data-slot="panel-tab-separator"]'
    );
    // Hover must not hide the tick (panel tabs have no Chrome raised shape).
    expect(css).not.toContain(
      '.dv-tab:hover [data-slot="panel-tab-separator"]'
    );
    expect(css).not.toContain(
      '.dv-tab:hover\n  + .dv-tab\n  [data-slot="panel-tab-separator"]'
    );
  });

  it("keeps 12/6 tab gutters, list-hover fill, and hover title foreground", () => {
    const tabPadStart = css.indexOf(".dockview-theme-pier .dv-tab {");
    expect(tabPadStart).toBeGreaterThanOrEqual(0);
    expect(css.slice(tabPadStart, tabPadStart + 80)).toContain("padding: 0");

    const innerStart = css.indexOf(
      ".dockview-theme-pier .dv-tab .dv-default-tab,"
    );
    expect(innerStart).toBeGreaterThanOrEqual(0);
    const innerBlock = css.slice(innerStart, innerStart + 900);
    expect(innerBlock).toContain("padding-inline: 12px 6px");
    expect(innerBlock).toContain("padding-left: 18px");
    expect(innerBlock).not.toContain("padding-left: 14px");
    expect(innerBlock).not.toContain("padding-inline: 6px 3px");
    expect(innerBlock).not.toContain("padding-inline: 8px 4px");

    const hoverStart = css.indexOf(
      ".dockview-theme-pier\n  .dv-groupview\n  > .dv-tabs-and-actions-container\n  .dv-tabs-container\n  > .dv-tab.dv-inactive-tab:hover"
    );
    expect(hoverStart).toBeGreaterThanOrEqual(0);
    const hoverBlock = css.slice(hoverStart, hoverStart + 720);
    expect(hoverBlock).toContain("background-color: var(--list-hover-bg)");
    expect(hoverBlock).toContain(".dv-default-tab-content");
    expect(hoverBlock).toContain("color: var(--foreground)");
    expect(hoverBlock).not.toContain("var(--background)");
    expect(css).not.toMatch(
      /^\.dockview-theme-pier \.dv-tab\.dv-inactive-tab:hover \{/m
    );
    expect(css).toContain("2026-08-29-panel-tab-chrome-gold-standard.md");
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
    expect(s2RunningBlock).toContain(".dv-tab.dv-active-tab");
    expect(s2RunningBlock).toContain(".pier-tab-running-bar");
    expect(s2RunningBlock).toContain("height: 2px");
  });

  it("keeps S1 running thinner than S2 and boosts inactive-tab contrast", () => {
    const runningHostStart = css.indexOf(
      "/* 凡 running：外层 tab 定位上下文 + S1 默认 accent / 材质 */"
    );
    const s1BoostStart = css.indexOf(
      "S1 未选中 running：1px 轨要用更实的 trough"
    );
    expect(runningHostStart).toBeGreaterThanOrEqual(0);
    expect(s1BoostStart).toBeGreaterThan(runningHostStart);
    // 1px 轨在 tab 盒内，不给凡 running 开 overflow:visible（会压过 dockview 拖拽裁切）
    expect(css.slice(runningHostStart, s1BoostStart)).not.toContain(
      "overflow: visible"
    );

    const s1HeightStart = css.indexOf(
      "默认 S1：细 1px + muted；稳底用 background-color"
    );
    const s2RunningStart = css.indexOf(
      "/*\n * — S2: 失焦 group 选中 / 窗口失焦降档 — 粗 2px + muted（默认色）。"
    );
    expect(s1HeightStart).toBeGreaterThanOrEqual(0);
    expect(s2RunningStart).toBeGreaterThan(s1HeightStart);
    const s1HeightBlock = css.slice(s1HeightStart, s2RunningStart);
    expect(s1HeightBlock).toContain("height: 1px");
    expect(s1HeightBlock).not.toContain("height: 2px");

    const darkS1Start = css.indexOf(
      '.dockview-theme-pier .dv-tab.dv-inactive-tab:has([data-tab-status="running"]) {'
    );
    const lightS1Start = css.indexOf(
      ':root.light\n  .dockview-theme-pier\n  .dv-tab.dv-inactive-tab:has([data-tab-status="running"]) {'
    );
    expect(darkS1Start).toBeGreaterThanOrEqual(0);
    expect(lightS1Start).toBeGreaterThan(darkS1Start);
    const darkS1Block = css.slice(darkS1Start, lightS1Start);
    expect(darkS1Block).toContain("var(--pier-tab-running-accent) 72%");
    expect(darkS1Block).toContain("var(--pier-tab-running-accent) 40%");

    const afterRunningStart = css.indexOf(
      "running 时关闭实心选中/补线 ::after"
    );
    expect(afterRunningStart).toBeGreaterThan(lightS1Start);
    const lightS1Block = css.slice(lightS1Start, afterRunningStart);
    expect(lightS1Block).toContain("var(--pier-tab-running-accent) 50%");
    expect(lightS1Block).not.toContain("var(--pier-tab-running-accent) 35%");
  });

  it("owns the vertical split separator on the lower tab strip, flush with header", () => {
    expect(css).not.toContain("--pier-tab-split-below-inset");
    expect(css).not.toContain("--pier-split-header-border");
    expect(css).not.toContain(":has(> .dv-sash-container > .dv-sash:hover)");

    const hideStart = css.indexOf(
      ".dockview-theme-pier\n  .dv-split-view-container.dv-separator-border\n  .dv-view:not(:first-child)::before"
    );
    expect(hideStart).toBeGreaterThanOrEqual(0);
    const hideEnd = css.indexOf(
      ".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash {",
      hideStart
    );
    expect(hideEnd).toBeGreaterThan(hideStart);
    expect(css.slice(hideStart, hideEnd)).toContain("display: none");

    const sashStart = css.indexOf(
      ".dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash::before"
    );
    const sashHoverStart = css.indexOf(
      ".dv-split-view-container.dv-vertical\n  > .dv-sash-container\n  > .dv-sash:hover::before"
    );
    expect(sashStart).toBeGreaterThanOrEqual(0);
    expect(sashHoverStart).toBeGreaterThan(sashStart);
    const sashIdleBlock = css.slice(sashStart, sashHoverStart);
    expect(sashIdleBlock).toContain("content: none");
    expect(sashIdleBlock).not.toContain("top: 2px");

    const idleLineStart = css.indexOf(
      ".dv-split-view-container.dv-vertical\n  > .dv-view-container\n  > .dv-view:not(:first-child)\n  .dv-groupview\n  > .dv-tabs-and-actions-container\n  .dv-tabs-container::after"
    );
    expect(idleLineStart).toBeGreaterThan(sashHoverStart);
    const idleLineEnd = css.indexOf(
      ":is(\n    .dv-void-container,",
      idleLineStart
    );
    expect(idleLineEnd).toBeGreaterThan(idleLineStart);
    const idleLineBlock = css.slice(idleLineStart, idleLineEnd);
    expect(idleLineBlock).toContain("top: 0");
    expect(idleLineBlock).toContain("z-index: 1");
    expect(idleLineBlock).toContain("height: 1px");
    expect(idleLineBlock).toContain("background-color: var(--border)");
    expect(idleLineBlock).not.toContain("border-top:");

    const actionsStart = css.indexOf(
      ":is(\n    .dv-void-container,\n    .dv-left-actions-container,\n    .dv-right-actions-container\n  )"
    );
    expect(actionsStart).toBeGreaterThan(idleLineStart);
    const actionsEnd = css.indexOf(
      '[data-dockview-maximized="true"]',
      actionsStart
    );
    expect(actionsEnd).toBeGreaterThan(actionsStart);
    expect(css.slice(actionsStart, actionsEnd)).toContain(
      "box-shadow: inset 0 1px 0 var(--border)"
    );

    const sashHoverEnd = css.indexOf(
      "/*\n * idle 分割线与 S1/S2 同层",
      sashHoverStart
    );
    expect(sashHoverEnd).toBeGreaterThan(sashHoverStart);
    const sashHoverBlock = css.slice(sashHoverStart, sashHoverEnd);
    expect(sashHoverBlock).toContain("top: 2px");
    expect(sashHoverBlock).toContain("height: 1.5px");
    expect(sashHoverBlock).not.toContain("height: 2px");
    expect(sashHoverBlock).toContain("background-color: var(--primary)");

    const horizontalIdleStart = css.indexOf(
      ".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash::before"
    );
    const horizontalHoverStart = css.indexOf(
      ".dv-split-view-container.dv-horizontal\n  > .dv-sash-container\n  > .dv-sash:hover::before"
    );
    expect(horizontalIdleStart).toBeGreaterThanOrEqual(0);
    expect(horizontalHoverStart).toBeGreaterThan(horizontalIdleStart);
    const horizontalIdleBlock = css.slice(
      horizontalIdleStart,
      horizontalHoverStart
    );
    const horizontalHoverBlock = css.slice(
      horizontalHoverStart,
      horizontalHoverStart + 160
    );
    expect(horizontalIdleBlock).toContain("width: 1px");
    expect(horizontalHoverBlock).toContain("width: 1.5px");
    expect(horizontalHoverBlock).not.toContain("width: 2px");
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
