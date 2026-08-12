import type { CanvasCommentSurface } from "@shared/comments/canvas-surface.ts";
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
 * status（定位可信度，不是「评论是否有效」）：
 * - located：当前有 surface/patch 且投影对得上（可声称精确定位）
 * - stale：有 surface/patch，但对不齐（漂移）
 * - soft：锚点本身是软的（canvas 无 anchorId，仅 label/excerpt）——与预览是否打开无关
 * - unknown：需要 live 核实却做不到（有 anchorId 但无 surface / git 无 patch）
 */
export type ProcessableCommentStatus = "located" | "stale" | "soft" | "unknown";

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
   * Canvas 投影表面，key = 相对 worktree 的 path。
   * 有则 located/stale/soft；filePresent=false 则不计入；无 surface 则 unknown。
   */
  readonly canvasSurfaces?: ReadonlyMap<string, CanvasCommentSurface>;
  /**
   * 当前 review section patch，key = `${group}\0${path}`。
   * 有则投影 git status；无则 git 标 unknown。
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
   * 有则 located/stale；文件 missing 则不计入；无 surface 则 unknown。
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
    return "unknown";
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
 * 无 surface 返回 unknown（此刻无法核实，不是锚点差）。
 */
function markdownProcessableStatus(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "markdown" }>;
  },
  surfaces: ReadonlyMap<string, MarkdownCommentSurface> | undefined
): ProcessableCommentStatus | null {
  const surface = surfaces?.get(thread.target.path);
  if (surface === undefined) {
    return "unknown";
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

function normalizeSurfacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function lookupCanvasSurface(
  surfaces: ReadonlyMap<string, CanvasCommentSurface> | undefined,
  path: string
): CanvasCommentSurface | undefined {
  if (surfaces === undefined) {
    return;
  }
  const direct = surfaces.get(path);
  if (direct) {
    return direct;
  }
  const normalized = normalizeSurfacePath(path);
  if (normalized !== path) {
    const byNormalized = surfaces.get(normalized);
    if (byNormalized) {
      return byNormalized;
    }
  }
  for (const [key, surface] of surfaces) {
    if (normalizeSurfacePath(key) === normalized) {
      return surface;
    }
  }
  return;
}

function canvasHasSoftAnchor(
  target: Extract<CommentThread["target"], { kind: "canvas" }>
): boolean {
  if (target.anchorId !== undefined) {
    return false;
  }
  const hasLabel = target.label !== undefined && target.label.trim().length > 0;
  const hasExcerpt =
    target.excerpt !== undefined && target.excerpt.trim().length > 0;
  return hasLabel || hasExcerpt;
}

/**
 * Canvas status:
 * - Soft design-mode pins (no anchorId, has label/excerpt) are always `soft`
 *   whether or not the preview is open — soft is an anchor-kind property.
 * - Declared anchorId needs live surface: located / stale / unknown.
 * - File-level (no id, no soft fields): located when surface says file present.
 * - filePresent=false → skip (null).
 */
function canvasProcessableStatus(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "canvas" }>;
  },
  surfaces: ReadonlyMap<string, CanvasCommentSurface> | undefined
): ProcessableCommentStatus | null {
  const { target } = thread;
  const softAnchor = canvasHasSoftAnchor(target);
  const surface = lookupCanvasSurface(surfaces, target.path);

  // Soft pin does not require live surface to classify as soft.
  if (softAnchor && surface === undefined) {
    return "soft";
  }

  if (surface === undefined) {
    return "unknown";
  }

  const projection = projectComment(thread, surface);
  if (projection.status === "missing") {
    return null;
  }
  if (projection.status === "located") {
    if (target.anchorId !== undefined) {
      return "located";
    }
    if (softAnchor) {
      return "soft";
    }
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
  const canvasSurfaces = options?.canvasSurfaces;
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
      const status = canvasProcessableStatus(thread, canvasSurfaces);
      if (status === null) {
        continue;
      }
      pushLiveBodies(thread, (commentId, body) => {
        items.push({
          body,
          commentId,
          kind: "canvas",
          path: target.path,
          status,
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

export {
  formatCommentsForComposer,
  mergeComposerText,
  processableItemAnchorLabel,
  processableItemLocationText,
} from "./processable-format.ts";
