/**
 * 从 Markdown IR 块提取用于评论指纹 / excerpt 的纯文本。
 * 粒度：top-level block（list 整块一起；不拆 item）。
 */
import type { MarkdownBlock, MarkdownInline } from "../ir.ts";

function inlinesToText(inlines: readonly MarkdownInline[]): string {
  const parts: string[] = [];
  for (const inline of inlines) {
    switch (inline.kind) {
      case "text":
      case "inlineCode":
      case "inlineMath":
      case "html":
        parts.push(inline.value);
        break;
      case "break":
        parts.push("\n");
        break;
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "textDirective":
        parts.push(inlinesToText(inline.children));
        break;
      case "image":
        parts.push(inline.alt);
        break;
      case "footnoteReference":
        parts.push(inline.label);
        break;
      default:
        break;
    }
  }
  return parts.join("");
}

function blocksToText(blocks: readonly MarkdownBlock[]): string {
  return blocks.map(markdownBlockPlainText).filter(Boolean).join("\n");
}

/** 单块纯文本（供 hash / excerpt）。 */
export function markdownBlockPlainText(block: MarkdownBlock): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "leafDirective":
      return inlinesToText(block.children);
    case "code":
    case "math":
    case "html":
    case "unsupported":
      return block.value;
    case "blockquote":
    case "containerDirective":
    case "footnoteDefinition":
      return blocksToText(block.blocks);
    case "list":
      return block.items
        .map((item) => blocksToText(item.blocks))
        .filter(Boolean)
        .join("\n");
    case "table":
      return block.rows
        .map((row) =>
          row.cells.map((cell) => inlinesToText(cell.children)).join("\t")
        )
        .join("\n");
    case "thematicBreak":
      return "";
    default:
      return "";
  }
}

/** top-level 块正文列表（跳过空块）。 */
export function markdownDocumentBlockTexts(
  blocks: readonly MarkdownBlock[]
): string[] {
  const texts: string[] = [];
  for (const block of blocks) {
    const text = markdownBlockPlainText(block);
    if (text.trim().length > 0) {
      texts.push(text);
    }
  }
  return texts;
}
