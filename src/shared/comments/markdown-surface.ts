/**
 * 从 heading id 与块正文构建 Markdown 评论投影表面（纯数据，无 React/IR 依赖）。
 */
import { markdownBlockContentHash } from "./markdown-hash.ts";

export interface MarkdownCommentSurface {
  readonly blockHashes: ReadonlySet<string>;
  readonly filePresent: boolean;
  readonly headingIds: ReadonlySet<string>;
  readonly kind: "markdown";
}

export function buildMarkdownCommentSurface(input: {
  readonly blockTexts: readonly string[];
  readonly filePresent: boolean;
  readonly headingIds: readonly string[];
}): MarkdownCommentSurface {
  const blockHashes = new Set<string>();
  for (const text of input.blockTexts) {
    const hash = markdownBlockContentHash(text);
    if (hash.length > 0) {
      blockHashes.add(hash);
    }
  }
  return {
    blockHashes,
    filePresent: input.filePresent,
    headingIds: new Set(input.headingIds),
    kind: "markdown",
  };
}
