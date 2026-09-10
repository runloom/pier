import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERMAID_THEME_CSS } from "@pier/ui/mermaid/theme-css.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-10-mermaid-paper-tokens-gold-standard.md";
const THEME = "packages/ui/src/mermaid/theme.ts";
const THEME_CSS = "packages/ui/src/mermaid/theme-css.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("mermaid paper-token gold standard", () => {
  it("indexes the gold-standard spec from AGENTS.md", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### Markdown / Canvas Mermaid 纸面着色");
    expect(agents).toContain(
      "2026-09-10-mermaid-paper-tokens-gold-standard.md"
    );
    expect(agents).toContain("tests/unit/ui/mermaid-theme-governance.test.ts");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain('theme: "base"');
    expect(spec).toContain("classDef");
    expect(spec).toContain(".cluster rect");
    expect(spec).toContain("fill: none");
    expect(spec).toContain("默认边不是状态色");
    expect(spec).toContain("流程图才 neo");
    expect(spec).toContain("look: neo");
    expect(spec).toContain("curve: rounded");
    expect(spec).toContain("不是缺陷");
  });

  it("keeps the official engine on base theme plus CSS-var overlay", () => {
    const theme = read(THEME);
    const pkg = JSON.parse(read("packages/ui/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.mermaid).toMatch(/^11\.16\.\d+$/);
    expect(pkg.dependencies["@mermaid-js/layout-elk"]).toMatch(/^[\^~]?0\.2\./);
    expect(theme).toContain('theme: "base"');
    expect(theme).toContain("themeCSS: MERMAID_THEME_CSS");
    expect(theme).toContain("applyFlowchartLook");
    expect(theme).toContain("khroma parses themeVariables colors");
    expect(theme).not.toContain('theme: "dark"');
    expect(theme).not.toContain('look: "neo"');
    expect(theme).toContain("htmlLabels: true");
    expect(theme).toMatch(/themeVariables:\s*\{\s*fontFamily:/);
  });

  it("maps the closed-set chrome selectors onto paper tokens", () => {
    expect(MERMAID_THEME_CSS).toContain(".cluster rect");
    expect(MERMAID_THEME_CSS).toContain(".cluster path");
    expect(MERMAID_THEME_CSS).toContain(".cluster-label");
    expect(MERMAID_THEME_CSS).toContain(".node ellipse");
    expect(MERMAID_THEME_CSS).toContain(".node path");
    expect(MERMAID_THEME_CSS).toContain(".edgePath .path");
    expect(MERMAID_THEME_CSS).toContain(".arrowheadPath");
    expect(MERMAID_THEME_CSS).toContain(".entityBox");
    expect(MERMAID_THEME_CSS).toContain(".relationshipLine");
    expect(MERMAID_THEME_CSS).toContain(".relationshipLabelBox");
    expect(MERMAID_THEME_CSS).toContain(".statediagram-cluster .inner");
    expect(MERMAID_THEME_CSS).toContain(".statediagram-note rect");
    expect(MERMAID_THEME_CSS).toContain(".mindmap-node path");
    expect(MERMAID_THEME_CSS).toContain('[class^="section-edge-"]');
    expect(MERMAID_THEME_CSS).toMatch(
      /\.cluster rect[\s\S]*fill: var\(--secondary\)/
    );
    expect(MERMAID_THEME_CSS).toMatch(/\.node rect[\s\S]*fill: var\(--card\)/);
    expect(MERMAID_THEME_CSS).toContain(
      "stroke: var(--muted-foreground) !important"
    );
    expect(MERMAID_THEME_CSS).toContain(
      "fill: var(--muted-foreground) !important"
    );
    expect(MERMAID_THEME_CSS).not.toContain("--status-");
    expect(MERMAID_THEME_CSS).toContain('.node[data-look="neo"] rect');
    expect(MERMAID_THEME_CSS).toContain("rx: var(--radius) !important");
  });

  it("keeps hollow markers hollow and does not mix actor boxes into label fill", () => {
    const css = MERMAID_THEME_CSS;
    expect(css).toContain(".extension path");
    expect(css).toContain(".aggregation path");
    expect(css).toContain(".onlyOne path");
    expect(css).toContain(".zeroOrOne circle");
    expect(css).toContain("marker path");
    expect(css).toMatch(/\.extension path[\s\S]*fill: none !important/);
    expect(css).not.toMatch(/\.marker path[\s\S]*fill: none !important/);
    expect(css).not.toMatch(/(?:^|,)\s*\.marker(?:\s*,|\s*\{)/);
    const labelRule =
      /text\.actor > tspan[\s\S]*?font-family: var\(--font-sans\)/.exec(
        css
      )?.[0];
    expect(labelRule).toBeTruthy();
    expect(labelRule).not.toMatch(/(?:^|,)\s*\.actor\s*,/);
    expect(css).not.toMatch(
      /marker path, \.arrowMarkerPath, \.marker \{\s*fill: var\(--muted-foreground\)/
    );
  });

  it("keeps overlay !important through CSSOM when the engine preserves it", () => {
    expect(MERMAID_THEME_CSS).toMatch(
      /\.note, \.labelBox, rect\.actor \{[\s\S]*fill: var\(--secondary\) !important/
    );
    expect(MERMAID_THEME_CSS).toMatch(
      /marker path[\s\S]*fill: var\(--muted-foreground\) !important/
    );
    const probe = new CSSStyleSheet();
    probe.replaceSync(".x { fill: var(--card) !important; }");
    const probeText = [...probe.cssRules]
      .map((rule) => rule.cssText)
      .join("\n");
    if (!/important/i.test(probeText)) {
      return;
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(MERMAID_THEME_CSS);
    const text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    expect(text).toMatch(/fill:\s*var\(--card\).*important/i);
    expect(text).toMatch(/fill:\s*var\(--secondary\).*important/i);
  });

  it("does not bake hex or rgb into the overlay", () => {
    expect(read(THEME_CSS)).not.toMatch(
      /(?<![\w])#(?:[\da-f]{3,8})(?![\da-f\w])|\b(?:hsl|hsla|oklch|rgb|rgba)\s*\(/i
    );
    expect(MERMAID_THEME_CSS).toContain("currentColor");
    expect(read(THEME_CSS)).toContain("classDef");
  });
});
