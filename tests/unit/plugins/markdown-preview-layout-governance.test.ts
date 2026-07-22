import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PREVIEW_DIR = join(
  ROOT,
  "src",
  "plugins",
  "builtin",
  "files",
  "renderer"
);

function readPreview(fileName: string): string {
  return readFileSync(join(PREVIEW_DIR, fileName), "utf8");
}

describe("markdown preview layout governance", () => {
  it("documents the reuse policy in AGENTS.md", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(agents).toContain("### Markdown 预览大纲布局复用（最高优先级）");
    expect(agents).toContain('data-slot="markdown-preview-layout"');
    expect(agents).toContain("一个大纲壳");
    expect(agents).toContain("同一预览框包含块");
    expect(agents).toContain(
      "tests/unit/plugins/markdown-preview-layout-governance.test.ts"
    );
  });

  it("keeps one outline shell and frame-aligned floating rail", () => {
    const preview = readPreview("markdown-preview.tsx");
    const article = readPreview("markdown-preview-article-layout.tsx");
    const toc = readPreview("markdown-preview-toc.tsx");

    expect(article).toContain('data-slot="markdown-preview-layout"');
    expect(article).toContain("MarkdownPreviewOverlayRail");
    expect(article).toContain('data-slot="markdown-preview-outline-rail"');
    expect(article).toContain("items-end");
    expect(article).toContain("items-start");
    expect(readPreview("markdown-preview-toc.tsx")).toContain("scrollIntoView");
    // Pier light-DOM scrollbars only hide via data-scrollbar="none"
    // (globals.css); Tailwind scrollbar utilities cannot override *::-webkit-scrollbar.
    expect(readPreview("markdown-preview-toc.tsx")).toContain(
      'data-scrollbar="none"'
    );
    expect(preview).toContain("MarkdownPreviewArticleLayout");
    expect(preview).toContain("MarkdownPreviewOverlayRail");
    expect(preview).toContain("<MarkdownPreviewToc");
    expect(preview.match(/<MarkdownPreviewToc\b/g)?.length).toBe(1);

    expect(preview).not.toContain("markdown-preview-dock");
    expect(toc).not.toContain("max-h-[min(70%");
    expect(toc).not.toContain("absolute top-2");
  });

  it("shares outline geometry constants instead of hard-coded twins", () => {
    const toc = readPreview("markdown-preview-toc.tsx");
    const article = readPreview("markdown-preview-article-layout.tsx");
    const layout = readPreview("markdown-preview-toc-layout.ts");
    const fontScale = readPreview("markdown-preview-font-scale.tsx");

    expect(layout).toContain("export const MARKDOWN_TOC_INSET_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_RAIL_WIDTH_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX");
    expect(layout).toContain("export const MARKDOWN_PREVIEW_EDGE_INSET_PX");
    expect(layout).toMatch(/MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX\s*=\s*200\b/);
    expect(fontScale).toContain("MARKDOWN_PREVIEW_EDGE_INSET_PX");
    expect(article).toContain("MARKDOWN_PREVIEW_EDGE_INSET_PX");
    expect(toc).toContain("MARKDOWN_TOC_INSET_PX");
    expect(toc).toContain("MARKDOWN_TOC_RAIL_WIDTH_PX");
    expect(toc).not.toContain("w-56");
    expect(toc).not.toMatch(/\btop-2\b/);
    expect(article).not.toMatch(/\btop-2\b/);
    expect(fontScale).not.toMatch(/\bright-3\b/);
  });

  it("keeps reading prefs in the shared store instead of local TOC state", () => {
    const prefs = readPreview("markdown-preview-preferences.ts");
    const toc = readPreview("markdown-preview-toc.tsx");
    expect(prefs).toContain("useMarkdownPreviewPrefsStore");
    expect(prefs).toContain("tocCollapsed");
    expect(prefs).toContain("pier.files.markdown.tocCollapsed");
    expect(toc).toContain("useMarkdownPreviewPrefsStore");
    expect(toc).not.toMatch(/useState\(false\)/);
  });

  it("keeps visible measure owned by CSS --md-measure", () => {
    const preview = readPreview("markdown-preview.tsx");
    const proseCss = readPreview("markdown-prose.css");
    expect(proseCss).toContain("--md-measure:");
    expect(preview).toContain("w-[var(--md-measure)]");
    expect(preview).not.toContain("w-[72ch]");
  });
});
