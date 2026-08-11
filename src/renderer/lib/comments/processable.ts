import type { MarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitReviewGroup } from "@shared/contracts/git/review.ts";
import { projectComment } from "./project-thread.ts";

/**
 * Agent 状态栏 / 评论操作弹窗可处理的评论。
 *
 * - git-diff：未提交变更面 + 存活正文 + 路径仍在 livePaths（与 uncommitted Changes 一致）
 * - markdown / canvas：存活正文即可（不依赖 git status）
 *
 * status：
 * - located / stale：有表面证据（如 gitDiffPatches）时由 projectComment 决定
 * - unverified：无证据，禁止假装 located（设计：不向 agent 输出假精确）
 */
export type ProcessableCommentStatus = "located" | "stale" | "unverified";

interface ProcessableBase {
  readonly body: string;
  readonly commentId: string;
  readonly status: ProcessableCommentStatus;
  readonly threadId: string;
  readonly updatedAt: number;
}

export type ProcessableCommentItem =
  | (ProcessableBase & {
      readonly kind: "git-diff";
      readonly group: GitReviewGroup;
      readonly line: number;
      readonly oldPath: string | null;
      readonly path: string;
      readonly side: "new" | "old";
    })
  | (ProcessableBase & {
      readonly kind: "markdown";
      readonly excerpt: string;
      readonly headingId?: string;
      readonly path: string;
      readonly startLine: number;
    })
  | (ProcessableBase & {
      readonly kind: "canvas";
      readonly anchorId?: string;
      readonly excerpt?: string;
      readonly label?: string;
      readonly path: string;
    });

export interface ListProcessableCommentsOptions {
  /**
   * 当前 review section patch，key = `${group}\0${path}`。
   * 有则投影 git status；无则 git 标 unverified。
   */
  readonly gitDiffPatches?: ReadonlyMap<string, string>;
  /**
   * 当前未提交变更路径（含重命名 origPath）。传入后剔除 path 已不在变更中的 git 评论。
   * 省略则 git-diff 不计入（避免 status 未就绪时闪孤儿）；md/canvas 不受影响。
   * 传空 Set 表示已就绪且无变更路径。
   */
  readonly livePaths?: ReadonlySet<string>;
  /**
   * Markdown 投影表面，key = 相对 worktree 的 path。
   * 有则 located/stale；文件 missing 则不计入；无 surface 则 unverified。
   */
  readonly markdownSurfaces?: ReadonlyMap<string, MarkdownCommentSurface>;
}

function gitPatchKey(group: string, path: string): string {
  return `${group}\0${path}`;
}

function isUncommittedGitDiff(
  thread: CommentThread
): thread is CommentThread & {
  target: Extract<CommentThread["target"], { kind: "git-diff" }>;
} {
  if (thread.target.kind !== "git-diff") {
    return false;
  }
  return thread.target.scope.target.kind === "uncommitted";
}

function isMarkdownThread(thread: CommentThread): thread is CommentThread & {
  target: Extract<CommentThread["target"], { kind: "markdown" }>;
} {
  return thread.target.kind === "markdown";
}

function isCanvasThread(thread: CommentThread): thread is CommentThread & {
  target: Extract<CommentThread["target"], { kind: "canvas" }>;
} {
  return thread.target.kind === "canvas";
}

/** path 或 oldPath 任一仍在变更集合中 → 仍可定位。 */
export function pathInLiveSet(
  path: string,
  oldPath: string | null,
  livePaths: ReadonlySet<string>
): boolean {
  if (livePaths.has(path)) {
    return true;
  }
  return oldPath !== null && livePaths.has(oldPath);
}

function pushLiveBodies(
  thread: CommentThread,
  push: (commentId: string, body: string) => void
): void {
  for (const comment of thread.comments) {
    if (comment.deletedAt !== undefined || !comment.body.trim()) {
      continue;
    }
    push(comment.id, comment.body.trim());
  }
}

function gitDiffStatus(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "git-diff" }>;
  },
  patches: ReadonlyMap<string, string> | undefined
): ProcessableCommentStatus {
  const patch = patches?.get(
    gitPatchKey(thread.target.group, thread.target.path)
  );
  if (patch === undefined) {
    return "unverified";
  }
  const projection = projectComment(thread, { kind: "git-diff", patch });
  if (projection.status === "located") {
    return "located";
  }
  // drifted / missing → agent 仍可处理，但标 stale
  return "stale";
}

/**
 * 有 surface 时返回 status；文件 missing 返回 null（调用方跳过）；
 * 无 surface 返回 unverified。
 */
function markdownProcessableStatus(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "markdown" }>;
  },
  surfaces: ReadonlyMap<string, MarkdownCommentSurface> | undefined
): ProcessableCommentStatus | null {
  const surface = surfaces?.get(thread.target.path);
  if (surface === undefined) {
    return "unverified";
  }
  const projection = projectComment(thread, surface);
  if (projection.status === "missing") {
    return null;
  }
  if (projection.status === "located") {
    return "located";
  }
  return "stale";
}

/** 收集可交给智能体处理的评论。 */
export function listProcessableComments(
  threads: readonly CommentThread[] | undefined,
  options?: ListProcessableCommentsOptions
): ProcessableCommentItem[] {
  if (threads === undefined || threads.length === 0) {
    return [];
  }
  const livePaths = options?.livePaths;
  const patches = options?.gitDiffPatches;
  const markdownSurfaces = options?.markdownSurfaces;
  const items: ProcessableCommentItem[] = [];
  for (const thread of threads) {
    if (isUncommittedGitDiff(thread)) {
      // git 需要 livePaths 就绪；省略 = 不计（status 未到）
      if (livePaths === undefined) {
        continue;
      }
      if (
        !pathInLiveSet(thread.target.path, thread.target.oldPath, livePaths)
      ) {
        continue;
      }
      const status = gitDiffStatus(thread, patches);
      pushLiveBodies(thread, (commentId, body) => {
        items.push({
          body,
          commentId,
          group: thread.target.group,
          kind: "git-diff",
          line: thread.target.line,
          oldPath: thread.target.oldPath,
          path: thread.target.path,
          side: thread.target.side,
          status,
          threadId: thread.id,
          updatedAt: thread.updatedAt,
        });
      });
      continue;
    }
    if (isMarkdownThread(thread)) {
      const { target } = thread;
      const status = markdownProcessableStatus(thread, markdownSurfaces);
      if (status === null) {
        continue;
      }
      pushLiveBodies(thread, (commentId, body) => {
        items.push({
          body,
          commentId,
          excerpt: target.excerpt,
          kind: "markdown",
          path: target.path,
          startLine: target.startLine,
          status,
          threadId: thread.id,
          updatedAt: thread.updatedAt,
          ...(target.headingId === undefined
            ? {}
            : { headingId: target.headingId }),
        });
      });
      continue;
    }
    if (isCanvasThread(thread)) {
      const { target } = thread;
      pushLiveBodies(thread, (commentId, body) => {
        items.push({
          body,
          commentId,
          kind: "canvas",
          path: target.path,
          status: "unverified",
          threadId: thread.id,
          updatedAt: thread.updatedAt,
          ...(target.anchorId === undefined
            ? {}
            : { anchorId: target.anchorId }),
          ...(target.excerpt === undefined ? {} : { excerpt: target.excerpt }),
          ...(target.label === undefined ? {} : { label: target.label }),
        });
      });
    }
  }
  items.sort((left, right) => {
    const kindOrder = kindSortKey(left.kind) - kindSortKey(right.kind);
    if (kindOrder !== 0) {
      return kindOrder;
    }
    const byPath = left.path.localeCompare(right.path);
    if (byPath !== 0) {
      return byPath;
    }
    if (left.kind === "git-diff" && right.kind === "git-diff") {
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      if (left.side !== right.side) {
        return left.side === "old" ? -1 : 1;
      }
    }
    if (
      left.kind === "markdown" &&
      right.kind === "markdown" &&
      left.startLine !== right.startLine
    ) {
      return left.startLine - right.startLine;
    }
    const byThread = left.threadId.localeCompare(right.threadId);
    if (byThread !== 0) {
      return byThread;
    }
    return left.commentId.localeCompare(right.commentId);
  });
  return items;
}

function kindSortKey(kind: ProcessableCommentItem["kind"]): number {
  switch (kind) {
    case "git-diff":
      return 0;
    case "markdown":
      return 1;
    case "canvas":
      return 2;
    default:
      return 9;
  }
}

export function processableCommentCount(
  threads: readonly CommentThread[] | undefined,
  options?: ListProcessableCommentsOptions
): number {
  return listProcessableComments(threads, options).length;
}

function statusTag(status: ProcessableCommentStatus): string {
  if (status === "stale") {
    return "stale";
  }
  if (status === "unverified") {
    return "unverified";
  }
  return "located";
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
  const excerpt =
    item.status === "stale" || item.status === "unverified"
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
  return `- [${statusTag(item.status)}] \`${item.path}\`${node}: ${item.body}`;
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

/** 列表行标题锚点文案（i18n 外的 path 片段）。 */
export function processableItemAnchorLabel(item: ProcessableCommentItem): {
  path: string;
  line?: number;
} {
  if (item.kind === "git-diff") {
    return { path: item.path, line: item.line };
  }
  if (item.kind === "markdown") {
    if (item.headingId !== undefined) {
      return { path: `${item.path}#${item.headingId}` };
    }
    return { path: item.path, line: item.startLine };
  }
  if (item.anchorId !== undefined) {
    return { path: `${item.path} [${item.anchorId}]` };
  }
  return { path: item.path };
}
