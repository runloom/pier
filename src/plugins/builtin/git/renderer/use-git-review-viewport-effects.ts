import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type RefObject, useCallback, useEffect, useLayoutEffect } from "react";
import {
  type PendingReviewAnchor,
  type ReviewDocumentViewState,
  restoreReviewReadingViewport,
} from "./git-review-document-projection.ts";
import type { ReviewReadingSide } from "./git-review-reading-anchor.ts";
import type { GitReviewGenerationCallbacks } from "./use-git-review-document-session.ts";

export function useGitReviewViewportEffects(options: {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly hasPendingNavigation: () => boolean;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly navigationEpoch: number;
  readonly navigationPending: boolean;
  readonly panelId: string;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly renderedGenerationRef: RefObject<number>;
  readonly replayLatestItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => void;
  readonly resumeSelectedNavigation: () => void;
  readonly sideBySectionIdRef: RefObject<Map<string, ReviewReadingSide>>;
  readonly viewState: ReviewDocumentViewState;
  readonly viewStateRef: {
    current: ReviewDocumentViewState;
  };
  readonly cancelVerification: () => void;
}): {
  readonly setDiffHandle: (handle: PierDiffViewHandle | null) => void;
} {
  const {
    committedProjectionGenerationRef,
    context,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    generationCallbacksRef,
    hasPendingNavigation,
    itemIdsRef,
    navigationEpoch,
    navigationPending,
    panelId,
    pendingAnchorRef,
    renderedGenerationRef,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    sideBySectionIdRef,
    viewState,
    viewStateRef,
    cancelVerification,
  } = options;

  useLayoutEffect(() => {
    viewStateRef.current = viewState;
    resumeSelectedNavigation();
    generationCallbacksRef.current.tryPendingNavigation();
  }, [
    generationCallbacksRef,
    resumeSelectedNavigation,
    viewState,
    viewStateRef,
  ]);

  // pending / epoch：子 DiffView membership apply（layout）先跑，再本层 tryPending。
  // epoch 保证连续树点击在 pending 保持 true 时仍重试最新目标。
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigationEpoch forces retry on successive tree clicks
  useLayoutEffect(() => {
    if (!navigationPending) {
      return;
    }
    generationCallbacksRef.current.tryPendingNavigation();
  }, [generationCallbacksRef, navigationEpoch, navigationPending]);

  const setDiffHandle = useCallback(
    (handle: PierDiffViewHandle | null) => {
      diffHandleRef.current = handle;
      if (
        handle &&
        committedProjectionGenerationRef.current ===
          documentGenerationRef.current
      ) {
        replayLatestItemUpdates(handle, documentGenerationRef.current);
        // handle 挂载一次性补偿：projection 已 commit 时补发 pending scroll
        generationCallbacksRef.current.tryPendingNavigation();
      }
    },
    [
      committedProjectionGenerationRef,
      diffHandleRef,
      documentGenerationRef,
      generationCallbacksRef,
      replayLatestItemUpdates,
    ]
  );

  const tryPendingAnchor = useCallback(() => {
    if (hasPendingNavigation()) {
      return;
    }
    if (!viewStateRef.current.settled) {
      return;
    }
    const pending = pendingAnchorRef.current;
    if (!pending || pending.generation !== renderedGenerationRef.current) {
      return;
    }
    const handle = diffHandleRef.current;
    if (!handle) {
      return;
    }
    const result = restoreReviewReadingViewport(
      handle,
      pending,
      itemIdsRef.current,
      entryKeyBySectionIdRef.current,
      sideBySectionIdRef.current
    );
    // failed：CodeView 尚未接受目标 id，下帧 layout 再试
    if (result !== "failed") {
      pendingAnchorRef.current = null;
    }
  }, [
    diffHandleRef,
    entryKeyBySectionIdRef,
    hasPendingNavigation,
    itemIdsRef,
    pendingAnchorRef,
    renderedGenerationRef,
    sideBySectionIdRef,
    viewStateRef,
  ]);

  // settle 后 identity 兜底（paint 前）；中间帧不碰 scroll
  useLayoutEffect(() => {
    tryPendingAnchor();
  });

  useEffect(() => cancelVerification, [cancelVerification]);

  useEffect(() => {
    const disposeText = context.contextMenu.registerSelectionTextProvider(
      panelId,
      () => diffHandleRef.current?.getSelectedText() ?? ""
    );
    const disposeSelectAll =
      context.contextMenu.registerSelectionSelectAllProvider(
        panelId,
        () => diffHandleRef.current?.selectAll() ?? false
      );
    return () => {
      disposeText();
      disposeSelectAll();
    };
  }, [context, diffHandleRef, panelId]);

  return { setDiffHandle };
}
