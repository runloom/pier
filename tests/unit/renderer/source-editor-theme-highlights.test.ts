import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const THEME_PATH = join(
  process.cwd(),
  "src/shared/source-editor/editor-theme.ts"
);
const GLOBALS_PATH = join(process.cwd(), "src/renderer/app/globals.css");

const DECORATION_TOKENS = [
  "--editor-selection-bg",
  "--editor-selection-match-bg",
  "--editor-selection-match-main-bg",
  "--editor-search-match-bg",
  "--editor-search-match-border",
  "--editor-search-match-active-bg",
  "--editor-search-match-active-border",
  "--editor-active-line-bg",
] as const;

/**
 * Editor occurrence / find chrome is a decoration layer owned by product tokens.
 * CodeMirror neon defaults must not leak; status hues must not paint mark fills.
 */
describe("source editor decoration chrome contract", () => {
  const themeSource = readFileSync(THEME_PATH, "utf8");
  const globalsSource = readFileSync(GLOBALS_PATH, "utf8");

  it("defines decoration tokens for dark and light shells", () => {
    for (const token of DECORATION_TOKENS) {
      expect(globalsSource, `missing ${token} in globals`).toContain(token);
    }
    // Light shell re-tunes wash strength (not only inherits dark).
    expect(globalsSource).toMatch(
      /:root\.light\s*\{[\s\S]*?--editor-selection-match-bg:/u
    );
  });

  it("maps CM selection / search classes only through decoration tokens", () => {
    for (const selector of [
      ".cm-selectionMatch",
      ".cm-selectionMatch-main",
      ".cm-searchMatch",
      ".cm-searchMatch-selected",
    ] as const) {
      expect(themeSource, `missing ${selector}`).toContain(`"${selector}"`);
    }

    expect(themeSource).toContain("var(--editor-selection-match-bg)");
    expect(themeSource).toContain("var(--editor-selection-match-main-bg)");
    expect(themeSource).toContain("var(--editor-search-match-bg)");
    expect(themeSource).toContain("var(--editor-search-match-active-bg)");
    expect(themeSource).toContain("var(--editor-selection-bg)");
    expect(themeSource).toContain("var(--editor-active-line-bg)");

    // Do not reintroduce CM neon defaults or ad-hoc status fill mixes.
    expect(themeSource).not.toMatch(
      /#99ff77|#ffff00|#00ffff|#ff6a00|#ff00ff/iu
    );
    expect(themeSource).not.toMatch(
      /\.cm-selectionMatch"[\s\S]{0,200}?var\(--(?:success|warning|done)\)/u
    );
    expect(themeSource).not.toMatch(
      /\.cm-searchMatch"[\s\S]{0,200}?var\(--(?:success|warning|done)\)/u
    );
  });
});
