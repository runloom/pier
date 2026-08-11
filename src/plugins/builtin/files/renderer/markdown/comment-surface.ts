/**
 * 从 Markdown IR 文档构建评论投影表面（files 插件侧）。
 */
import { buildMarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";
import { markdownDocumentBlockTexts } from "./comment-block-text.ts";
import type { MarkdownIrDocument } from "./ir.ts";

export type { MarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";

export function buildMarkdownCommentSurfaceFromIr(
  document: MarkdownIrDocument,
  options?: { readonly filePresent?: boolean }
) {
  return buildMarkdownCommentSurface({
    blockTexts: markdownDocumentBlockTexts(document.blocks),
    filePresent: options?.filePresent !== false,
    headingIds: document.headings.map((heading) => heading.id),
  });
}
