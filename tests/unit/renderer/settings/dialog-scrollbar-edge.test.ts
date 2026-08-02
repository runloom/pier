import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings dialog scrollbar edge", () => {
  it("keeps the settings scroller flush to the dialog chrome edge", () => {
    const source = readFileSync(
      join(process.cwd(), "src/renderer/pages/settings/dialog.tsx"),
      "utf8"
    );

    // DialogContent drops right padding so the native scroller thumb can sit on
    // the rounded chrome edge; header/mobile nav keep inset for close + controls.
    expect(source).toContain("pr-0");
    expect(source).toContain("overflow-hidden");
    expect(source).toContain('DialogHeader className="pr-14"');
    expect(source).toContain("pr-6 md:hidden");
    expect(source).toContain('data-slot="settings-scroll"');
    expect(source).toContain('data-scrollbar="overlay"');
    expect(source).not.toContain('data-scrollbar="stable"');
    // Sticky project tabs share this scrollport — use bottom-only fade so the
    // top mask band does not sit on / under the tab chrome.
    expect(source).toContain('profile: "bottom-only"');
    expect(source).not.toContain("scroll-fade-y");
  });
});
