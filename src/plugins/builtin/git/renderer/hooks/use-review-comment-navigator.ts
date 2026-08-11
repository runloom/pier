import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createReviewCollidingFileLabel, pluginText } from "../plugin-text.ts";
import {
  buildReviewCommentNavTargets,
  mapCommentSideToDiffView,
  type ReviewCommentNavTarget,
} from "../review/comments/nav-targets.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import type { ReviewTreeOpenReveal } from "../review/surface-types.ts";
import { usePluginLanguage } from "../use-plugin-language.ts";

/**
 * Diff 评论导航：有存活 git-diff 评论时暴露浮动条数据与动作。
 * - 上下：在当前阅读面目标列表循环，优先 scrollToLine，失败再 tree open + reveal。
 * - 清除：确认后逐条 soft-delete 存活评论。
 */
export function useReviewCommentNavigator(options: {
  readonly collidingFileLabel?: (name: string) => string;
  readonly context: RendererPluginContext;
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: ReviewTreeOpenReveal
  ) => void;
  readonly threads: readonly CommentThread[] | null;
  readonly worktreeKey: string;
}): {
  readonly activeIndex: number;
  readonly clearLabel: string;
  readonly nextLabel: string;
  readonly onClear: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly positionLabel: string;
  readonly previousLabel: string;
  readonly targets: readonly ReviewCommentNavTarget[];
  readonly toolbarLabel: string;
  readonly total: number;
  readonly visible: boolean;
} {
  const {
    collidingFileLabel: collidingFileLabelOption,
    context,
    diffBase,
    diffHandleRef,
    entries,
    onRequestTreeOpen,
    threads,
    worktreeKey,
  } = options;
  // 与其它 git UI 一致：语言切换必须驱动文案重读（context 本身稳定）。
  const language = usePluginLanguage();
  const collidingFileLabel = useMemo(
    () =>
      collidingFileLabelOption ??
      createReviewCollidingFileLabel(context, language),
    [collidingFileLabelOption, context, language]
  );

  const targets = useMemo(
    () =>
      buildReviewCommentNavTargets({
        collidingFileLabel,
        entries,
        surface: diffBase,
        threads,
      }),
    [collidingFileLabel, diffBase, entries, threads]
  );
  const total = targets.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const clearingRef = useRef(false);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (total === 0) {
        return 0;
      }
      return Math.min(prev, total - 1);
    });
  }, [total]);

  const revealTarget = useCallback(
    (target: ReviewCommentNavTarget) => {
      const side = mapCommentSideToDiffView(target.side);
      const scrolled =
        diffHandleRef.current?.scrollToLine(
          target.sectionKey,
          target.line,
          side
        ) === true;
      if (scrolled) {
        return;
      }
      onRequestTreeOpen(target.entryKey, target.sectionKey, target.group, {
        line: target.line,
        side: target.side,
      });
    },
    [diffHandleRef, onRequestTreeOpen]
  );

  const onPrevious = useCallback(() => {
    if (total === 0) {
      return;
    }
    setActiveIndex((prev) => {
      const next = (prev - 1 + total) % total;
      const target = targets[next];
      if (target !== undefined) {
        // 下一帧再 scroll，避免 setState 批处理前读到旧 index。
        queueMicrotask(() => {
          revealTarget(target);
        });
      }
      return next;
    });
  }, [revealTarget, targets, total]);

  const onNext = useCallback(() => {
    if (total === 0) {
      return;
    }
    setActiveIndex((prev) => {
      const next = (prev + 1) % total;
      const target = targets[next];
      if (target !== undefined) {
        queueMicrotask(() => {
          revealTarget(target);
        });
      }
      return next;
    });
  }, [revealTarget, targets, total]);

  const onClear = useCallback(() => {
    if (clearingRef.current || total === 0) {
      return;
    }
    const title = pluginText(
      context,
      "reviewCommentClearTitle",
      "Clear all comments?",
      undefined,
      language
    );
    const body = pluginText(
      context,
      "reviewCommentClearBody",
      "This removes every comment on the current changes. You can’t undo this.",
      undefined,
      language
    );
    const confirmLabel = pluginText(
      context,
      "reviewCommentClearConfirm",
      "Clear",
      undefined,
      language
    );
    context.dialogs
      .confirm({
        body,
        confirmLabel,
        intent: "destructive",
        title,
      })
      .then(async (confirmed) => {
        if (!confirmed) {
          return;
        }
        clearingRef.current = true;
        try {
          for (const target of targets) {
            const result = await context.comments.deleteComment({
              commentId: target.commentId,
              threadId: target.threadId,
              worktreeKey,
            });
            if (result.kind === "error") {
              await context.dialogs.alert({
                ...(result.message === null ? {} : { body: result.message }),
                title: pluginText(
                  context,
                  "reviewCommentClearFailed",
                  "Couldn’t clear comments.",
                  undefined,
                  language
                ),
              });
              return;
            }
          }
        } finally {
          clearingRef.current = false;
        }
      })
      .catch(async (error: unknown) => {
        clearingRef.current = false;
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          title: pluginText(
            context,
            "reviewCommentClearFailed",
            "Couldn’t clear comments.",
            undefined,
            language
          ),
        });
      });
  }, [context, language, targets, total, worktreeKey]);

  const safeIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const labels = useMemo(
    () => ({
      clearLabel: pluginText(
        context,
        "reviewCommentClear",
        "Clear all",
        undefined,
        language
      ),
      nextLabel: pluginText(
        context,
        "reviewCommentNext",
        "Next comment",
        undefined,
        language
      ),
      positionLabel: pluginText(
        context,
        "reviewCommentPosition",
        "Comment {{current}} of {{total}}",
        {
          current: safeIndex + 1,
          total,
        },
        language
      ),
      previousLabel: pluginText(
        context,
        "reviewCommentPrevious",
        "Previous comment",
        undefined,
        language
      ),
      toolbarLabel: pluginText(
        context,
        "reviewCommentToolbar",
        "Comments",
        undefined,
        language
      ),
    }),
    [context, language, safeIndex, total]
  );

  return {
    activeIndex: safeIndex,
    clearLabel: labels.clearLabel,
    nextLabel: labels.nextLabel,
    onClear,
    onNext,
    onPrevious,
    positionLabel: labels.positionLabel,
    previousLabel: labels.previousLabel,
    targets,
    toolbarLabel: labels.toolbarLabel,
    total,
    visible: total > 0,
  };
}
