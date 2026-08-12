/**
 * Shared floating comment navigator controller (diff-parity).
 * Callers supply ordered targets + reveal/clear; UI is `@pier/ui/comment-navigator`.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type FilesTranslate, useFilesPluginLanguage } from "../i18n.ts";

export interface CommentNavTarget {
  readonly commentId: string;
  readonly threadId: string;
}

export interface CommentNavigatorLabels {
  readonly clearBody: string;
  readonly clearConfirm: string;
  readonly clearFailed: string;
  readonly clearLabel: string;
  readonly clearTitle: string;
  readonly nextLabel: string;
  /** Interpolated with {{current}} / {{total}}. */
  readonly positionTemplate: string;
  readonly previousLabel: string;
  readonly toolbarLabel: string;
}

export function createCommentNavigatorLabels(
  t: FilesTranslate,
  /** Locale stamp so callers can invalidate memos after languageChanged. */
  _locale?: string
): CommentNavigatorLabels {
  return {
    clearBody: t(
      "filePanel.commentNav.clearBody",
      "This removes every comment on this file. You can’t undo this."
    ),
    clearConfirm: t("filePanel.commentNav.clearConfirm", "Clear"),
    clearFailed: t(
      "filePanel.commentNav.clearFailed",
      "Couldn’t clear comments."
    ),
    clearLabel: t("filePanel.commentNav.clear", "Clear all"),
    clearTitle: t("filePanel.commentNav.clearTitle", "Clear all comments?"),
    nextLabel: t("filePanel.commentNav.next", "Next comment"),
    positionTemplate: t(
      "filePanel.commentNav.position",
      "Comment {{current}} of {{total}}"
    ),
    previousLabel: t("filePanel.commentNav.previous", "Previous comment"),
    toolbarLabel: t("filePanel.commentNav.toolbar", "Comments"),
  };
}

function formatPositionLabel(
  template: string,
  current: number,
  total: number
): string {
  return template
    .replaceAll("{{current}}", String(current))
    .replaceAll("{{total}}", String(total));
}

/**
 * Resolve navigator copy with the current host language.
 * Depends on `useFilesPluginLanguage` so locale switches re-resolve strings.
 */
export function useCommentNavigatorLabels(
  t: FilesTranslate
): CommentNavigatorLabels {
  const language = useFilesPluginLanguage();
  return useMemo(
    () => createCommentNavigatorLabels(t, language),
    [language, t]
  );
}

export function useCommentNavigatorController<
  T extends CommentNavTarget,
>(options: {
  /**
   * Optional superset for clear-all (e.g. canvas pin-nav vs all path threads).
   * Defaults to `targets` when omitted.
   */
  readonly clearTargets?: readonly T[];
  readonly context: RendererPluginContext | undefined;
  readonly labels: CommentNavigatorLabels;
  readonly onReveal: (target: T) => void;
  readonly targets: readonly T[];
  readonly worktreeKey: string | undefined;
}): {
  readonly activeIndex: number;
  readonly clearLabel: string;
  readonly nextLabel: string;
  readonly onClear: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly positionLabel: string;
  readonly previousLabel: string;
  readonly toolbarLabel: string;
  readonly total: number;
  readonly visible: boolean;
} {
  const { context, labels, onReveal, targets, worktreeKey } = options;
  const clearTargets = options.clearTargets ?? targets;
  const total = targets.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const clearingRef = useRef(false);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const clearTargetsRef = useRef(clearTargets);
  clearTargetsRef.current = clearTargets;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => {
    setActiveIndex((prev) => {
      if (total === 0) {
        return 0;
      }
      return Math.min(prev, total - 1);
    });
  }, [total]);

  const revealAt = useCallback((index: number) => {
    const target = targetsRef.current[index];
    if (target === undefined) {
      return;
    }
    queueMicrotask(() => {
      onRevealRef.current(target);
    });
  }, []);

  const onPrevious = useCallback(() => {
    if (total === 0) {
      return;
    }
    setActiveIndex((prev) => {
      const next = (prev - 1 + total) % total;
      revealAt(next);
      return next;
    });
  }, [revealAt, total]);

  const onNext = useCallback(() => {
    if (total === 0) {
      return;
    }
    setActiveIndex((prev) => {
      const next = (prev + 1) % total;
      revealAt(next);
      return next;
    });
  }, [revealAt, total]);

  const onClear = useCallback(() => {
    const toClear = clearTargetsRef.current;
    if (
      clearingRef.current ||
      toClear.length === 0 ||
      !context ||
      !worktreeKey
    ) {
      return;
    }
    context.dialogs
      .confirm({
        body: labels.clearBody,
        confirmLabel: labels.clearConfirm,
        intent: "destructive",
        title: labels.clearTitle,
      })
      .then(async (confirmed) => {
        if (!confirmed) {
          return;
        }
        clearingRef.current = true;
        try {
          for (const target of toClear) {
            const result = await context.comments.deleteComment({
              commentId: target.commentId,
              threadId: target.threadId,
              worktreeKey,
            });
            if (result.kind === "error") {
              await context.dialogs.alert({
                ...(result.message === null ? {} : { body: result.message }),
                title: labels.clearFailed,
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
          title: labels.clearFailed,
        });
      });
  }, [context, labels, worktreeKey]);

  const safeIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const positionLabel = useMemo(
    () => formatPositionLabel(labels.positionTemplate, safeIndex + 1, total),
    [labels.positionTemplate, safeIndex, total]
  );

  return {
    activeIndex: safeIndex,
    clearLabel: labels.clearLabel,
    nextLabel: labels.nextLabel,
    onClear,
    onNext,
    onPrevious,
    positionLabel,
    previousLabel: labels.previousLabel,
    toolbarLabel: labels.toolbarLabel,
    total,
    visible: total > 0,
  };
}

/** Optional helper when a scroll root is needed for reveal. */
export type CommentNavigatorScrollRoot = RefObject<HTMLElement | null>;
