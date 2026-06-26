import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DARK_SHADOW_BLOCK_RE = /:root:not\(\.light\) \{[\s\S]*?\n\}/;
const LIGHT_BLOCK_RE = /:root\.light \{[\s\S]*?\n\}/;

describe("Pier elevation shadow CSS", () => {
  it("defines dark-only elevation shadows and leaves light mode on default shadows", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    const darkShadowBlock = css.match(DARK_SHADOW_BLOCK_RE)?.[0];
    const lightBlock = css.match(LIGHT_BLOCK_RE)?.[0];

    expect(darkShadowBlock).toBeTruthy();
    expect(lightBlock).toBeTruthy();

    for (const token of [
      "--shadow-2xs",
      "--shadow-xs",
      "--shadow-sm",
      "--shadow-md",
      "--shadow-lg",
      "--shadow-xl",
      "--shadow-2xl",
    ]) {
      expect(darkShadowBlock).toContain(token);
      expect(lightBlock).not.toContain(token);
    }

    expect(darkShadowBlock).toContain("--elevation-border");
    expect(darkShadowBlock).toContain("--elevation-shadow-color");
    expect(darkShadowBlock).toContain("--elevation-shadow-ambient");
    expect(darkShadowBlock).toContain("--elevation-shadow-key");
    expect(darkShadowBlock).toContain("0 0 0 1px var(--elevation-border)");
    expect(darkShadowBlock).toContain("var(--foreground) 16%");
    expect(darkShadowBlock).toContain("var(--background) 66%");
    expect(lightBlock).not.toContain("--elevation-shadow-color");
    expect(css).not.toContain("--elevation-shadow-ambient: rgb(");
    expect(css).not.toContain("--elevation-shadow-key: rgb(");
  });
});
