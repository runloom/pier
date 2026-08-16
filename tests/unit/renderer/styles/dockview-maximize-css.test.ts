import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier dockview maximize CSS", () => {
  it("hides split separators and sash hit areas while a group is maximized", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain('[data-dockview-maximized="true"]');
    expect(css).toContain(".dv-split-view-container.dv-separator-border");
    expect(css).toContain(".dv-sash-container > .dv-sash::before");
    expect(css).toContain("display: none !important");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain(
      '[data-dockview-maximized="true"]\n  .dockview-theme-pier\n  .dv-split-view-container.dv-vertical'
    );
    expect(css).toContain(
      "> .dv-tabs-and-actions-container\n  .dv-tabs-container::after {\n  content: none;"
    );
    expect(css).toContain(
      ".dv-right-actions-container\n  ) {\n  box-shadow: none;"
    );
  });
});
