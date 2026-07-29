import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { ReviewDocumentViewState } from "./git-review-document-projection.ts";
import type { GitReviewGenerationCallbacks } from "./use-git-review-document-session.ts";

export function useGitReviewViewportEffects(options: {
  readonly active: boolean;
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly hasPendingNavigation: () => boolean;
  readonly navigationEpoch: number;
  readonly navigationPending: boolean;
  readonly panelId: string;
  readonly renderedGenerationRef: RefObject<number>;
  readonly replayLatestItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => void;
  readonly resumeSelectedNavigation: () => void;
  readonly restoreSelectedNavigation: () => void;
  readonly viewState: ReviewDocumentViewState;
  readonly viewStateRef: {
    current: ReviewDocumentViewState;
  };
  readonly cancelVerification: () => void;
}): {
  readonly setDiffHandle: (handle: PierDiffViewHandle | null) => void;
} {
  const {
    active,
    committedProjectionGenerationRef,
    context,
    diffHandleRef,
    documentGenerationRef,
    generationCallbacksRef,
    navigationEpoch,
    navigationPending,
    panelId,
    replayLatestItemUpdates,
    resumeSelectedNavigation,
    restoreSelectedNavigation,
    viewState,
    viewStateRef,
    cancelVerification,
  } = options;
  const wasActiveRef = useRef(active);

  useLayoutEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    viewStateRef.current = viewState;
    if (!active) {
      cancelVerification();
      return;
    }
    if (becameActive) {
      restoreSelectedNavigation();
    }
    resumeSelectedNavigation();
    generationCallbacksRef.current.tryPendingNavigation();
  }, [
    active,
    cancelVerification,
    generationCallbacksRef,
    restoreSelectedNavigation,
    resumeSelectedNavigation,
    viewState,
    viewStateRef,
  ]);

  // pending / epoch：子 DiffView membership apply（layout）先跑，再本层 tryPending。
  // epoch 保证连续树点击在 pending 保持 true 时仍重试最新目标。
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigationEpoch forces retry on successive tree clicks
  useLayoutEffect(() => {
    if (!(active && navigationPending)) {
      return;
    }
    generationCallbacksRef.current.tryPendingNavigation();
  }, [active, generationCallbacksRef, navigationEpoch, navigationPending]);

  const setDiffHandle = useCallback(
    (handle: PierDiffViewHandle | null) => {
      diffHandleRef.current = handle;
      if (
        active &&
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
      active,
      diffHandleRef,
      documentGenerationRef,
      generationCallbacksRef,
      replayLatestItemUpdates,
    ]
  );

  useLayoutEffect(() => {
    const handle = diffHandleRef.current;
    if (
      !(active && handle) ||
      committedProjectionGenerationRef.current !== documentGenerationRef.current
    ) {
      return;
    }
    replayLatestItemUpdates(handle, documentGenerationRef.current);
    generationCallbacksRef.current.tryPendingNavigation();
  }, [
    active,
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    generationCallbacksRef,
    replayLatestItemUpdates,
  ]);

  useEffect(() => cancelVerification, [cancelVerification]);

  useEffect(() => {
    if (!active) {
      return;
    }
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
  }, [active, context, diffHandleRef, panelId]);

  return { setDiffHandle };
}
