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
    expect(source).toContain("TOOLTIP_ARROW_LAYOUT_HEIGHT_PX");
    expect(source).toContain("rotate-45");
    expect(source).toContain("Visibility is CSS-only");
    expect(source).not.toContain("applyTooltipArrowPolicy");
    expect(source).not.toContain("MutationObserver");
    expect(source).not.toContain("TOOLTIP_ARROW_VERTICAL_VISIBLE_CLASS");
    expect(source).not.toContain('const showArrow = side === "top"');
  });
});
