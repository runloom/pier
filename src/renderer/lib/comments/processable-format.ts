/**
 * Agent composer formatting + pending-list location labels for processable comments.
 */
import type {
  ProcessableCommentItem,
  ProcessableCommentStatus,
} from "./processable.ts";

function statusTag(status: ProcessableCommentStatus): string {
  switch (status) {
    case "stale":
      return "stale";
    case "soft":
      return "soft";
    case "unknown":
      return "unknown";
    default:
      return "located";
  }
}

/** Include stored excerpt when locate is weak or not live-verified. */
function shouldAttachExcerpt(status: ProcessableCommentStatus): boolean {
  return status === "stale" || status === "soft" || status === "unknown";
}

function formatGitLine(
  item: Extract<ProcessableCommentItem, { kind: "git-diff" }>
): string {
  return `- [${statusTag(item.status)}] \`${item.path}:${item.line}\`: ${item.body}`;
}

function formatMarkdownLine(
  item: Extract<ProcessableCommentItem, { kind: "markdown" }>
): string {
  const anchor =
    item.headingId === undefined
      ? `${item.path}:L${item.startLine}`
      : `${item.path}#${item.headingId}`;
  const excerpt = shouldAttachExcerpt(item.status)
    ? ` excerpt «${item.excerpt}»`
    : "";
  return `- [${statusTag(item.status)}] \`${anchor}\`${excerpt}: ${item.body}`;
}

function formatCanvasLine(
  item: Extract<ProcessableCommentItem, { kind: "canvas" }>
): string {
  let node = "";
  if (item.anchorId !== undefined) {
    node = ` [${item.anchorId}]`;
  } else if (item.label !== undefined) {
    node = ` (${item.label})`;
  }
  // Keep excerpt when locate is weak/not live-checked, or soft file-level pick.
  const wantExcerpt =
    item.excerpt !== undefined &&
    item.excerpt.length > 0 &&
    (shouldAttachExcerpt(item.status) || item.anchorId === undefined);
  const excerptPart = wantExcerpt ? ` excerpt «${item.excerpt}»` : "";
  return `- [${statusTag(item.status)}] \`${item.path}\`${node}${excerptPart}: ${item.body}`;
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
 * - line：行号（git / md 无 heading 时）
 * - detail：次级锚点文案（heading / canvas 节点），不含 `#` / 方括号噪音
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
    if (item.headingId !== undefined && item.headingId.length > 0) {
      return { path: item.path, detail: item.headingId };
    }
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

/** Tooltip / aria：完整路径 + 行号或细节。 */
export function processableItemLocationText(
  item: ProcessableCommentItem
): string {
  const anchor = processableItemAnchorLabel(item);
  if (anchor.line !== undefined) {
    return `${anchor.path}:${anchor.line}`;
  }
  if (anchor.detail !== undefined) {
    return `${anchor.path} · ${anchor.detail}`;
  }
  return anchor.path;
}
