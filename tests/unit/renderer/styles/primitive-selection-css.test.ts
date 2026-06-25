import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier primitive selection CSS", () => {
  it("keeps command palette selected items aligned with accent selection states", () => {
    const commandSource = readFileSync(
      join(process.cwd(), "src/renderer/components/primitives/command.tsx"),
      "utf8"
    );

    expect(commandSource).toContain("data-selected:bg-accent");
    expect(commandSource).toContain("data-selected:text-accent-foreground");
    expect(commandSource).not.toContain("data-selected:bg-muted");
  });
});
