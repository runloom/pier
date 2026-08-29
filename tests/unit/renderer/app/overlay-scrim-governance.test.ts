import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const OVERLAY_SOURCES = [
  "packages/ui/src/dialog.tsx",
  "packages/ui/src/alert-dialog.tsx",
  "packages/ui/src/sheet.tsx",
  "packages/ui/src/drawer.tsx",
] as const;
const INSET_BELOW_TITLEBAR =
  "fixed top-[var(--app-titlebar-height)] right-0 bottom-0 left-0";

describe("overlay scrim titlebar coverage", () => {
  it.each(
    OVERLAY_SOURCES
  )("%s covers the full window with pointer-events split catchers", (rel) => {
    const source = readFileSync(join(ROOT, rel), "utf8");
    expect(source).toContain("fixed inset-0");
    expect(source).toContain("pointer-events-none");
    expect(source).toContain("<OverlayScrimCatchers");
    expect(source).not.toContain(INSET_BELOW_TITLEBAR);
  });

  it("keeps dismissable titlebar catchers out of Electron app-drag", () => {
    const source = readFileSync(
      join(ROOT, "packages/ui/src/dialog.tsx"),
      "utf8"
    );
    expect(source).toContain('data-slot="overlay-scrim-catcher"');
    expect(source).toMatch(
      /allowTitlebarDismiss \?\s*"app-no-drag"\s*:\s*"app-drag"/
    );
    expect(source).toContain(
      "left-[max(5.5rem,env(safe-area-inset-left,0px))]"
    );
    expect(source).toContain("h-[var(--app-titlebar-height)]");
  });
});
