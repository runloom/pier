import type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
} from "@pier/ui/diff-view/index.tsx";
import {
  lineInHunkRanges,
  parseHunkLineRanges,
} from "@shared/comments/hunk-ranges.ts";
import { parseBlobOidForSide } from "@shared/comments/patch-blob.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { GitReviewGroup } from "@shared/contracts/git-review/primitives.ts";

/**
 * 项目评论线程索引：把 CommentProjectSnapshot.threads 投影成 packages/ui
 * 通用层线程，按 (group, path) 索引 git-diff 行内候选 + 按 path 索引 git-file
 * 文件级线程，供 diff 装配查询。
 *
 * 装配点 {@link projectLoadedReviewDocumentResource} 按 section 的 (group, path)
 * 调 get() 取该文件 git-diff 行内候选，经 {@link classifyInlineDrift} 用 patch
 * hunk 行范围分类：范围内 → reviewComments（行内）；范围外 → driftComments
 * （漂移，带原 line/side）。getFileDrift() 取 git-file 文件级线程 → driftComments
 * （无 anchor）。注入 PierDiffViewItem.reviewComments / driftComments。
 *
 * v1 瘦身：每锚点一条有效评论；全删线程跳过；无 state/count 字段。
 * - side 映射：target.side "old" → "deletions"，"new" → "additions"。
 * - git-file 文件级评论无 group/line/side，按 path 索引。
 */
export interface ReviewCommentIndex {
  get(
    group: GitReviewGroup,
    path: string
  ): readonly PierDiffReviewCommentThread[];
  /** 该 path 的 git-file 文件级线程（无 anchor），注入 driftComments。 */
  getFileDrift(path: string): readonly PierDiffReviewDriftThread[];
  /** 被索引的 git-diff (group, path) 条目数；0 表示无行内评论，装配点据此短路。 */
  readonly size: number;
}

const EMPTY_INLINE: readonly PierDiffReviewCommentThread[] = Object.freeze([]);
const EMPTY_DRIFT: readonly PierDiffReviewDriftThread[] = Object.freeze([]);

function reviewCommentKey(group: GitReviewGroup, path: string): string {
  // null 分隔符避免 path 含冒号与 group 冲突。
  return `${group}\0${path}`;
}

function hasLiveComment(thread: CommentThread): boolean {
  return thread.comments.some((comment) => comment.deletedAt === undefined);
}

function pushEntry<T>(map: Map<string, T[]>, key: string, entry: T): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [entry]);
  } else {
    list.push(entry);
  }
}

export function indexReviewComments(
  threads: readonly CommentThread[]
): ReviewCommentIndex {
  const byKey = new Map<string, PierDiffReviewCommentThread[]>();
  const fileByKey = new Map<string, PierDiffReviewDriftThread[]>();
  for (const thread of threads) {
    if (!hasLiveComment(thread)) {
      continue;
    }
    if (thread.target.kind === "git-diff") {
      const target = thread.target;
      const entry: PierDiffReviewCommentThread = {
        ...(target.blobOid === undefined ? {} : { blobOid: target.blobOid }),
        line: target.line,
        side: target.side === "old" ? "deletions" : "additions",
        threadId: thread.id,
      };
      pushEntry(byKey, reviewCommentKey(target.group, target.path), entry);
    } else if (thread.target.kind === "git-file") {
      const entry: PierDiffReviewDriftThread = {
        threadId: thread.id,
      };
      pushEntry(fileByKey, thread.target.path, entry);
    }
  }
  return {
    get(group, path) {
      return byKey.get(reviewCommentKey(group, path)) ?? EMPTY_INLINE;
    },
    getFileDrift(path) {
      return fileByKey.get(path) ?? EMPTY_DRIFT;
    },
    size: byKey.size,
  };
}

/** Re-export shared hunk parser for existing tests / call sites. */
export { parseHunkLineRanges } from "@shared/comments/hunk-ranges.ts";

/**
 * 分类 git-diff 行内候选：
 * - hunk 范围内且（无 blobOid，或当前 patch 可解析且与存储一致）→ inline
 * - 有存储 blobOid 但当前 index 不可解 → drift（不可验证 = 不空挂）
 * - 否则 → drift（out-of-range / blob-mismatch）
 *
 * 空输入直接返回（避免空 patch 误判全漂移：estimate 阶段 patch 为空时
 * 调用方应跳过分类，全行内乐观——见 resource-projection 装配）。
 */
export function classifyInlineDrift(
  inline: readonly PierDiffReviewCommentThread[],
  patch: string
): {
  readonly inline: PierDiffReviewCommentThread[];
  readonly drift: PierDiffReviewDriftThread[];
} {
  if (inline.length === 0) {
    return { drift: [], inline: [] };
  }
  const ranges = parseHunkLineRanges(patch);
  const matched: PierDiffReviewCommentThread[] = [];
  const drift: PierDiffReviewDriftThread[] = [];
  for (const thread of inline) {
    if (!lineInHunkRanges(thread.line, thread.side, ranges)) {
      drift.push({
        line: thread.line,
        side: thread.side,
        threadId: thread.threadId,
      });
      continue;
    }
    if (thread.blobOid !== undefined) {
      const side = thread.side === "deletions" ? "old" : "new";
      const current = parseBlobOidForSide(patch, side);
      // Stored fingerprint without a verifiable current blob is not a match.
      if (current === undefined || current !== thread.blobOid) {
        drift.push({
          line: thread.line,
          side: thread.side,
          threadId: thread.threadId,
        });
        continue;
      }
    }
    matched.push(thread);
  }
  return { drift, inline: matched };
}
