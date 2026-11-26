import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Panel tab tooltip gap governance (2026-11-25).
 *
 * Product tooltip default is `TOOLTIP_SIDE_OFFSET_PX = 6` (`@pier/ui`). Radix
 * places the bubble at `sideOffset + arrow height`, so on the 34px tab strip
 * the default rendered the pill 13.5px below the strip's bottom edge with the
 * caret tip 8.5px clear of the tab — visibly detached. The tab strip is the
 * only surface allowed to tighten it, and only to the recorded value.
 */

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("panel tab tooltip gap governance", () => {
  it("keeps the product-wide default at 6px", () => {
    const tooltip = read("packages/ui/src/tooltip.tsx");
    expect(tooltip).toContain("export const TOOLTIP_SIDE_OFFSET_PX = 6;");
    expect(tooltip).toContain("sideOffset = TOOLTIP_SIDE_OFFSET_PX");
  });

  it("tightens the gap only for the tab strip, at the recorded value", () => {
    const helpers = read(
      "src/renderer/components/workspace/panel-tab-tooltip.tsx"
    );
    expect(helpers).toContain(
      "export const PANEL_TAB_TOOLTIP_SIDE_OFFSET_PX = 2;"
    );

    const header = read(
      "src/renderer/components/workspace/panel-tab-header.tsx"
    );
    expect(header).toContain("sideOffset={PANEL_TAB_TOOLTIP_SIDE_OFFSET_PX}");
    // No bare literal: the value must stay a single named source.
    expect(header).not.toContain("sideOffset={2}");
  });
});
