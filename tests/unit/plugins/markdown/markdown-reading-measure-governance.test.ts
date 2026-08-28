import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MARKDOWN_COMFORTABLE_MEASURE_REM } from "@plugins/builtin/files/renderer/markdown/preview-toc-layout.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-08-28-markdown-reading-measure-gold-standard.md";
const MARKDOWN_DIR = join(ROOT, "src/plugins/builtin/files/renderer/markdown");
const PROSE_CSS = join(MARKDOWN_DIR, "prose.css");
const TOC_LAYOUT = join(MARKDOWN_DIR, "preview-toc-layout.ts");
const PREVIEW = join(MARKDOWN_DIR, "preview.tsx");
const HTML_SCHEMA = join(MARKDOWN_DIR, "html/schema.ts");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walkMarkdownRenderer(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const filePath = join(dir, entry);
      if (statSync(filePath).isDirectory()) {
        visit(filePath);
        continue;
      }
      if (/\.(?:css|ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
        files.push(filePath);
      }
    }
  };
  visit(MARKDOWN_DIR);
  return files;
}

describe("markdown reading measure gold standard", () => {
  it("documents the contract in AGENTS.md and the 2026-08-28 spec", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### Markdown 预览阅读版心");
    expect(agents).toContain(
      "tests/unit/plugins/markdown/markdown-reading-measure-governance.test.ts"
    );
    expect(agents).toContain("42rem");
    expect(spec).toContain("42rem");
    expect(spec).toMatch(/禁止\*\* `ch`/);
    expect(spec).toMatch(/禁止\*\* `justify`/);
    expect(spec).toContain('align="justify"');
    expect(spec).toContain("overflow-wrap: anywhere");
    expect(spec).toContain("--md-scale");
    expect(spec).toContain("max-w-5xl");
    expect(spec).toContain("text-wrap: wrap");
  });

  it("keeps comfortable measure as root rem owned by CSS", () => {
    const proseCss = readFileSync(PROSE_CSS, "utf8");
    const tocLayout = readFileSync(TOC_LAYOUT, "utf8");
    expect(proseCss).toContain(
      `--md-measure-comfortable: ${MARKDOWN_COMFORTABLE_MEASURE_REM}rem`
    );
    expect(proseCss).toContain("--md-measure: var(--md-measure-comfortable)");
    expect(proseCss).toContain("max-width: var(--md-measure)");
    expect(proseCss).not.toMatch(/--md-measure(?:-comfortable)?:\s*[^;]*ch/);
    expect(tocLayout).not.toContain("MEASURE_CH");
    expect(tocLayout).not.toMatch(/\b85ch\b/);
    expect(tocLayout).not.toContain("measureMarkdownChWidthPx");
    expect(tocLayout).not.toContain("readMarkdownContentWidthPx");
    expect(tocLayout).not.toContain("rootFontSizePx");
  });

  it("left-aligns the column and wraps long tokens without stretching it", () => {
    const proseCss = readFileSync(PROSE_CSS, "utf8");
    expect(proseCss).toContain("text-align: start");
    expect(proseCss).not.toMatch(/text-align:\s*justify/);
    expect(proseCss).toContain("overflow-wrap: anywhere");
    expect(proseCss).toContain("padding-inline-end: 0");
    expect(proseCss).toContain("text-wrap: wrap");
    expect(proseCss).toContain(
      '[data-slot="markdown-prose"] .md-callout [data-slot="alert-description"]'
    );
    expect(readFileSync(PREVIEW, "utf8")).toContain("mx-auto w-full min-w-0");
  });

  it("does not map HTML justify onto the reading column", () => {
    const schema = readFileSync(HTML_SCHEMA, "utf8");
    expect(schema).not.toContain("text-justify");
    expect(schema).not.toMatch(/value === ["']justify["']/);
    for (const filePath of walkMarkdownRenderer()) {
      expect(
        readFileSync(filePath, "utf8").includes("text-justify"),
        relative(ROOT, filePath)
      ).toBe(false);
    }
  });
});
