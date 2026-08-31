import { markdownBlockContentHash } from "@shared/comments/markdown-hash.ts";
import { markdownInlinesToText } from "../comments/block-text.ts";
import type { MarkdownBlock } from "../ir.ts";

const STRUCTURE_SEP = "\u0000";

/**
 * 列宽偏好的失效键：列数 + 表头行文本。正文单元格编辑不改键（宽度存活）；
 * 加删列 / 列重排 / 表头改名会换键（旧宽度失效，避免按列索引错套）。
 */
export function tableWidthsKey(
  block: Extract<MarkdownBlock, { kind: "table" }>
): string | null {
  const header = block.rows[0];
  if (!header || header.cells.length === 0) return null;
  const headerTexts = header.cells.map((cell) =>
    markdownInlinesToText(cell.children)
  );
  return markdownBlockContentHash(
    `${header.cells.length}${STRUCTURE_SEP}${headerTexts.join(STRUCTURE_SEP)}`
  );
}
