import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier dockview drag CSS", () => {
  it("keeps drop targets subtle over native terminal content", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(
      "--dv-drag-over-background-color: color-mix(in oklab, var(--primary) 10%, transparent)"
    );
    expect(css).toContain(
      "--dv-drag-over-border: 1px solid color-mix(in oklab, var(--primary) 55%, transparent)"
    );
    expect(css).toContain(
      ".dockview-theme-pier .dv-drop-target-container .dv-drop-target-anchor"
    );
    expect(css).toContain("box-shadow: inset 0 0 0 1px");
  });

  it("makes the dragged tab ghost compact and removes the default focus outline", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(".dockview-theme-pier .dv-tab.dv-tab-dragging");
    expect(css).toContain(
      ".dockview-theme-pier .dv-tab.dv-tab-dragging .dv-default-tab"
    );
    expect(css).toContain(".dv-tab.dv-tab-dragging .dv-default-tab");
    expect(css).toContain(".dv-tab-ghost-drag {");
    expect(css).toContain("border-radius: 999px !important");
    expect(css).toContain("height: 32px !important");
    expect(css).toContain("max-width: 220px");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("padding-inline: 10px 12px !important");
    expect(css).toContain("width: fit-content !important");
    expect(css).toContain(".dockview-theme-pier .dv-tab-ghost-drag::after");
    expect(css).toContain(".dv-tab-ghost-drag::after");
    expect(css).toContain("outline: none !important");
  });

  it("keeps dragged tab icon and text metrics aligned with normal tabs", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(".dv-tab.dv-tab-dragging .pier-panel-tab-icon");
    expect(css).toContain(".dv-tab-ghost-drag .pier-panel-tab-icon");
    expect(css).toContain("height: 14px !important");
    expect(css).toContain("width: 14px !important");
    expect(css).toContain(
      ".dv-tab.dv-tab-dragging .dv-default-tab .dv-default-tab-content"
    );
    expect(css).toContain(
      ".dv-tab-ghost-drag .dv-default-tab .dv-default-tab-content"
    );
    expect(css).toContain("font-weight: 600 !important");
  });
});
