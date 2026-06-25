import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pier sidebar accent CSS", () => {
  it("uses the shared accent token for sidebar selected states", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain("--sidebar-accent: var(--accent);");
    expect(css).toContain(
      "--sidebar-accent-foreground: var(--accent-foreground);"
    );
  });
});
