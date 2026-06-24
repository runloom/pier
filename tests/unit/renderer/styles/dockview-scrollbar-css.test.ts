import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier dockview resize scrollbar CSS", () => {
  it("hides dockview web scrollbars during live resize", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(
      ".dockview-theme-pier .dv-scrollable.dv-scrollable-resizing .dv-scrollbar"
    );
    expect(css).toContain("opacity: 0");
    expect(css).toContain("pointer-events: none");
  });
});
