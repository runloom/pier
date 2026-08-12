import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("tabs list overflow governance", () => {
  it("pins horizontal pill track overflow-y so overflow-x-auto cannot invent a y scrollbar", () => {
    const source = readFileSync(join(ROOT, "packages/ui/src/tabs.tsx"), "utf8");
    // CSS overflow-axis pairing: one axis non-visible forces the other to auto.
    // Default (pill) list must pin y; line variant must not (active underline
    // sits at bottom-[-5px] outside the box).
    expect(source).toContain('default: "overflow-y-hidden bg-muted"');
    expect(source).toContain("group-data-vertical/tabs:overflow-y-auto");
    // Line variant must not inherit overflow-y-hidden (would clip underline).
    expect(source).toMatch(/line:\s*"gap-4 bg-transparent"/);
  });
});
