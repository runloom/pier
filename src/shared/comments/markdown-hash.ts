/**
 * Markdown 评论块指纹：规范化正文后哈希。
 * 确定性；不依赖 Node crypto（renderer / plugin / test 共用）。
 */

const EXCERPT_MAX = 500;

/** 折叠空白、统一换行，再 trim。 */
export function normalizeMarkdownCommentText(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\s+/gu, " ").trim();
}

/** FNV-1a 32-bit → 8 位 hex（满足 contentHash max 128）。 */
export function markdownBlockContentHash(text: string): string {
  const normalized = normalizeMarkdownCommentText(text);
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < normalized.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a unsigned coerce
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 创建评论时的原文摘录（有界）。 */
export function markdownCommentExcerpt(
  text: string,
  maxLength = EXCERPT_MAX
): string {
  const normalized = normalizeMarkdownCommentText(text);
  if (normalized.length === 0) {
    return "…";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}
