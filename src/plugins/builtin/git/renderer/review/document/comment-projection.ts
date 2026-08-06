import type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
} from "@pier/ui/diff-view/index.tsx";
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

/** patch hunk header 行范围（闭区间 [start, end]）。 */
type LineRange = readonly [number, number];

/** hunk 行范围集合（old/new 两侧），漂移判定与范围查询共享。 */
interface HunkLineRanges {
  readonly new: readonly LineRange[];
  readonly old: readonly LineRange[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/**
 * 解析 patch 的 hunk headers 得到 old/new 行范围集合（git hunk 格式：
 * `@@ -oldStart,oldLen +newStart,newLen @@`，len 缺省为 1）。
 *
 * 行内评论 anchor.line 在对应 side 的任一 hunk 范围内 → 匹配；否则漂移。
 * 注意 hunk 范围含 context 行（评论可锚 context 行）；hunk 之间的 unchanged
 * 行不进 diff-view 渲染，锚这些行的评论也判漂移。
 */
export function parseHunkLineRanges(patch: string): HunkLineRanges {
  const oldRanges: LineRange[] = [];
  const newRanges: LineRange[] = [];
  for (const match of patch.matchAll(HUNK_HEADER)) {
    const oldStart = Number(match[1]);
    const oldLen = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLen = match[4] === undefined ? 1 : Number(match[4]);
    oldRanges.push([oldStart, oldStart + oldLen - 1]);
    newRanges.push([newStart, newStart + newLen - 1]);
  }
  return { new: newRanges, old: oldRanges };
}

function lineInRange(
  line: number,
  side: "additions" | "deletions",
  ranges: HunkLineRanges
): boolean {
  const rangesForSide = side === "deletions" ? ranges.old : ranges.new;
  return rangesForSide.some(([start, end]) => line >= start && line <= end);
}

/**
 * 分类 git-diff 行内候选：patch hunk 范围内 → inline（行内 reviewComments）；
 * 范围外 → drift（漂移 driftComments，带原 line/side）。
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
    if (lineInRange(thread.line, thread.side, ranges)) {
      matched.push(thread);
    } else {
      drift.push({
        line: thread.line,
        side: thread.side,
        threadId: thread.threadId,
      });
    }
  }
  return { drift, inline: matched };
}
