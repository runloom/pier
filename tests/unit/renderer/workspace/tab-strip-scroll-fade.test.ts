import { scrollFadeUnsafeCss } from "@pier/ui/scroll-area.tsx";
import { afterEach, describe, expect, it } from "vitest";
import {
  installTabStripScrollFadeStyles,
  TAB_STRIP_SCROLL_FADE_CSS,
  TAB_STRIP_SCROLL_FADE_SELECTOR,
  TAB_STRIP_SCROLL_FADE_STYLE_ID,
} from "@/components/workspace/tab-strip-scroll-fade.ts";

describe("tab strip scroll-fade install", () => {
  afterEach(() => {
    // Drain any leaked refcounts from failed assertions.
    for (let i = 0; i < 8; i += 1) {
      document.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)?.remove();
    }
  });

  it("matches the shared horizontal short fade recipe", () => {
    const shared = scrollFadeUnsafeCss({
      fade: "horizontal",
      profile: "short",
      selector: TAB_STRIP_SCROLL_FADE_SELECTOR,
    });
    expect(TAB_STRIP_SCROLL_FADE_CSS).toBe(shared);
    expect(TAB_STRIP_SCROLL_FADE_CSS).toContain("scroll-fade-reveal-s");
    expect(TAB_STRIP_SCROLL_FADE_CSS).toContain("scroll(self inline)");
  });

  it("ref-counts installs so overlapping disposers do not tear down early", () => {
    const dispose1 = installTabStripScrollFadeStyles(document);
    const dispose2 = installTabStripScrollFadeStyles(document);
    expect(
      document.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)
    ).not.toBeNull();
    expect(
      document.querySelectorAll(`#${TAB_STRIP_SCROLL_FADE_STYLE_ID}`).length
    ).toBe(1);

    dispose2();
    expect(
      document.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)
    ).not.toBeNull();

    dispose1();
    expect(document.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)).toBeNull();
  });

  it("dispose is idempotent", () => {
    const dispose = installTabStripScrollFadeStyles(document);
    dispose();
    dispose();
    expect(document.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)).toBeNull();
  });
});
