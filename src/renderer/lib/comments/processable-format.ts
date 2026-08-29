/**
 * 智能体输入框文案 + 待处理列表定位标签。
 * payload = 智能体能 Read 的定位器 + 评论正文。
 * 禁止投影标签、IR 摘录、标题 slug。
 */
import type { ProcessableCommentItem } from "./processable.ts";

function formatPathLineRange(
  path: string,
  startLine: number,
  endLine?: number
): string {
  if (endLine === undefined || endLine === startLine) {
    return `${path}:${startLine}`;
  }
  return `${path}:${startLine}-${endLine}`;
}

function formatGitLine(
  item: Extract<ProcessableCommentItem, { kind: "git-diff" }>
): string {
  const old = item.side === "old" ? " (old)" : "";
  return `- \`${item.path}:${item.line}\`${old}: ${item.body}`;
}

function formatMarkdownLine(
  item: Extract<ProcessableCommentItem, { kind: "markdown" }>
): string {
  return `- \`${formatPathLineRange(item.path, item.startLine, item.endLine)}\`: ${item.body}`;
}

function formatCanvasLine(
  item: Extract<ProcessableCommentItem, { kind: "canvas" }>
): string {
  const locator =
    item.anchorId === undefined || item.anchorId.length === 0
      ? item.path
      : `${item.path}#${item.anchorId}`;
  return `- \`${locator}\`: ${item.body}`;
}

/** 写入智能体输入框的评论块（纯文本，便于 agent 阅读）。 */
export function formatCommentsForComposer(
  items: readonly ProcessableCommentItem[]
): string {
  if (items.length === 0) {
    return "";
  }
  const review = items.filter((item) => item.kind === "git-diff");
  const document = items.filter((item) => item.kind === "markdown");
  const canvas = items.filter((item) => item.kind === "canvas");
  const sections: string[] = ["Please address these comments:"];
  if (review.length > 0) {
    sections.push("", "## Review", ...review.map(formatGitLine));
  }
  if (document.length > 0) {
    sections.push("", "## Document", ...document.map(formatMarkdownLine));
  }
  if (canvas.length > 0) {
    sections.push("", "## Canvas", ...canvas.map(formatCanvasLine));
  }
  return sections.join("\n");
}

export function mergeComposerText(existing: string, addition: string): string {
  const add = addition.trim();
  if (add.length === 0) {
    return existing;
  }
  const base = existing.replace(/\s+$/u, "");
  if (base.length === 0) {
    return add;
  }
  return `${base}\n\n${add}`;
}

/**
 * 列表行定位元信息（结构化，避免 `文档 · .path#id` 糊成一行 URL）。
 * - path：文件路径
 * - line：行号（git / markdown 起始行）
 * - detail：次级锚点文案，不含 `#` / 方括号噪音
 */
export function processableItemAnchorLabel(item: ProcessableCommentItem): {
  readonly detail?: string;
  readonly line?: number;
  readonly path: string;
} {
  if (item.kind === "git-diff") {
    return { path: item.path, line: item.line };
  }
  if (item.kind === "markdown") {
    return { path: item.path, line: item.startLine };
  }
  // Canvas: path only in the list. Node label / anchorId is redundant next to
  // the「设计稿」badge (e.g. avoid `….canvas.tsx · 设计`).
  if (item.kind === "canvas") {
    return { path: item.path };
  }
  const _exhaustive: never = item;
  return _exhaustive;
}

/** Tooltip / aria：完整路径 + 行号或范围。 */
export function processableItemLocationText(
  item: ProcessableCommentItem
): string {
  if (item.kind === "markdown") {
    return formatPathLineRange(item.path, item.startLine, item.endLine);
  }
  const anchor = processableItemAnchorLabel(item);
  if (anchor.line !== undefined) {
    return `${anchor.path}:${anchor.line}`;
  }
  if (anchor.detail !== undefined) {
    return `${anchor.path} · ${anchor.detail}`;
  }
  return anchor.path;
}
