// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("canvas Tailwind @source governance", () => {
  it("includes .pier/canvases so canvas className utilities enter the CSS bundle", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    expect(css).toMatch(/@source\s+"\.\.\/\.\.\/\.\.\/\.pier\/canvases"/);
  });
});
