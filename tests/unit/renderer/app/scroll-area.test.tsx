import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTO_HIDE_SCROLLBAR_IDLE_MS } from "@pier/ui/auto-hide-scrollbar.ts";
import {
  floatingMenuScrollViewportClassName,
  SCROLL_FADE_REVEAL,
  ScrollArea,
  scrollFadeClassName,
  scrollFadeUnsafeCss,
} from "@pier/ui/scroll-area.tsx";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("ScrollArea viewport behavior", () => {
  it("applies vertical scroll fade and viewport classes only to the viewport", () => {
    const { container } = render(
      <ScrollArea
        viewportClassName="overscroll-contain"
        viewportFade="vertical"
        viewportFadeProfile="short"
      >
        <div>Scrollable content</div>
      </ScrollArea>
    );

    const root = container.querySelector('[data-slot="scroll-area"]');
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );

    expect(root).not.toHaveClass("scroll-fade-y");
    expect(root).not.toHaveClass("overscroll-contain");
    expect(viewport).toHaveClass("scroll-fade-y");
    expect(viewport).toHaveClass("scroll-fade-t-2");
    expect(viewport).toHaveClass("scroll-fade-b-4");
    expect(viewport).toHaveClass("[--scroll-fade-reveal:24px]");
    expect(viewport).toHaveClass("overscroll-contain");
  });

  it("maps horizontal scroll fade to the viewport", () => {
    const { container } = render(
      <ScrollArea viewportFade="horizontal">
        <div>Wide content</div>
      </ScrollArea>
    );

    expect(
      container.querySelector('[data-slot="scroll-area-viewport"]')
    ).toHaveClass("scroll-fade-x");
  });

  it("defaults to scroll/auto-hide and keeps idle thumbs unmounted", () => {
    const { container } = render(
      <ScrollArea viewportFade="vertical">
        <div style={{ height: 2000 }}>Tall content</div>
      </ScrollArea>
    );

    expect(
      container.querySelector('[data-slot="scroll-area-scrollbar"]')
    ).toBeNull();
  });

  it("keeps the custom scrollbar outside the faded viewport and on Pier tokens", () => {
    const { container } = render(
      <ScrollArea type="always" viewportFade="vertical">
        <div>Scrollable content</div>
      </ScrollArea>
    );

    const root = container.querySelector('[data-slot="scroll-area"]');
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    const scrollbars = container.querySelectorAll(
      '[data-slot="scroll-area-scrollbar"]'
    );
    expect(scrollbars).toHaveLength(2);
    const vertical = [...scrollbars].find(
      (node) => node.getAttribute("data-orientation") === "vertical"
    );
    const horizontal = [...scrollbars].find(
      (node) => node.getAttribute("data-orientation") === "horizontal"
    );
    expect(vertical?.parentElement).toBe(root);
    expect(horizontal?.parentElement).toBe(root);
    expect(viewport?.contains(vertical ?? null)).toBe(false);
    expect(viewport?.contains(horizontal ?? null)).toBe(false);
    expect(vertical).toHaveClass(
      "data-vertical:w-(--shell-scrollbar-width-legacy)"
    );
    expect(horizontal).toHaveClass(
      "data-horizontal:h-(--shell-scrollbar-width-legacy)"
    );
    expect(vertical).toHaveClass("data-[state=visible]:opacity-100");
    expect(vertical).toHaveClass("opacity-0");
  });

  it("styles the Radix thumb with the shared Pier scrollbar token", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/ui/src/scroll-area.tsx"),
      "utf8"
    );

    expect(source).toContain("bg-(--shell-scrollbar-thumb)");
    expect(source).toContain('type = "scroll"');
    expect(source).toContain("scrollHideDelay = AUTO_HIDE_SCROLLBAR_IDLE_MS");
    expect(source).toContain("AUTO_HIDE_SCROLLBAR_IDLE_MS");
    expect(AUTO_HIDE_SCROLLBAR_IDLE_MS).toBe(900);
  });

  it("exports shared fade class helpers for native scroll owners", () => {
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "short" })
    ).toContain("scroll-fade-y");
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "short" })
    ).toContain("scroll-fade-t-2");
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "short" })
    ).toContain(`[--scroll-fade-reveal:${SCROLL_FADE_REVEAL}]`);
    expect(scrollFadeClassName({ fade: "horizontal" })).toContain(
      "scroll-fade-x"
    );
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "bottom-only" })
    ).toContain("scroll-fade-b");
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "bottom-only" })
    ).not.toContain("scroll-fade-y");
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "bottom-only" })
    ).not.toContain("scroll-fade-t-");
    // Profile alone must not emit size tokens without a fade axis.
    expect(scrollFadeClassName({ profile: "short" })).toBe("");
    expect(scrollFadeClassName({})).toBe("");
  });

  it("emits shadow/native unsafe CSS from the same fade profile tokens", () => {
    const shortY = scrollFadeUnsafeCss({
      selector: "[data-test-scroll]",
      fade: "vertical",
      profile: "short",
    });
    expect(shortY).toContain("[data-test-scroll]");
    expect(shortY).toContain("scroll-fade-reveal-t");
    expect(shortY).toContain("scroll-fade-reveal-b");
    expect(shortY).toContain("animation-timeline: scroll(self y)");
    expect(shortY).toContain(`--scroll-fade-reveal: ${SCROLL_FADE_REVEAL}`);
    expect(shortY).toContain("calc(var(--spacing, 0.25rem) * 2)");
    expect(shortY).toContain("calc(var(--spacing, 0.25rem) * 4)");

    const bottomOnly = scrollFadeUnsafeCss({
      selector: ".end-only",
      fade: "vertical",
      profile: "bottom-only",
    });
    expect(bottomOnly).toContain("scroll-fade-reveal-b");
    expect(bottomOnly).not.toContain("scroll-fade-reveal-t");
    expect(shortY).not.toContain("--shell-scrollbar-width-legacy");

    const spareY = scrollFadeUnsafeCss({
      selector: "[data-native-bar]",
      fade: "vertical",
      profile: "short",
      spareNativeScrollbar: "inline-end",
    });
    expect(spareY).toContain("var(--shell-scrollbar-gutter-mask)");
    expect(spareY).toContain("mask-composite: add");
    expect(spareY).not.toContain("mask-clip: content-box");
  });

  it("floating menu viewport owns short fade + inherit max height", () => {
    const withPad = floatingMenuScrollViewportClassName();
    expect(withPad).toContain("max-h-[inherit]");
    expect(withPad).toContain("overflow-y-auto");
    expect(withPad).toContain("scroll-fade-y");
    expect(withPad).toContain("p-1");
    expect(
      floatingMenuScrollViewportClassName({ padding: false })
    ).not.toContain("p-1");
  });
});

/**
 * 浮层菜单：外壳 bg-popover 与 scroll-fade 必须拆层。
 * 同节点 mask 会打穿实心底色，短下拉整板发虚（git 状态栏菜单回归）。
 */
describe("floating menu shell vs scroll-fade viewport", () => {
  const uiRoot = join(process.cwd(), "packages/ui/src");

  it.each([
    {
      file: "dropdown-menu.tsx",
      shellSlot: 'data-slot="dropdown-menu-content"',
      viewportSlot: 'data-slot="dropdown-menu-viewport"',
    },
    {
      file: "context-menu.tsx",
      shellSlot: 'data-slot="context-menu-content"',
      viewportSlot: 'data-slot="context-menu-viewport"',
    },
    {
      file: "select.tsx",
      shellSlot: 'data-slot="select-content"',
      viewportSlot: 'data-slot="select-viewport"',
    },
  ] as const)("$file keeps solid shell and faded viewport", ({
    file,
    shellSlot,
    viewportSlot,
  }) => {
    const source = readFileSync(join(uiRoot, file), "utf8");
    expect(source).toContain(shellSlot);
    expect(source).toContain(viewportSlot);
    expect(source).toContain("floatingMenuScrollViewportClassName");
    // 外壳仍声明 bg-popover；渐隐 helper 只服务内层，不与 shell 同节点。
    expect(source).toContain("bg-popover");
    // 禁止把 scrollFadeClassName 直接铺在 Content 外壳 className 上（回归 b98ff086）。
    expect(source).not.toMatch(
      /bg-popover[\s\S]{0,400}scrollFadeClassName\(\{\s*fade:\s*"vertical"/
    );
  });
});
