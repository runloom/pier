import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReviewDocumentViewState } from "@plugins/builtin/git/renderer/git-review-document-projection.ts";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useGitReviewViewportEffects } from "../../../src/plugins/builtin/git/renderer/use-git-review-viewport-effects.ts";

const INITIAL_VIEW_STATE: ReviewDocumentViewState = {
  generation: 1,
  retainedEntryKeys: [],
  settled: false,
  staleRetainedCount: 0,
};

it("非活动阅读面只更新模型，不回放正文或消费 pending 导航", () => {
  const tryPendingNavigation = vi.fn();
  const resumeSelectedNavigation = vi.fn();
  const restoreSelectedNavigation = vi.fn();
  const replayLatestItemUpdates = vi.fn();
  const cancelVerification = vi.fn();
  const diffHandleRef = { current: null as PierDiffViewHandle | null };
  const context = {
    contextMenu: {
      registerSelectionSelectAllProvider: vi.fn(() => vi.fn()),
      registerSelectionTextProvider: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext;
  const hook = renderHook(
    ({
      active,
      viewState,
    }: {
      readonly active: boolean;
      readonly viewState: typeof INITIAL_VIEW_STATE;
    }) =>
      useGitReviewViewportEffects({
        active,
        cancelVerification,
        committedProjectionGenerationRef: { current: 1 },
        context,
        diffHandleRef,
        documentGenerationRef: { current: 1 },
        entryKeyBySectionIdRef: { current: new Map() },
        generationCallbacksRef: {
          current: { tryPendingNavigation },
        } as never,
        hasPendingNavigation: () => true,
        navigationEpoch: 1,
        navigationPending: true,
        panelId: "review:a",
        renderedGenerationRef: { current: 1 },
        replayLatestItemUpdates,
        resumeSelectedNavigation,
        restoreSelectedNavigation,
        viewState,
        viewStateRef: { current: viewState },
      }),
    {
      initialProps: { active: false, viewState: INITIAL_VIEW_STATE },
    }
  );

  expect(resumeSelectedNavigation).not.toHaveBeenCalled();
  expect(restoreSelectedNavigation).not.toHaveBeenCalled();
  expect(tryPendingNavigation).not.toHaveBeenCalled();
  expect(cancelVerification).toHaveBeenCalledOnce();
  act(() => {
    hook.result.current.setDiffHandle({} as PierDiffViewHandle);
  });
  expect(replayLatestItemUpdates).not.toHaveBeenCalled();
  expect(tryPendingNavigation).not.toHaveBeenCalled();

  hook.rerender({
    active: false,
    viewState: { ...INITIAL_VIEW_STATE, generation: 2 },
  });
  expect(resumeSelectedNavigation).not.toHaveBeenCalled();
  expect(restoreSelectedNavigation).not.toHaveBeenCalled();
  expect(tryPendingNavigation).not.toHaveBeenCalled();

  hook.rerender({
    active: true,
    viewState: { ...INITIAL_VIEW_STATE, generation: 2 },
  });
  expect(resumeSelectedNavigation).toHaveBeenCalled();
  expect(restoreSelectedNavigation).toHaveBeenCalledOnce();
  expect(tryPendingNavigation).toHaveBeenCalled();
  expect(cancelVerification).toHaveBeenCalledTimes(2);

  hook.rerender({
    active: false,
    viewState: { ...INITIAL_VIEW_STATE, generation: 2 },
  });
  expect(cancelVerification).toHaveBeenCalledTimes(3);
});
