/**
 * Canvas 预览评论（Orca Design Mode 主路径）：
 * - 文件级：工具栏添加
 * - 节点级：点选预览内 DOM → 快照 label/excerpt，可选 anchorId
 * - 无 id 的评论永不钉在随机组件上
 */
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import {
  clearCanvasCommentSurface,
  setCanvasCommentSurface,
} from "@plugins/api/canvas-comment-surfaces.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  CANVAS_COMMENT_ANCHOR_ATTR,
  collectCanvasCommentAnchorIds,
} from "@shared/comments/canvas-anchor.ts";
import { buildCanvasCommentSurface } from "@shared/comments/canvas-surface.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type { CommentProjectSnapshot } from "@shared/contracts/comments/document.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasElementPick } from "./canvas-element-pick.ts";

export type CanvasCommentLabels = PierInlineReviewLabels & {
  readonly addComment: string;
  readonly annotate: string;
  readonly annotateActive: string;
  readonly createFailed: string;
  readonly deleteFailed: string;
  readonly empty: string;
  readonly fileLevel: string;
  readonly nodeLevel: string;
  readonly updateFailed: string;
};

export type CanvasCommentThreadView = PierInlineReviewThread & {
  readonly anchorId?: string;
  readonly label?: string;
};

export const CANVAS_FILE_DRAFT_ID = "canvas-file-draft";
export const CANVAS_PICK_DRAFT_ID = "canvas-pick-draft";

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

export function useCanvasPreviewComments(input: {
  readonly anchorIds: ReadonlySet<string>;
  readonly context: RendererPluginContext | undefined;
  readonly labels: CanvasCommentLabels;
  readonly path: string | undefined;
  readonly worktreeKey: string | undefined;
}): {
  readonly draftOpen: boolean;
  readonly draftPick: CanvasElementPick | null;
  readonly driftNodeThreads: readonly CanvasCommentThreadView[];
  readonly fileThreads: readonly CanvasCommentThreadView[];
  readonly handlers: PierInlineReviewHandlers;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly openFileDraft: () => void;
  readonly openPickDraft: (pick: CanvasElementPick) => void;
  readonly pickMode: boolean;
  /** Node picks without a declared anchorId (list only, no badge). */
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly setPickMode: (on: boolean) => void;
  readonly threadsHydrated: boolean;
} {
  const { anchorIds, context, labels, path, worktreeKey } = input;
  const [snapshot, setSnapshot] = useState<CommentProjectSnapshot | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPick, setDraftPick] = useState<CanvasElementPick | null>(null);
  const [pickMode, setPickMode] = useState(false);

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

  useEffect(() => {
    if (!path) {
      return;
    }
    setCanvasCommentSurface(
      path,
      buildCanvasCommentSurface({
        anchorIds,
        filePresent: true,
      })
    );
    return () => {
      clearCanvasCommentSurface(path);
    };
  }, [anchorIds, path]);

  const {
    fileThreads,
    locatedByAnchorId,
    driftNodeThreads,
    pickedNodeThreads,
  } = useMemo(() => {
    const file: CanvasCommentThreadView[] = [];
    const byAnchor = new Map<string, CanvasCommentThreadView[]>();
    const drift: CanvasCommentThreadView[] = [];
    const picked: CanvasCommentThreadView[] = [];
    if (!(snapshot && path)) {
      return {
        fileThreads: file,
        locatedByAnchorId: byAnchor,
        driftNodeThreads: drift,
        pickedNodeThreads: picked,
      };
    }
    for (const thread of snapshot.threads) {
      if (thread.target.kind !== "canvas" || thread.target.path !== path) {
        continue;
      }
      const inline = toInlineThread(thread, labels.authorYou);
      if (!inline) {
        continue;
      }
      const anchorId = thread.target.anchorId;
      const view: CanvasCommentThreadView = {
        ...inline,
        ...(anchorId === undefined ? {} : { anchorId }),
        ...(thread.target.label === undefined
          ? {}
          : { label: thread.target.label }),
      };
      if (anchorId === undefined) {
        // Design Mode pick without declared id → node list by label; else file.
        if (thread.target.label === undefined) {
          file.push(view);
        } else {
          picked.push(view);
        }
        continue;
      }
      // Only pin in-place when the declared id is still in the live DOM.
      if (anchorIds.has(anchorId)) {
        const list = byAnchor.get(anchorId) ?? [];
        list.push(view);
        byAnchor.set(anchorId, list);
      } else {
        drift.push(view);
      }
    }
    return {
      fileThreads: file,
      locatedByAnchorId: byAnchor,
      driftNodeThreads: drift,
      pickedNodeThreads: picked,
    };
  }, [anchorIds, labels.authorYou, path, snapshot]);

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

  const closeDraft = useCallback(() => {
    setDraftOpen(false);
    setDraftPick(null);
  }, []);

  const handlers: PierInlineReviewHandlers = useMemo(
    () => ({
      onCancelDraft: (draftId) => {
        if (
          draftId === CANVAS_FILE_DRAFT_ID ||
          draftId === CANVAS_PICK_DRAFT_ID
        ) {
          closeDraft();
        }
      },
      onDeleteComment: async (threadId, commentId) => {
        if (!(context && worktreeKey)) {
          return;
        }
        const result = await context.comments.deleteComment({
          commentId,
          threadId,
          worktreeKey,
        });
        if (result.kind === "error") {
          reportFailure(labels.deleteFailed, result);
        }
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
        if (
          !(context && worktreeKey && path) ||
          body.trim().length === 0 ||
          (draftId !== CANVAS_FILE_DRAFT_ID && draftId !== CANVAS_PICK_DRAFT_ID)
        ) {
          return false;
        }
        const trimmed = body.trim();
        const pick = draftId === CANVAS_PICK_DRAFT_ID ? draftPick : null;
        const excerpt =
          pick?.excerpt ??
          (trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 199)}…`);
        const result = await context.comments.createThread({
          author: { kind: "user" },
          body: trimmed,
          target: {
            excerpt,
            kind: "canvas",
            path,
            ...(pick?.anchorId === undefined
              ? {}
              : { anchorId: pick.anchorId }),
            ...(pick?.label === undefined ? {} : { label: pick.label }),
          },
          worktreeKey,
        });
        if (result.kind === "error") {
          reportFailure(labels.createFailed, result);
          return false;
        }
        closeDraft();
        // Keep pick mode on after node annotate so users can mark several elements.
        if (draftId === CANVAS_FILE_DRAFT_ID) {
          setPickMode(false);
        }
        return true;
      },
    }),
    [
      closeDraft,
      context,
      draftPick,
      labels.createFailed,
      labels.deleteFailed,
      labels.updateFailed,
      path,
      reportFailure,
      worktreeKey,
    ]
  );

  const openFileDraft = useCallback(() => {
    if (!(path && worktreeKey)) {
      return;
    }
    setDraftPick(null);
    setDraftOpen(true);
    setPickMode(false);
  }, [path, worktreeKey]);

  const openPickDraft = useCallback(
    (pick: CanvasElementPick) => {
      if (!(path && worktreeKey)) {
        return;
      }
      setDraftPick(pick);
      setDraftOpen(true);
      // Keep pickMode so cancel/submit returns to annotate without re-toggling.
    },
    [path, worktreeKey]
  );

  return {
    draftOpen,
    draftPick,
    driftNodeThreads,
    fileThreads,
    handlers,
    locatedByAnchorId,
    openFileDraft,
    openPickDraft,
    pickMode,
    pickedNodeThreads,
    setPickMode,
    threadsHydrated: snapshot !== null,
  };
}

export function useCanvasHostAnchorIds(
  host: HTMLElement | null
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!host) {
      setIds(new Set());
      return;
    }
    const refresh = () => {
      setIds(collectCanvasCommentAnchorIds(host));
    };
    refresh();
    if (typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => {
      refresh();
    });
    observer.observe(host, {
      attributeFilter: [CANVAS_COMMENT_ANCHOR_ATTR],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
    };
  }, [host]);

  return ids;
}
