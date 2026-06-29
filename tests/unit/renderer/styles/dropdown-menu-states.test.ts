import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("DropdownMenu primitive states", () => {
  it("styles the Radix highlighted state used by pointer hover and keyboard navigation", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/ui/src/dropdown-menu.tsx"),
      "utf8"
    );

    expect(source).toContain("data-highlighted:bg-accent");
    expect(source).toContain("data-highlighted:text-accent-foreground");
  });
});
