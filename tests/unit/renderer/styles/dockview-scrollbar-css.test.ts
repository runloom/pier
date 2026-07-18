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
        "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
      ),
      "utf8"
    );

    // light DOM：全局 * 一套；唯一 opt-out 是 none；拇指 inset 变细
    expect(globals).toContain("--shell-scrollbar-width-legacy:");
    expect(globals).toContain("*::-webkit-scrollbar");
    expect(globals).toContain("background-clip: content-box");
    expect(globals).toContain("border: 1px solid transparent");
    expect(globals).toContain('[data-scrollbar="none"]');
    expect(globals).not.toContain(".cm-scroller::-webkit-scrollbar");
    expect(globals).not.toContain(".cv-scrollbar::-webkit-scrollbar");

    // Shadow：同一 token / 同一 inset 拇指
    expect(system).toContain("export const SCROLLBAR_SYSTEM_CSS");
    expect(system).toContain("var(--shell-scrollbar-width-legacy)");
    expect(system).toContain("[data-code]::-webkit-scrollbar");
    expect(system).toContain("background-clip: content-box");
    expect(system).toContain(
      '[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar'
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

    expect(css).toContain('data-scrollbar-scrolling="true"');
    expect(css).toContain('data-scrollbar-hovering="true"');
    expect(css).toContain("background: transparent");
    expect(css).not.toContain("):hover::-webkit-scrollbar-thumb");
    expect(css).not.toContain("::-webkit-scrollbar-thumb:hover");
  });
});
