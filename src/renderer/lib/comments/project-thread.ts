/**
 * 评论线程投影：纯函数，不写盘。
 * 设计 2026-08-11：located | drifted | missing；无确定性证据不得 located。
 */
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import {
  lineInHunkRanges,
  parseBlobOidForSide,
  parseHunkLineRangesFromPatch,
} from "./project-thread-git.ts";

export type CommentProjectionStatus = "located" | "drifted" | "missing";

export type CommentProjectionReason =
  | "content-changed"
  | "out-of-range"
  | "blob-mismatch"
  | "anchor-gone"
  | "file-gone"
  | "path-not-in-live-set"
  | "no-surface";

export type CommentLocateKind =
  | "git-line"
  | "git-file"
  | "markdown-heading"
  | "markdown-block"
  | "canvas-file"
  | "canvas-anchor";

export interface CommentProjection {
  readonly locate?: {
    readonly kind: CommentLocateKind;
    readonly headingId?: string;
    readonly line?: number;
    readonly side?: "new" | "old";
    readonly anchorId?: string;
    readonly path?: string;
  };
  readonly reason?: CommentProjectionReason;
  readonly status: CommentProjectionStatus;
}

export interface GitDiffProjectionSurface {
  readonly kind: "git-diff";
  readonly patch: string;
}

export interface GitFileProjectionSurface {
  readonly kind: "git-file";
  /** 当前 review / 变更中仍存在该 path（或 oldPath）。 */
  readonly pathPresent: boolean;
}

/** 与 shared `MarkdownCommentSurface` 同形，便于 files 插件构建后直接投影。 */
export interface MarkdownProjectionSurface {
  /** 规范化后块文本 hash 集合。 */
  readonly blockHashes: ReadonlySet<string>;
  readonly filePresent: boolean;
  readonly headingIds: ReadonlySet<string>;
  readonly kind: "markdown";
}

export interface CanvasProjectionSurface {
  /** 运行时仍存在的声明式节点 id；文件级评论忽略。 */
  readonly anchorIds?: ReadonlySet<string>;
  readonly filePresent: boolean;
  readonly kind: "canvas";
}

export type CommentProjectionSurface =
  | GitDiffProjectionSurface
  | GitFileProjectionSurface
  | MarkdownProjectionSurface
  | CanvasProjectionSurface;

function located(
  locate: NonNullable<CommentProjection["locate"]>
): CommentProjection {
  return { status: "located", locate };
}

function drifted(reason: CommentProjectionReason): CommentProjection {
  return { status: "drifted", reason };
}

function missing(reason: CommentProjectionReason): CommentProjection {
  return { status: "missing", reason };
}

function projectGitDiff(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "git-diff" }>;
  },
  surface: GitDiffProjectionSurface | undefined
): CommentProjection {
  const { target } = thread;
  if (surface === undefined) {
    return drifted("no-surface");
  }
  const ranges = parseHunkLineRangesFromPatch(surface.patch);
  const diffSide = target.side === "old" ? "deletions" : "additions";
  if (!lineInHunkRanges(target.line, diffSide, ranges)) {
    return drifted("out-of-range");
  }
  if (target.blobOid !== undefined) {
    const current = parseBlobOidForSide(surface.patch, target.side);
    // Stored fingerprint without a verifiable current blob is not a match.
    if (current === undefined || current !== target.blobOid) {
      return drifted("blob-mismatch");
    }
  }
  return located({
    kind: "git-line",
    line: target.line,
    path: target.path,
    side: target.side,
  });
}

function projectGitFile(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "git-file" }>;
  },
  surface: GitFileProjectionSurface | undefined
): CommentProjection {
  if (surface === undefined) {
    return drifted("no-surface");
  }
  if (!surface.pathPresent) {
    return missing("file-gone");
  }
  return located({ kind: "git-file", path: thread.target.path });
}

function projectMarkdown(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "markdown" }>;
  },
  surface: MarkdownProjectionSurface | undefined
): CommentProjection {
  const { target } = thread;
  if (surface === undefined) {
    return drifted("no-surface");
  }
  if (!surface.filePresent) {
    return missing("file-gone");
  }
  if (
    target.headingId !== undefined &&
    surface.headingIds.has(target.headingId)
  ) {
    return located({
      kind: "markdown-heading",
      headingId: target.headingId,
      path: target.path,
    });
  }
  if (surface.blockHashes.has(target.contentHash)) {
    return located({ kind: "markdown-block", path: target.path });
  }
  return drifted("content-changed");
}

function projectCanvas(
  thread: CommentThread & {
    target: Extract<CommentThread["target"], { kind: "canvas" }>;
  },
  surface: CanvasProjectionSurface | undefined
): CommentProjection {
  const { target } = thread;
  if (surface === undefined) {
    return drifted("no-surface");
  }
  if (!surface.filePresent) {
    return missing("file-gone");
  }
  if (target.anchorId === undefined) {
    return located({ kind: "canvas-file", path: target.path });
  }
  if (surface.anchorIds?.has(target.anchorId) === true) {
    return located({
      kind: "canvas-anchor",
      anchorId: target.anchorId,
      path: target.path,
    });
  }
  return drifted("anchor-gone");
}

/**
 * 将线程投影到当前表面。surface 的 kind 应与 target.kind 对应；
 * 不匹配或缺失时 git/md/canvas 走 no-surface / 对应分支。
 */
export function projectComment(
  thread: CommentThread,
  surface?: CommentProjectionSurface
): CommentProjection {
  switch (thread.target.kind) {
    case "git-diff":
      return projectGitDiff(
        thread as CommentThread & {
          target: Extract<CommentThread["target"], { kind: "git-diff" }>;
        },
        surface?.kind === "git-diff" ? surface : undefined
      );
    case "git-file":
      return projectGitFile(
        thread as CommentThread & {
          target: Extract<CommentThread["target"], { kind: "git-file" }>;
        },
        surface?.kind === "git-file" ? surface : undefined
      );
    case "markdown":
      return projectMarkdown(
        thread as CommentThread & {
          target: Extract<CommentThread["target"], { kind: "markdown" }>;
        },
        surface?.kind === "markdown" ? surface : undefined
      );
    case "canvas":
      return projectCanvas(
        thread as CommentThread & {
          target: Extract<CommentThread["target"], { kind: "canvas" }>;
        },
        surface?.kind === "canvas" ? surface : undefined
      );
    default: {
      // Exhaustiveness: all CommentTarget kinds handled above.
      return drifted("content-changed");
    }
  }
}
