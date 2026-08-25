/**
 * 可处理评论投影（canvas + markdown open-preview 表面）的共享读取层。
 * 终端评论弹窗的列表与「提交并清除」必须走同一投影，保证列表状态与
 * 写入智能体输入框的状态一致。
 */

import {
  getCanvasCommentSurfaces,
  getCanvasCommentSurfacesRevision,
  onCanvasCommentSurfacesChanged,
} from "@plugins/api/canvas-comment-surfaces.ts";
import {
  getMarkdownCommentSurfaces,
  getMarkdownCommentSurfacesRevision,
  onMarkdownCommentSurfacesChanged,
} from "@plugins/api/markdown-comment-surfaces.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import { useMemo, useSyncExternalStore } from "react";
import {
  listProcessableComments,
  type ProcessableCommentItem,
} from "./processable.ts";

/**
 * Always pass the current surface maps (may be empty). Empty ≠ omit:
 * omit used to mean "no options" but we still want unknown vs soft/located.
 */
export function projectProcessableComments(
  threads: readonly CommentThread[] | undefined,
  livePaths: ReadonlySet<string> | null
): ProcessableCommentItem[] {
  return listProcessableComments(threads, {
    canvasSurfaces: getCanvasCommentSurfaces(),
    markdownSurfaces: getMarkdownCommentSurfaces(),
    ...(livePaths === null ? {} : { livePaths }),
  });
}

/** Reactive processable items: re-projects when open-preview surfaces change. */
export function useProcessableCommentItems(
  threads: readonly CommentThread[] | undefined,
  livePaths: ReadonlySet<string> | null
): ProcessableCommentItem[] {
  const canvasSurfacesRevision = useSyncExternalStore(
    onCanvasCommentSurfacesChanged,
    getCanvasCommentSurfacesRevision,
    () => 0
  );
  const markdownSurfacesRevision = useSyncExternalStore(
    onMarkdownCommentSurfacesChanged,
    getMarkdownCommentSurfacesRevision,
    () => 0
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision drives re-read of module map
  return useMemo(
    () => projectProcessableComments(threads, livePaths),
    [canvasSurfacesRevision, livePaths, markdownSurfacesRevision, threads]
  );
}
