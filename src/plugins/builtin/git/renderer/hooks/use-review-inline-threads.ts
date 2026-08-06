import type {
  PierActiveReviewSlot,
  PierGutterReviewEvent,
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  CommentItem,
  CommentThread,
  GitDiffCommentTarget,
} from "@shared/contracts/comments/base.ts";
import type {
  CommentAuthor,
  CommentFailure,
} from "@shared/contracts/comments/primitives.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { pluginText } from "../plugin-text.ts";

function authorLabelOf(author: CommentAuthor, you: string): string {
  return author.kind === "user" ? you : author.displayName;
}

/**
 * 从 gutter 事件反查 entry 的 (group, path, oldPath) 构造 diff 评论锚点。
 *
 * itemId 是 section id → `entryKeyBySectionId` 得 entryKey → entry →
 * `renderSlots[sectionKey=itemId]` 得 slot.group / slot.oldPath；entry.path
 * 是当前路径。scope 复用 GitReviewScope（contextId + gitRootPath + target），
 * 与 review 文档身份同源。blobOid 留里程碑 4 回填（v1 创建不带版本指纹）。
 */
function buildDiffTarget(
  event: PierGutterReviewEvent,
  entries: readonly GitReviewIndexEntry[],
  entryKeyBySectionId: ReadonlyMap<string, string>,
  scope: GitReviewScope
): GitDiffCommentTarget | null {
  const entryKey = entryKeyBySectionId.get(event.itemId);
  if (entryKey === undefined) {
    return null;
  }
  const entry = entries.find((item) => item.entryKey === entryKey);
  if (entry === undefined) {
    return null;
  }
  const slot = entry.renderSlots.find(
    (item) => item.sectionKey === event.itemId
  );
  if (slot === undefined) {
    return null;
  }
  return {
    kind: "git-diff",
    group: slot.group,
    line: event.lineNumber,
    oldPath: slot.oldPath,
    path: entry.path,
    scope,
    side: event.side === "additions" ? "new" : "old",
  };
}

interface SlotEntry {
  readonly itemId: string;
  readonly slot: PierActiveReviewSlot;
}

function firstLiveComment(
  comments: readonly CommentItem[]
): CommentItem | undefined {
  return comments.find((comment) => comment.deletedAt === undefined);
}

/**
 * 行内评论激活态 + drift 浮层状态 + 写操作。
 *
 * v1 瘦身（对标 Codex 单条批注）：每锚点一条评论；无回复 / 无 resolve。
 * 写路径只剩 createThread + deleteComment。
 */
export function useReviewInlineThreads({
  context,
  entries,
  entryKeyBySectionIdRef,
  locale,
  scope,
  threads,
}: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly locale: string;
  readonly scope: GitReviewScope;
  readonly threads: readonly CommentThread[] | null;
}): {
  readonly activeReviewEpoch: number;
  readonly activeReviewSlotsByItem: ReadonlyMap<
    string,
    readonly PierActiveReviewSlot[]
  >;
  readonly driftThread: PierInlineReviewThread | null;
  readonly handleGutterReviewActivate: (event: PierGutterReviewEvent) => void;
  readonly inlineReviewHandlers: PierInlineReviewHandlers;
  readonly inlineReviewLabels: PierInlineReviewLabels;
  readonly inlineReviewThreadById: ReadonlyMap<string, PierInlineReviewThread>;
  readonly openDriftThread: (threadId: string) => void;
} {
  const worktreeKey = scope.gitRootPath;
  const [slots, setSlots] = useState<ReadonlyMap<string, SlotEntry>>(new Map());
  const [epoch, setEpoch] = useState(0);
  const [driftThreadId, setDriftThreadId] = useState<string | null>(null);
  const draftTargetRef = useRef(new Map<string, GitDiffCommentTarget>());

  const bumpEpoch = useCallback(() => setEpoch((e) => e + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: locale drives i18n re-read
  const inlineReviewLabels = useMemo<PierInlineReviewLabels>(
    () => ({
      authorYou: pluginText(context, "reviewCommentAuthorYou", "You"),
      close: pluginText(context, "reviewCommentClose", "Close"),
      deleteComment: pluginText(context, "reviewCommentDelete", "Delete"),
      deleted: pluginText(context, "reviewCommentDeleted", "Deleted"),
      editComment: pluginText(context, "reviewCommentEdit", "Edit"),
      inputPlaceholder: pluginText(
        context,
        "reviewCommentInputPlaceholder",
        "Write a comment…"
      ),
      submit: pluginText(context, "reviewCommentSubmit", "Submit"),
      title: pluginText(context, "reviewCommentTitle", "Comment"),
    }),
    [context, locale]
  );

  const inlineReviewThreadById = useMemo(() => {
    const map = new Map<string, PierInlineReviewThread>();
    if (threads === null) {
      return map;
    }
    const you = inlineReviewLabels.authorYou;
    for (const thread of threads) {
      const live = firstLiveComment(thread.comments);
      if (live === undefined) {
        continue;
      }
      map.set(thread.id, {
        comment: {
          authorLabel: authorLabelOf(live.author, you),
          body: live.body,
          createdAt: live.createdAt,
          ...(live.deletedAt === undefined
            ? {}
            : { deletedAt: live.deletedAt }),
          id: live.id,
        },
        threadId: thread.id,
      });
    }
    return map;
  }, [threads, inlineReviewLabels]);

  const activeReviewSlotsByItem = useMemo(() => {
    const map = new Map<string, PierActiveReviewSlot[]>();
    for (const { itemId, slot } of slots.values()) {
      const arr = map.get(itemId) ?? [];
      arr.push(slot);
      map.set(itemId, arr);
    }
    return map;
  }, [slots]);

  const reportFailure = useCallback(
    (titleKey: string, titleFallback: string, failure: CommentFailure) => {
      context.dialogs.alert({
        ...(failure.message === null ? {} : { body: failure.message }),
        title: pluginText(context, titleKey, titleFallback),
      });
    },
    [context]
  );

  const handleGutterReviewActivate = useCallback(
    (event: PierGutterReviewEvent) => {
      // 已有评论的行不再有「展开/收起」态：评论卡由 base annotation 常驻行内，
      // gutter 入口恒为「在这一行新建评论」。
      const target = buildDiffTarget(
        event,
        entries,
        entryKeyBySectionIdRef.current,
        scope
      );
      if (target === null) {
        context.dialogs.alert({
          title: pluginText(
            context,
            "reviewCommentAnchorMissingTitle",
            "Cannot locate this line"
          ),
          ...(entryKeyBySectionIdRef.current.has(event.itemId)
            ? {}
            : {
                body: pluginText(
                  context,
                  "reviewCommentAnchorMissingBody",
                  "The diff section for this line is no longer available."
                ),
              }),
        });
        return;
      }
      const draftId = `draft-${event.itemId}-${event.side}-${event.lineNumber}`;
      draftTargetRef.current.set(draftId, target);
      setSlots((prev) => {
        if (prev.has(draftId)) {
          return prev;
        }
        const next = new Map(prev);
        next.set(draftId, {
          itemId: event.itemId,
          slot: {
            draftId,
            kind: "draft",
            lineNumber: event.lineNumber,
            side: event.side,
          },
        });
        return next;
      });
      bumpEpoch();
    },
    [bumpEpoch, context, entries, entryKeyBySectionIdRef, scope]
  );

  const onCancelDraft = useCallback(
    (draftId: string) => {
      draftTargetRef.current.delete(draftId);
      setSlots((prev) => {
        if (!prev.has(draftId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(draftId);
        return next;
      });
      bumpEpoch();
    },
    [bumpEpoch]
  );

  const onSubmitDraft = useCallback(
    async (draftId: string, body: string): Promise<boolean> => {
      const target = draftTargetRef.current.get(draftId);
      if (target === undefined || body.trim().length === 0) {
        return false;
      }
      const result = await context.comments.createThread({
        author: { kind: "user" },
        body,
        target,
        worktreeKey,
      });
      if (result.kind === "error") {
        reportFailure(
          "reviewCommentCreateFailed",
          "Failed to create comment",
          result
        );
        return false;
      }
      draftTargetRef.current.delete(draftId);
      const threadId = result.threadId;
      setSlots((prev) => {
        const draftEntry = prev.get(draftId);
        if (draftEntry === undefined) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(draftId);
        next.set(threadId, {
          itemId: draftEntry.itemId,
          slot: {
            kind: "thread",
            lineNumber: draftEntry.slot.lineNumber,
            side: draftEntry.slot.side,
            threadId,
          },
        });
        return next;
      });
      bumpEpoch();
      return true;
    },
    [bumpEpoch, context, reportFailure, worktreeKey]
  );

  const onEditComment = useCallback(
    async (
      threadId: string,
      commentId: string,
      body: string
    ): Promise<boolean> => {
      if (body.trim().length === 0) {
        return false;
      }
      const result = await context.comments.updateComment({
        body,
        commentId,
        threadId,
        worktreeKey,
      });
      if (result.kind === "error") {
        reportFailure(
          "reviewCommentUpdateFailed",
          "Failed to update comment",
          result
        );
        return false;
      }
      bumpEpoch();
      return true;
    },
    [bumpEpoch, context, reportFailure, worktreeKey]
  );

  const onDeleteComment = useCallback(
    async (threadId: string, commentId: string): Promise<void> => {
      const result = await context.comments.deleteComment({
        commentId,
        threadId,
        worktreeKey,
      });
      if (result.kind === "error") {
        reportFailure(
          "reviewCommentDeleteFailed",
          "Failed to delete comment",
          result
        );
        return;
      }
      // 单条批注删除后收起展开卡。
      setSlots((prev) => {
        if (!prev.has(threadId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(threadId);
        return next;
      });
      if (driftThreadId === threadId) {
        setDriftThreadId(null);
      }
      bumpEpoch();
    },
    [bumpEpoch, context, driftThreadId, reportFailure, worktreeKey]
  );

  const inlineReviewHandlers = useMemo<PierInlineReviewHandlers>(
    () => ({
      onCancelDraft,
      onDeleteComment,
      onEditComment,
      onSubmitDraft,
    }),
    [onCancelDraft, onDeleteComment, onEditComment, onSubmitDraft]
  );

  // 再点同一 drift chip = 收起浮层；卡片无关闭按钮。
  const openDriftThread = useCallback((threadId: string) => {
    setDriftThreadId((prev) => (prev === threadId ? null : threadId));
  }, []);
  const driftThread = useMemo<PierInlineReviewThread | null>(
    () =>
      driftThreadId === null
        ? null
        : (inlineReviewThreadById.get(driftThreadId) ?? null),
    [driftThreadId, inlineReviewThreadById]
  );

  return {
    activeReviewEpoch: epoch,
    activeReviewSlotsByItem,
    driftThread,
    handleGutterReviewActivate,
    inlineReviewHandlers,
    inlineReviewLabels,
    inlineReviewThreadById,
    openDriftThread,
  };
}
