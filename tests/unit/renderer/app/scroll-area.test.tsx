import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScrollArea, scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
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
    const scrollbar = container.querySelector(
      '[data-slot="scroll-area-scrollbar"]'
    );
    expect(scrollbar?.parentElement).toBe(root);
    expect(viewport?.contains(scrollbar)).toBe(false);
    expect(scrollbar).toHaveClass(
      "data-vertical:w-(--shell-scrollbar-width-legacy)"
    );
  });

  it("styles the Radix thumb with the shared Pier scrollbar token", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/ui/src/scroll-area.tsx"),
      "utf8"
    );

    expect(source).toContain("bg-(--shell-scrollbar-thumb)");
  });

  it("exports shared fade class helpers for native scroll owners", () => {
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "short" })
    ).toContain("scroll-fade-y");
    expect(
      scrollFadeClassName({ fade: "vertical", profile: "short" })
    ).toContain("scroll-fade-t-2");
    expect(scrollFadeClassName({ fade: "horizontal" })).toContain(
      "scroll-fade-x"
    );
    // Profile alone must not emit size tokens without a fade axis.
    expect(scrollFadeClassName({ profile: "short" })).toBe("");
    expect(scrollFadeClassName({})).toBe("");
  });
});
