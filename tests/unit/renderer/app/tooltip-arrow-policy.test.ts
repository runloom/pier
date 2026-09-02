import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("tooltip arrow policy", () => {
  it("keeps caret visibility in host CSS only", () => {
    const css = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    expect(css).toContain("Tooltip caret policy — single owner");
    expect(css).toContain('[data-slot="tooltip-content"][data-side="top"]');
    expect(css).toContain('[data-slot="tooltip-content"][data-side="bottom"]');
    expect(css).toContain('[data-slot="tooltip-content"][data-side="left"]');
    expect(css).toContain('[data-slot="tooltip-content"][data-side="right"]');
    expect(css).toContain('> span:has([data-slot="tooltip-arrow"])');
    const policy = css.slice(
      css.indexOf("Tooltip caret policy"),
      css.indexOf("Pier UI globals.css")
    );
    expect(policy).toContain("visibility: visible !important");
    expect(policy).toContain("visibility: hidden !important");
    expect(policy).not.toContain("display: none");
  });

  it("does not re-implement caret visibility in the primitive", () => {
    const source = readFileSync(
      join(ROOT, "packages/ui/src/tooltip.tsx"),
      "utf8"
    );
    expect(source).toContain("TOOLTIP_ARROW_CLASS");
    expect(source).toContain("TOOLTIP_ARROW_HEIGHT_PX");
    expect(source).toContain("TOOLTIP_ARROW_OVERLAP_PX");
    expect(source).toContain("fill-foreground");
    expect(source).toContain("-translate-y-px");
    expect(source).toContain("Visibility is CSS-only");
    expect(source).not.toContain("rotate-45");
    expect(source).not.toContain("TOOLTIP_ARROW_LAYOUT_CLASS");
    expect(source).not.toContain("applyTooltipArrowPolicy");
    expect(source).not.toContain("MutationObserver");
    expect(source).not.toContain("TOOLTIP_ARROW_VERTICAL_VISIBLE_CLASS");
    expect(source).not.toContain('const showArrow = side === "top"');
  });

  it("keeps caret padding clear of rounded-xl", () => {
    const theme = readFileSync(
      join(ROOT, "packages/ui/src/tailwind-theme.css"),
      "utf8"
    );
    const globals = readFileSync(
      join(ROOT, "src/renderer/app/globals.css"),
      "utf8"
    );
    const source = readFileSync(
      join(ROOT, "packages/ui/src/tooltip.tsx"),
      "utf8"
    );
    expect(globals).toContain("--radius: 0.625rem");
    expect(theme).toContain("--radius-xl: calc(var(--radius) + 6px)");
    expect(source).toContain("rounded-xl");
    expect(source).toContain("TOOLTIP_CONTENT_RADIUS_PX = 16");
    expect(source).toContain("TOOLTIP_ARROW_OVERLAP_PX = 1");
    expect(source).toContain("TOOLTIP_ARROW_WIDTH_PX = 12");
    expect(source).toContain("TOOLTIP_ARROW_HEIGHT_PX = 6");
  });
});
