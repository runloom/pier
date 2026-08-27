import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { orderReviewPresentationSlots } from "../document/presentation-order.ts";
import { reviewTreeSectionKeyForSurface } from "../document/projection-index.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import {
  reviewGroupsForSurface,
  reviewSurfaceForGroup,
} from "../surface-group.ts";

/**
 * 行内评论导航目标（仅 git-diff 且仍有存活评论）。
 * sectionKey 已按当前阅读面解析；视口内 scrollToLine，否则 tree open + reveal。
 */
export interface ReviewCommentNavTarget {
  readonly commentId: string;
  readonly entryKey: string;
  readonly group: GitReviewGroup;
  readonly line: number;
  readonly path: string;
  readonly sectionKey: string;
  readonly side: "new" | "old";
  readonly threadId: string;
}

/**
 * 按文件树顺序 → 行号 → side（old 先于 new）排列当前阅读面的可导航评论。
 * 解析不到 section 的线程跳过（入口文件已不在 index）。
 */
export function buildReviewCommentNavTargets(options: {
  readonly collidingFileLabel?: (name: string) => string;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly surface: GitReviewReadingSurface;
  readonly threads: readonly CommentThread[] | null;
}): readonly ReviewCommentNavTarget[] {
  if (options.threads === null || options.threads.length === 0) {
    return [];
  }
  const entryByPath = new Map(
    options.entries.map((entry) => [entry.path, entry] as const)
  );
  // Same presentation ledger as tree / CodeView (displayPath + group order).
  const orderedSlots = orderReviewPresentationSlots(options.entries, {
    ...(options.collidingFileLabel === undefined
      ? {}
      : { collidingFileLabel: options.collidingFileLabel }),
    groups: reviewGroupsForSurface(options.surface),
  });
  const sectionOrder = new Map(
    orderedSlots.map((slot, index) => [slot.sectionKey, index] as const)
  );
  const targets: ReviewCommentNavTarget[] = [];
  for (const thread of options.threads) {
    if (thread.target.kind !== "git-diff") {
      continue;
    }
    if (reviewSurfaceForGroup(thread.target.group) !== options.surface) {
      continue;
    }
    const live = thread.comments.find(
      (comment) => comment.deletedAt === undefined
    );
    if (live === undefined) {
      continue;
    }
    const entry = entryByPath.get(thread.target.path);
    if (entry === undefined) {
      continue;
    }
    const sectionKey = reviewTreeSectionKeyForSurface(entry, options.surface);
    if (sectionKey === null) {
      continue;
    }
    targets.push({
      commentId: live.id,
      entryKey: entry.entryKey,
      group: thread.target.group,
      line: thread.target.line,
      path: thread.target.path,
      sectionKey,
      side: thread.target.side,
      threadId: thread.id,
    });
  }
  targets.sort((left, right) => {
    const leftOrder =
      sectionOrder.get(left.sectionKey) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      sectionOrder.get(right.sectionKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.side === right.side) {
      return left.threadId.localeCompare(right.threadId);
    }
    return left.side === "old" ? -1 : 1;
  });
  return targets;
}

export function mapCommentSideToDiffView(
  side: "new" | "old"
): "additions" | "deletions" {
  return side === "old" ? "deletions" : "additions";
}

/** Minimal CodeView surface used by comment n/N (avoids importing the full handle). */
export interface ReviewCommentNavRevealHandle {
  isItemVisible(id: string): boolean;
  scrollToLine(
    id: string,
    lineNumber: number,
    side?: "additions" | "deletions"
  ): boolean;
}

/**
 * In-place `scrollToLine` is only safe when the target file is already in the
 * viewport with measured geometry. `getItem` / `scrollToLine` succeeding is
 * not enough: after tree-navigating to another file the comment section often
 * remains in the virtualizer as an estimate, so a one-shot line scroll misses
 * until hydrate. Off-screen targets go through tree open + pending_scroll.
 */
export function revealReviewCommentNavTarget(input: {
  readonly handle: ReviewCommentNavRevealHandle | null;
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: { readonly line: number; readonly side: "new" | "old" }
  ) => void;
  readonly target: ReviewCommentNavTarget;
}): void {
  const { handle, onRequestTreeOpen, target } = input;
  const side = mapCommentSideToDiffView(target.side);
  if (
    handle?.isItemVisible(target.sectionKey) === true &&
    handle.scrollToLine(target.sectionKey, target.line, side) === true
  ) {
    return;
  }
  onRequestTreeOpen(target.entryKey, target.sectionKey, target.group, {
    line: target.line,
    side: target.side,
  });
}
