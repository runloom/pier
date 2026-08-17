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
  normalizeCanvasCommentSurfacePath,
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
import { sortLiveCanvasCommentThreads } from "./canvas-comment-order.ts";
import type { CanvasElementPick } from "./canvas-element-pick.ts";
import { pinPointFromBox } from "./canvas-element-pick.ts";
import {
  type CanvasSoftMarker,
  getCanvasSoftMarkers,
  pruneCanvasSoftMarkers,
  upsertCanvasSoftMarker,
} from "./canvas-soft-markers.ts";

export type { CanvasSoftMarker } from "./canvas-soft-markers.ts";

export type CanvasCommentLabels = PierInlineReviewLabels & {
  readonly addComment: string;
  readonly annotate: string;
  readonly annotateActive: string;
  readonly createFailed: string;
  readonly deleteFailed: string;
  readonly driftTitle: string;
  readonly empty: string;
  readonly fileLevel: string;
  readonly nodeLevel: string;
  readonly updateFailed: string;
};

export type CanvasCommentThreadView = PierInlineReviewThread & {
  readonly anchorId?: string;
  readonly label?: string;
};

/** Draft / soft-pin geometry in canvas shell coordinates. */
export interface CanvasDraftPlacement {
  readonly height: number;
  readonly left: number;
  /** Pointer in shell coords — composer sits beside this, not the box center. */
  readonly originX: number;
  readonly originY: number;
  readonly top: number;
  readonly width: number;
}

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
  readonly draftPlacement: CanvasDraftPlacement | null;
  readonly driftNodeThreads: readonly CanvasCommentThreadView[];
  readonly fileThreads: readonly CanvasCommentThreadView[];
  readonly handlers: PierInlineReviewHandlers;
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  /** All live comments on this canvas path, oldest first. Clear-all uses this set. */
  readonly liveThreads: readonly CanvasCommentThreadView[];
  readonly openPickDraft: (
    pick: CanvasElementPick,
    placement?: CanvasDraftPlacement
  ) => void;
  readonly pickMode: boolean;
  /** Node picks without a declared anchorId (list + soft markers). */
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly setPickMode: (on: boolean) => void;
  /** Session pins for no-id comments (measured at submit). */
  readonly softMarkers: readonly CanvasSoftMarker[];
  readonly threadsHydrated: boolean;
} {
  const { anchorIds, context, labels, path, worktreeKey } = input;
  const [snapshot, setSnapshot] = useState<CommentProjectSnapshot | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPick, setDraftPick] = useState<CanvasElementPick | null>(null);
  const [draftPlacement, setDraftPlacement] =
    useState<CanvasDraftPlacement | null>(null);
  const surfacePath = useMemo(
    () => (path ? normalizeCanvasCommentSurfacePath(path) : ""),
    [path]
  );
  const [softMarkers, setSoftMarkers] = useState<readonly CanvasSoftMarker[]>(
    () => (surfacePath ? getCanvasSoftMarkers(surfacePath) : [])
  );
  const [pickMode, setPickMode] = useState(false);

  // Rehydrate path-keyed soft pins when switching canvas files.
  useEffect(() => {
    if (surfacePath.length === 0) {
      setSoftMarkers([]);
      return;
    }
    setSoftMarkers(getCanvasSoftMarkers(surfacePath));
  }, [surfacePath]);

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
    if (surfacePath.length === 0) {
      return;
    }
    setCanvasCommentSurface(
      surfacePath,
      buildCanvasCommentSurface({
        anchorIds,
        filePresent: true,
      })
    );
    return () => {
      clearCanvasCommentSurface(surfacePath);
    };
  }, [anchorIds, surfacePath]);

  const {
    fileThreads,
    liveThreads,
    locatedByAnchorId,
    driftNodeThreads,
    pickedNodeThreads,
  } = useMemo(() => {
    const file: CanvasCommentThreadView[] = [];
    const live: CanvasCommentThreadView[] = [];
    const byAnchor = new Map<string, CanvasCommentThreadView[]>();
    const picked: CanvasCommentThreadView[] = [];
    if (!(snapshot && surfacePath.length > 0)) {
      return {
        fileThreads: file,
        liveThreads: live,
        locatedByAnchorId: byAnchor,
        driftNodeThreads: [],
        pickedNodeThreads: picked,
      };
    }
    for (const thread of snapshot.threads) {
      if (
        thread.target.kind !== "canvas" ||
        normalizeCanvasCommentSurfacePath(thread.target.path) !== surfacePath
      ) {
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
      live.push(view);
      if (anchorId === undefined) {
        // Design Mode pick without declared id → node list by label; else file.
        if (thread.target.label === undefined) {
          file.push(view);
        } else {
          picked.push(view);
        }
        continue;
      }
      const list = byAnchor.get(anchorId) ?? [];
      list.push(view);
      byAnchor.set(anchorId, list);
    }
    return {
      fileThreads: file,
      liveThreads: sortLiveCanvasCommentThreads(live),
      locatedByAnchorId: byAnchor,
      driftNodeThreads: [],
      pickedNodeThreads: picked,
    };
  }, [labels.authorYou, snapshot, surfacePath]);

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
    setDraftPlacement(null);
  }, []);

  // Drop soft pins when their threads are gone (deleted / path changed).
  useEffect(() => {
    if (!(snapshot && surfacePath.length > 0)) {
      return;
    }
    const liveIds = new Set(
      snapshot.threads
        .filter(
          (thread) =>
            thread.target.kind === "canvas" &&
            normalizeCanvasCommentSurfacePath(thread.target.path) ===
              surfacePath &&
            liveComment(thread) !== undefined
        )
        .map((thread) => thread.id)
    );
    setSoftMarkers(pruneCanvasSoftMarkers(surfacePath, liveIds));
  }, [snapshot, surfacePath]);

  const handlers: PierInlineReviewHandlers = useMemo(
    () => ({
      onCancelDraft: (draftId) => {
        if (draftId === CANVAS_PICK_DRAFT_ID) {
          closeDraft();
        }
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
        if (
          !(context && worktreeKey && path) ||
          body.trim().length === 0 ||
          draftId !== CANVAS_PICK_DRAFT_ID
        ) {
          return false;
        }
        const trimmed = body.trim();
        const pick = draftPick;
        const excerpt =
          pick?.excerpt ??
          (trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 199)}…`);
        const canvasPath = normalizeCanvasCommentSurfacePath(path);
        const result = await context.comments.createThread({
          author: { kind: "user" },
          body: trimmed,
          target: {
            excerpt,
            kind: "canvas",
            path: canvasPath,
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
        // Figma/BugHerd-like: leave a pin at the selection after submit.
        // Declared anchorId uses live DOM; only no-id picks get session soft pins.
        if (
          draftId === CANVAS_PICK_DRAFT_ID &&
          draftPlacement &&
          path &&
          result.kind === "ok" &&
          pick?.anchorId === undefined
        ) {
          // Same corner math as live pins (top-right of measured box).
          const point = pinPointFromBox(draftPlacement);
          const next = upsertCanvasSoftMarker(canvasPath, {
            label: pick?.label ?? labels.title,
            left: point.left,
            threadId: result.threadId,
            top: point.top,
          });
          setSoftMarkers(next);
        }
        closeDraft();
        return true;
      },
    }),
    [
      closeDraft,
      context,
      draftPick,
      draftPlacement,
      labels.createFailed,
      labels.deleteFailed,
      labels.title,
      labels.updateFailed,
      path,
      reportFailure,
      worktreeKey,
    ]
  );

  const openPickDraft = useCallback(
    (pick: CanvasElementPick, placement?: CanvasDraftPlacement) => {
      if (!(path && worktreeKey)) {
        return;
      }
      setDraftPick(pick);
      setDraftPlacement(placement ?? null);
      setDraftOpen(true);
      // Keep pickMode so cancel/submit returns to annotate without re-toggling.
    },
    [path, worktreeKey]
  );

  return {
    draftOpen,
    draftPick,
    draftPlacement,
    driftNodeThreads,
    fileThreads,
    handlers,
    locatedByAnchorId,
    liveThreads,
    openPickDraft,
    pickMode,
    pickedNodeThreads,
    setPickMode,
    softMarkers,
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
