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
    expect(agents).toContain("默认不遮挡正文");
    expect(agents).toContain("MARKDOWN_TOC_TOP_RATIO");
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
    expect(article).toContain("MARKDOWN_TOC_TOP_RATIO");
    expect(article).toContain("MARKDOWN_TOC_EDGE_INSET_PX");
    expect(article).toContain("markdownOutlineHoverMaxHeightPx");
    expect(article).toContain("markdownOutlineHoverWidthPx");
    expect(article).toContain("panelWidthPx");
    expect(toc).toContain("scrollIntoView");
    expect(toc).toContain("group-hover/toc");
    expect(toc).toContain("group-focus-within/toc");
    expect(toc).toContain("markdownTocTickWidthPx");
    expect(toc).toContain("top-1/2");
    expect(toc).toContain("-translate-y-1/2");
    expect(toc).toContain("MutationObserver");
    expect(toc).not.toContain("setTocCollapsed");
    expect(toc).not.toContain("<X");
    // Pier light-DOM scrollbars only hide via data-scrollbar="none"
    // (globals.css); Tailwind scrollbar utilities cannot override *::-webkit-scrollbar.
    expect(toc).toContain('data-scrollbar="none"');
    expect(preview).toContain("MarkdownPreviewArticleLayout");
    expect(preview).toContain("MarkdownPreviewOverlayRail");
    expect(preview).toContain("<MarkdownPreviewToc");
    expect(preview.match(/<MarkdownPreviewToc\b/g)?.length).toBe(1);

    expect(preview).not.toContain("markdown-preview-dock");
    expect(preview).not.toContain("tocSide");
    expect(toc).not.toContain("max-h-[min(70%");
    expect(toc).not.toContain("absolute top-2");
  });

  it("shares outline geometry constants instead of hard-coded twins", () => {
    const preview = readPreview("markdown-preview.tsx");
    const toc = readPreview("markdown-preview-toc.tsx");
    const article = readPreview("markdown-preview-article-layout.tsx");
    const layout = readPreview("markdown-preview-toc-layout.ts");
    const fontScale = readPreview("markdown-preview-font-scale.tsx");

    expect(layout).toContain("export const MARKDOWN_TOC_INSET_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_PANEL_WIDTH_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_TICK_RAIL_WIDTH_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_TOP_RATIO");
    expect(layout).toContain("export const MARKDOWN_TOC_EDGE_INSET_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_BOTTOM_RESERVE_PX");
    expect(layout).toContain("export const MARKDOWN_PREVIEW_EDGE_INSET_PX");
    expect(layout).toContain("export const MARKDOWN_TOC_CONTENT_INSET_PX");
    expect(layout).toContain("MARKDOWN_TOC_CONTENT_GAP_PX");
    expect(preview).toContain("MARKDOWN_TOC_CONTENT_INSET_PX");
    expect(preview).toContain("hasOutline");
    expect(fontScale).toContain("MARKDOWN_PREVIEW_EDGE_INSET_PX");
    expect(article).toContain("MARKDOWN_TOC_EDGE_INSET_PX");
    expect(toc).not.toContain("MARKDOWN_TOC_PANEL_WIDTH_PX");
    expect(toc).toContain("MARKDOWN_TOC_TICK_HEIGHT_PX");
    expect(toc).not.toContain("w-56");
    expect(toc).not.toMatch(/\btop-2\b/);
    expect(article).not.toMatch(/\btop-2\b/);
    expect(fontScale).not.toMatch(/\bright-3\b/);
  });

  it("keeps reading prefs in the shared store without outline side/collapse", () => {
    const prefs = readPreview("markdown-preview-preferences.ts");
    const toc = readPreview("markdown-preview-toc.tsx");
    expect(prefs).toContain("useMarkdownPreviewPrefsStore");
    expect(prefs).not.toContain("tocCollapsed");
    expect(prefs).not.toContain("tocSide");
    expect(toc).not.toContain("useMarkdownPreviewPrefsStore");
    expect(toc).not.toMatch(/useState\(false\)/);
  });

  it("keeps visible measure owned by CSS --md-measure", () => {
    const proseCss = readPreview("markdown-prose.css");
    expect(proseCss).toContain("--md-measure:");
    expect(proseCss).toContain("max-width: var(--md-measure)");
  });
});
