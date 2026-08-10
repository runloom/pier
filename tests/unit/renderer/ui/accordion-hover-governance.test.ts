// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Multi-line Accordion triggers (command name + description) must not use
 * hover:underline — full-row underline is unreadable in docs canvases.
 */
describe("AccordionTrigger hover governance", () => {
  it("does not apply hover:underline on the default trigger", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/ui/src/accordion.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/hover:underline/);
    expect(source).toMatch(/hover:bg-muted\/50/);
  });
});
