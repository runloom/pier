/**
 * Markdown 预览评论：订阅快照、投影、写操作、草稿槽。
 */
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import {
  clearMarkdownCommentSurface,
  setMarkdownCommentSurface,
} from "@plugins/api/markdown-comment-surfaces.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { MarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { CommentProjectSnapshot } from "@shared/contracts/comments/document.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarkdownBlock, MarkdownIrDocument } from "../ir.ts";
import { buildMarkdownCommentSurfaceFromIr } from "./surface.ts";
import {
  blockCommentKey,
  buildMarkdownCommentTarget,
  contentHashForBlock,
  markdownCommentMarkerIndexes,
  nearestHeadingIdsByBlockIndex,
  resolveMarkdownCommentBlockKey,
} from "./target.ts";

function projectMarkdownThread(
  thread: CommentThread,
  surface: MarkdownCommentSurface
): "located" | "drifted" | "missing" {
  if (thread.target.kind !== "markdown") {
    return "drifted";
  }
  if (!surface.filePresent) {
    return "missing";
  }
  const { target } = thread;
  if (
    target.headingId !== undefined &&
    surface.headingIds.has(target.headingId)
  ) {
    return "located";
  }
  if (surface.blockHashes.has(target.contentHash)) {
    return "located";
  }
  return "drifted";
}

export type MarkdownCommentLabels = PierInlineReviewLabels & {
  readonly addComment: string;
  readonly createFailed: string;
  readonly deleteFailed: string;
  readonly driftTitle: string;
  readonly updateFailed: string;
};

export interface MarkdownLocatedComment {
  readonly blockKey: string;
  readonly threads: readonly PierInlineReviewThread[];
}

export interface MarkdownDriftComment {
  readonly excerpt: string;
  readonly thread: PierInlineReviewThread;
  readonly threadId: string;
}

/** Ordered targets for the floating markdown comment navigator. */
export interface MarkdownCommentNavTarget {
  readonly blockKey?: string;
  readonly commentId: string;
  readonly kind: "located" | "drift";
  readonly threadId: string;
}

function liveComment(thread: CommentThread) {
  return thread.comments.find((c) => c.deletedAt === undefined);
}

function toInlineThread(
  thread: CommentThread,
  youLabel: string
): PierInlineReviewThread | null {
  const live = liveComment(thread);
  if (!live) {
    return null;
  }
  const authorLabel =
    live.author.kind === "user" ? youLabel : live.author.displayName;
  return {
    comment: {
      authorLabel,
      body: live.body,
      createdAt: live.createdAt,
      id: live.id,
      ...(live.deletedAt === undefined ? {} : { deletedAt: live.deletedAt }),
    },
    threadId: thread.id,
  };
}

export function useMarkdownPreviewComments(input: {
  readonly context: RendererPluginContext | undefined;
  readonly document: MarkdownIrDocument | undefined;
  readonly labels: MarkdownCommentLabels;
  readonly path: string | undefined;
  readonly worktreeKey: string | undefined;
}): {
  readonly draftBlockKey: string | null;
  readonly driftComments: readonly MarkdownDriftComment[];
  readonly handlers: PierInlineReviewHandlers;
  readonly locatedByBlockKey: ReadonlyMap<string, MarkdownLocatedComment>;
  readonly navTargets: readonly MarkdownCommentNavTarget[];
  readonly openDraftForBlockKey: (blockKey: string) => void;
  readonly surfaceReady: boolean;
  readonly threadsHydrated: boolean;
} {
  const { context, document, labels, path, worktreeKey } = input;
  const [snapshot, setSnapshot] = useState<CommentProjectSnapshot | null>(null);
  const [draftBlockKey, setDraftBlockKey] = useState<string | null>(null);
  const [draftTargetByKey, setDraftTargetByKey] = useState(
    () => new Map<string, ReturnType<typeof buildMarkdownCommentTarget>>()
  );

  useEffect(() => {
    if (!(context && worktreeKey)) {
      setSnapshot(null);
      return;
    }
    let disposed = false;
    setSnapshot(null);
    const apply = (snap: CommentProjectSnapshot): void => {
      if (disposed) {
        return;
      }
      setSnapshot((prev) =>
        prev !== null && snap.seq < prev.seq ? prev : snap
      );
    };
    // Comments must never blank the preview: capability / IPC failures stay soft.
    try {
      context.comments
        .snapshot(worktreeKey)
        .then((snap) => {
          if (snap !== null) {
            apply(snap);
          }
        })
        .catch(() => undefined);
      const dispose = context.comments.watch(worktreeKey, apply);
      return () => {
        disposed = true;
        dispose();
      };
    } catch {
      setSnapshot(null);
      return () => {
        disposed = true;
      };
    }
  }, [context, worktreeKey]);

  const surface = useMemo(
    () =>
      document === undefined
        ? undefined
        : buildMarkdownCommentSurfaceFromIr(document),
    [document]
  );
  // Publish the live surface so the terminal comments dialog can verify
  // markdown threads (located/stale) instead of degrading every row to unknown.
  useEffect(() => {
    if (!(path && surface)) {
      return;
    }
    setMarkdownCommentSurface(path, surface);
    return () => {
      clearMarkdownCommentSurface(path);
    };
  }, [path, surface]);

  const pathThreads = useMemo(() => {
    if (!(snapshot && path)) {
      return [] as CommentThread[];
    }
    return snapshot.threads.filter(
      (thread) =>
        thread.target.kind === "markdown" && thread.target.path === path
    );
  }, [path, snapshot]);

  const blockKeyByHash = useMemo(() => {
    const map = new Map<string, string>();
    if (!document) {
      return map;
    }
    for (const block of document.blocks) {
      const target = buildMarkdownCommentTarget({
        block,
        path: path ?? "",
      });
      if (target) {
        map.set(target.contentHash, blockCommentKey(block));
      }
    }
    return map;
  }, [document, path]);

  const { locatedByBlockKey, driftComments } = useMemo(() => {
    const located = new Map<string, MarkdownLocatedComment>();
    const drift: MarkdownDriftComment[] = [];
    if (!surface) {
      return { locatedByBlockKey: located, driftComments: drift };
    }
    for (const thread of pathThreads) {
      if (thread.target.kind !== "markdown") {
        continue;
      }
      const target = thread.target;
      const inline = toInlineThread(thread, labels.authorYou);
      if (!inline) {
        continue;
      }
      const status = projectMarkdownThread(thread, surface);
      if (status === "located") {
        // contentHash 优先：段评不得因 nearest headingId 挂到章节标题顶。
        const blockKey = resolveMarkdownCommentBlockKey({
          blockKeyByHash,
          blocks: document?.blocks ?? [],
          contentHash: target.contentHash,
          headingId: target.headingId,
        });
        if (blockKey !== undefined) {
          const existing = located.get(blockKey);
          if (existing) {
            located.set(blockKey, {
              blockKey,
              threads: [...existing.threads, inline],
            });
          } else {
            located.set(blockKey, { blockKey, threads: [inline] });
          }
          continue;
        }
      }
      if (status !== "missing") {
        drift.push({
          excerpt: target.excerpt,
          thread: inline,
          threadId: thread.id,
        });
      }
    }
    return { locatedByBlockKey: located, driftComments: drift };
  }, [
    blockKeyByHash,
    document?.blocks,
    labels.authorYou,
    pathThreads,
    surface,
  ]);

  const reportFailure = useCallback(
    (title: string, result: { message?: string | null }) => {
      if (!context) {
        return;
      }
      context.dialogs
        .alert({
          title,
          ...(result.message ? { body: result.message } : {}),
        })
        .catch(() => undefined);
    },
    [context]
  );

  const openDraft = useCallback(
    (_blockKey: string, block?: MarkdownBlock, nearestHeadingId?: string) => {
      if (!(path && block)) {
        return;
      }
      const target = buildMarkdownCommentTarget({
        block,
        nearestHeadingId,
        path,
      });
      if (!target) {
        return;
      }
      // Draft id = contentHash so reparse (offset shift) keeps the editor mounted.
      const draftId = target.contentHash;
      setDraftTargetByKey((prev) => {
        const next = new Map(prev);
        next.set(draftId, target);
        return next;
      });
      setDraftBlockKey(draftId);
    },
    [path]
  );

  const handlers: PierInlineReviewHandlers = useMemo(
    () => ({
      onCancelDraft: (draftId) => {
        setDraftBlockKey((current) => (current === draftId ? null : current));
        setDraftTargetByKey((prev) => {
          if (!prev.has(draftId)) {
            return prev;
          }
          const next = new Map(prev);
          next.delete(draftId);
          return next;
        });
      },
      onDeleteComment: async (threadId, commentId) => {
        if (!(context && worktreeKey)) {
          return false;
        }
        const result = await context.comments.deleteComment({
          commentId,
          threadId,
          worktreeKey,
        });
        if (result.kind === "error") {
          reportFailure(labels.deleteFailed, result);
          return false;
        }
        return true;
      },
      onEditComment: async (threadId, commentId, body) => {
        if (!(context && worktreeKey) || body.trim().length === 0) {
          return false;
        }
        const result = await context.comments.updateComment({
          body,
          commentId,
          threadId,
          worktreeKey,
        });
        if (result.kind === "error") {
          reportFailure(labels.updateFailed, result);
          return false;
        }
        return true;
      },
      onSubmitDraft: async (draftId, body) => {
        if (!(context && worktreeKey) || body.trim().length === 0) {
          return false;
        }
        const target = draftTargetByKey.get(draftId);
        if (!target) {
          return false;
        }
        const result = await context.comments.createThread({
          author: { kind: "user" },
          body,
          target,
          worktreeKey,
        });
        if (result.kind === "error") {
          reportFailure(labels.createFailed, result);
          return false;
        }
        setDraftBlockKey((current) => (current === draftId ? null : current));
        setDraftTargetByKey((prev) => {
          const next = new Map(prev);
          next.delete(draftId);
          return next;
        });
        return true;
      },
    }),
    [
      context,
      draftTargetByKey,
      labels.createFailed,
      labels.deleteFailed,
      labels.updateFailed,
      reportFailure,
      worktreeKey,
    ]
  );

  const openDraftForBlockKey = useCallback(
    (blockKey: string) => {
      if (!document) {
        return;
      }
      const index = document.blocks.findIndex(
        (block) => blockCommentKey(block) === blockKey
      );
      if (index < 0) {
        return;
      }
      const block = document.blocks[index];
      if (!block || contentHashForBlock(block) === null) {
        return;
      }
      const nearest = nearestHeadingIdsByBlockIndex(document.blocks)[index];
      openDraft(blockKey, block, nearest);
    },
    [document, openDraft]
  );

  /** Ordered live comments on this path (located then drift) for floating nav. */
  const navTargets = useMemo((): MarkdownCommentNavTarget[] => {
    const targets: MarkdownCommentNavTarget[] = [];
    const blocks = document?.blocks ?? [];
    const markerIndexes = markdownCommentMarkerIndexes(
      blocks,
      locatedByBlockKey
    );
    for (const block of blocks) {
      const blockKey = blockCommentKey(block);
      if (!markerIndexes.has(blockKey)) {
        continue;
      }
      const entry = locatedByBlockKey.get(blockKey);
      if (entry === undefined) {
        continue;
      }
      for (const thread of entry.threads) {
        targets.push({
          blockKey: entry.blockKey,
          commentId: thread.comment.id,
          kind: "located",
          threadId: thread.threadId,
        });
      }
    }
    for (const item of driftComments) {
      targets.push({
        commentId: item.thread.comment.id,
        kind: "drift",
        threadId: item.threadId,
      });
    }
    return targets;
  }, [document?.blocks, driftComments, locatedByBlockKey]);

  return {
    draftBlockKey,
    driftComments,
    handlers,
    locatedByBlockKey,
    navTargets,
    openDraftForBlockKey,
    surfaceReady: surface !== undefined,
    threadsHydrated: snapshot !== null,
  };
}
