import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SUBTLE_DROP_TARGET_BACKGROUND_RE =
  /--dv-drag-over-background-color:\s*color-mix\(\s*in oklab,\s*var\(--primary\) 10%,\s*transparent\s*\)/;
const SUBTLE_DROP_TARGET_BORDER_RE =
  /--dv-drag-over-border:\s*1px solid\s*color-mix\(in oklab, var\(--primary\) 55%, transparent\)/;

describe("Pier dockview drag CSS", () => {
  it("keeps drop targets subtle over native terminal content", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toMatch(SUBTLE_DROP_TARGET_BACKGROUND_RE);
    expect(css).toMatch(SUBTLE_DROP_TARGET_BORDER_RE);
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

  it("keeps tab shortcut hint metrics aligned with the normal icon slot", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(".dockview-theme-pier .pier-panel-tab-index-hint");
    expect(css).toContain(".dv-tab.dv-tab-dragging .pier-panel-tab-index-hint");
    expect(css).toContain(".dv-tab-ghost-drag .pier-panel-tab-index-hint");
    expect(css).toContain("height: 14px;");
    expect(css).toContain("min-width: 14px;");
  });
});
