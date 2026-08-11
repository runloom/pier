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

  it("tab strip scroll-fade comes from scrollFadeUnsafeCss (not a globals hand-copy)", () => {
    const globals = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    const fadeModule = readFileSync(
      join(
        process.cwd(),
        "src/renderer/components/workspace/tab-strip-scroll-fade.ts"
      ),
      "utf8"
    );
    const host = readFileSync(
      join(process.cwd(), "src/renderer/components/workspace/host.tsx"),
      "utf8"
    );

    // No dual-source hand-rolled mask in globals.
    expect(globals).toContain("tab-strip-scroll-fade.ts");
    expect(globals).not.toContain(
      ".dockview-theme-pier .dv-tabs-container {\n  --scroll-fade-s-size"
    );

    // Single source: @pier/ui scrollFadeUnsafeCss + dockview selector.
    expect(fadeModule).toContain('from "@pier/ui/scroll-area.tsx"');
    expect(fadeModule).toContain("scrollFadeUnsafeCss");
    expect(fadeModule).toContain('fade: "horizontal"');
    expect(fadeModule).toContain('profile: "short"');
    expect(fadeModule).toContain(".dockview-theme-pier .dv-tabs-container");
    expect(host).toContain("installTabStripScrollFadeStyles");
  });
});

describe("Pier scrollbar architecture", () => {
  it("styles every light-DOM scroller globally and only hides via data-scrollbar=none", () => {
    const globals = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    const system = readFileSync(
      join(process.cwd(), "packages/ui/src/scrollbar-system.ts"),
      "utf8"
    );
    const boot = readFileSync(
      join(process.cwd(), "src/renderer/main.tsx"),
      "utf8"
    );
    const autoHide = readFileSync(
      join(process.cwd(), "packages/ui/src/auto-hide-scrollbar.ts"),
      "utf8"
    );
    const cmTheme = readFileSync(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/editor/cm-theme.ts"
      ),
      "utf8"
    );

    // light DOM：标准 scrollbar-* 自动隐藏；唯一 opt-out 是 none
    expect(globals).toContain("--shell-scrollbar-width-legacy:");
    expect(globals).toContain("scrollbar-color: transparent transparent");
    expect(globals).toContain("scrollbar-width: var(--shell-scrollbar-width)");
    expect(globals).toContain('[data-scrollbar="none"]');
    expect(globals).not.toContain(".cm-scroller::-webkit-scrollbar");
    expect(globals).not.toContain(".cv-scrollbar::-webkit-scrollbar");

    // Shadow：同一策略（transparent idle → token on activity）
    expect(system).toContain("export const SCROLLBAR_SYSTEM_CSS");
    expect(system).toContain("var(--shell-scrollbar-width-legacy)");
    expect(system).toContain("scrollbar-color: transparent transparent");
    expect(system).toContain(
      '[data-file-tree-virtualized-scroll="true"][data-scrollbar-scrolling="true"]'
    );
    expect(system).not.toContain("installScrollbarSystem");
    expect(system).not.toContain("data-pier-scrollbar-system");

    expect(boot).not.toContain("installScrollbarSystem");
    expect(boot).toContain("installDocumentAutoHideScrollbars");
    expect(autoHide).toContain("isAutoHideScrollContainer");
    expect(autoHide).toContain('[data-scrollbar="none"]');

    expect(cmTheme).not.toContain("::-webkit-scrollbar");
  });

  it("keeps thumbs hidden at idle and never reveals them from container hover", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    const system = readFileSync(
      join(process.cwd(), "packages/ui/src/scrollbar-system.ts"),
      "utf8"
    );
    const scrollArea = readFileSync(
      join(process.cwd(), "packages/ui/src/scroll-area.tsx"),
      "utf8"
    );
    const command = readFileSync(
      join(process.cwd(), "packages/ui/src/command.tsx"),
      "utf8"
    );
    const sidebar = readFileSync(
      join(process.cwd(), "src/renderer/components/primitives/sidebar.tsx"),
      "utf8"
    );

    expect(css).toContain('data-scrollbar-scrolling="true"');
    expect(css).toContain('data-scrollbar-hovering="true"');
    expect(css).toContain("scrollbar-color: transparent transparent");
    expect(css).not.toContain("):hover::-webkit-scrollbar-thumb");
    expect(css).not.toContain("::-webkit-scrollbar-thumb:hover");
    // Idle must not paint a permanent colored thumb via scrollbar-color.
    expect(css).not.toMatch(
      /^\s*\*\s*\{[^}]*scrollbar-color:\s*var\(--shell-scrollbar-thumb\)/m
    );

    // Keep thin width so layout matches pre-auto-hide Chromium gutters.
    expect(css).toContain("scrollbar-width: var(--shell-scrollbar-width)");
    expect(system).toContain("scrollbar-color: transparent transparent");
    expect(system).toContain(
      "scrollbar-width: var(--shell-scrollbar-width, thin)"
    );

    // Webkit custom thumbs are fallback-only (no scrollbar-color support).
    expect(css).toContain("@supports not (scrollbar-color: auto)");
    expect(system).toContain("@supports not (scrollbar-color: auto)");

    // Radix ScrollArea must match native/terminal: scroll reveal + idle hide,
    // not default whole-container hover thumbs.
    expect(scrollArea).toContain('type = "scroll"');
    expect(scrollArea).toContain(
      "scrollHideDelay = AUTO_HIDE_SCROLLBAR_IDLE_MS"
    );
    expect(scrollArea).not.toContain('type = "hover"');
    expect(scrollArea).toContain('orientation="horizontal"');

    // Hide chrome only via data-scrollbar="none" — no dead no-scrollbar class.
    expect(command).not.toContain("no-scrollbar");
    expect(sidebar).not.toContain("no-scrollbar");
    expect(sidebar).toContain('data-scrollbar="none"');
  });
});
