import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("comment navigator layout governance", () => {
  it("pins the shared bar with absolute bottom, not document flow", () => {
    const navigator = read("packages/ui/src/comments/navigator.tsx");
    expect(navigator).toContain("absolute bottom-4 left-1/2");
    expect(navigator).toContain("COMMENT_NAVIGATOR_SCROLL_PAD_CLASS");
    expect(navigator).toContain("viewport-sized, non-scrolling frame");
    expect(navigator).toContain("never inside the scroll root");
  });

  it("keeps canvas chrome outside the preview scroll root", () => {
    const canvas = read(
      "src/plugins/builtin/files/renderer/preview/canvas.tsx"
    );
    const previewRoot = canvas.match(
      /className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"[\s\S]{0,180}data-slot="file-canvas-preview"/
    )?.[0];
    expect(previewRoot).toBeDefined();
    expect(previewRoot).toContain("overflow-hidden");
    expect(previewRoot).not.toContain("overflow-auto");
    expect(canvas).toContain('data-slot="file-canvas-scroll"');
    expect(canvas).toContain("COMMENT_NAVIGATOR_SCROLL_PAD_CLASS");
    expect(canvas).toMatch(
      /data-slot="file-canvas-scroll"[\s\S]*?<\/div>\s*\{commentNavigator/
    );
  });

  it("keeps markdown chrome on the preview frame, not the article scroller", () => {
    const preview = read(
      "src/plugins/builtin/files/renderer/markdown/preview.tsx"
    );
    expect(preview).toContain('data-slot="markdown-preview-root"');
    expect(preview).toContain(
      "group/preview relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    );
    expect(preview).toContain("COMMENT_NAVIGATOR_SCROLL_PAD_CLASS");
    expect(preview).toMatch(
      /data-slot="markdown-preview"[\s\S]*?<\/div>\s*\{outlineToc \?[\s\S]*\{commentNavigator\}/
    );
  });

  it("keeps the markdown gutter icon tooltip-free and bottom-bar tips above", () => {
    const gutter = read(
      "src/plugins/builtin/files/renderer/markdown/comments/preview-block.tsx"
    );
    const navigator = read("packages/ui/src/comments/navigator.tsx");
    expect(gutter).not.toContain("Tooltip");
    expect(gutter).toContain("aria-label={props.addCommentLabel}");
    expect(gutter).toContain('data-slot="markdown-comment-badge"');
    expect(gutter).toContain("Popover");
    expect(gutter).not.toContain("块下常驻");
    expect(navigator).toContain('<TooltipContent side="top">');
    expect(navigator).toContain("onRevealCurrent");
    expect(navigator).not.toContain("disabled={total <= 1}");
    expect(navigator).not.toContain("title={positionLabel}");
    expect(navigator).not.toContain("title={previousLabel}");
    expect(navigator).not.toContain("title={nextLabel}");
  });

  it("forces lazy markdown pages so comment reveal can mount the block", () => {
    const pagination = read(
      "src/plugins/builtin/files/renderer/markdown/pagination-view.tsx"
    );
    const preview = read(
      "src/plugins/builtin/files/renderer/markdown/preview.tsx"
    );
    expect(pagination).toContain("forceCommentPageIndex");
    expect(pagination).toContain("page.index <= forceCommentPageIndex");
    expect(preview).toContain("forceCommentPageIndex={forceCommentPageIndex}");
  });

  it("reveals canvas comments on hidden tabs instead of shrinking n/N", () => {
    const canvas = read(
      "src/plugins/builtin/files/renderer/preview/canvas.tsx"
    );
    const nav = read(
      "src/plugins/builtin/files/renderer/preview/canvas-comment-nav.ts"
    );
    const locate = read(
      "src/plugins/builtin/files/renderer/preview/canvas-comment-locate.ts"
    );
    expect(canvas).toContain("revealCanvasCommentNavTarget");
    expect(canvas).toContain("hiddenPins");
    expect(canvas).toContain("liveThreads");
    expect(nav).toContain("revealCanvasTabPanelForTarget");
    expect(nav).toContain("oldest first");
    expect(nav).toContain("same number as the pin");
    expect(nav).toContain("mousedown");
    expect(locate).toContain("canvasCommentPinIdentityKey");
    expect(locate).toContain("numberIdentityPins");
  });

  it("keeps git review chrome on a clipped surface frame", () => {
    const content = read("src/plugins/builtin/git/renderer/review/content.tsx");
    expect(content).toContain(
      'className="relative h-full min-h-0 overflow-hidden"'
    );
    expect(content).toMatch(
      /<GitReviewSurfaceView[\s\S]*?<ReviewCommentsChrome/
    );
  });
});
