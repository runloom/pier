import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import { useGitReviewItemReplay } from "@plugins/builtin/git/renderer/use-git-review-item-replay.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function item(id: string, revision: number): PierDiffViewItem {
  return {
    cacheKey: `${id}:${revision}`,
    id,
    patch: `diff --git a/${id} b/${id}\n--- a/${id}\n+++ b/${id}\n@@ -1 +1 @@\n-old\n+new-${revision}\n`,
  };
}

function diffHandle(
  updateItems: PierDiffViewHandle["updateItems"]
): PierDiffViewHandle {
  return {
    captureTopAnchor: () => null,
    getSelectedText: () => "",
    isItemVisible: () => true,
    restoreAnchor: () => true,
    scrollToItem: () => true,
    selectAll: () => false,
    setAllCollapsed: () => undefined,
    updateItems,
  };
}

function renderReplayHook(updateItems: PierDiffViewHandle["updateItems"]) {
  const handle = diffHandle(updateItems);
  const committedProjectionGenerationRef = { current: 1 };
  const diffHandleRef = { current: handle as PierDiffViewHandle | null };
  const documentGenerationRef = { current: 1 };
  const latestItemUpdatesRef = new Map<string, PierDiffViewItem>();
  const hook = renderHook(() =>
    useGitReviewItemReplay({
      committedProjectionGenerationRef,
      diffHandleRef,
      documentGenerationRef,
      hasPendingNavigation: () => false,
      latestItemUpdatesRef: { current: latestItemUpdatesRef },
    })
  );
  return {
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    handle,
    hook,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useGitReviewItemReplay", () => {
  it("Pierre 首次拒绝后下一帧自动读取 latest-map 重试", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      expect(hook.result.current.applyItemUpdates(handle, 1, [first])).toBe(
        false
      );
    });
    expect(updateItems).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(2);
    expect(updateItems.mock.calls[1]?.[0]).toEqual([first]);
    expect(hook.result.current.replayFailure).toBeNull();
  });

  it("A 到达重试上限后收到 B，会合并当前 latest A+B 再提交", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);
    const second = item("b.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
    });
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(updateItems).toHaveBeenCalledTimes(3);
    expect(hook.result.current.replayFailure).not.toBeNull();

    act(() => {
      hook.result.current.recordLatestItemUpdates([second]);
      expect(hook.result.current.applyItemUpdates(handle, 1, [second])).toBe(
        true
      );
    });
    expect(updateItems.mock.calls[3]?.[0]).toEqual([first, second]);
    expect(hook.result.current.replayFailure).toBeNull();
  });

  it("pending sparse 与 full replay 合并时保持全量语义", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);
    const second = item("b.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first, second]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
      hook.result.current.replayLatestItemUpdates(handle, 1);
    });
    await act(() => vi.advanceTimersByTimeAsync(20));

    expect(updateItems).toHaveBeenCalledTimes(2);
    expect(updateItems.mock.calls[1]?.[0]).toEqual([first, second]);
  });

  it("首次拒绝后的 2,001 次同帧稀疏更新原地合并且下一帧只回放一次", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("file-0.ts", 1);
    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
    });
    const addSpy = vi.spyOn(Set.prototype, "add");

    act(() => {
      for (let index = 1; index < 2001; index += 1) {
        const next = item(`file-${index}.ts`, 1);
        hook.result.current.recordLatestItemUpdates([next]);
        hook.result.current.applyItemUpdates(handle, 1, [next]);
      }
    });

    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls.length).toBeLessThan(10_000);
    const addCountBeforeReplay = addSpy.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(2);
    expect(updateItems.mock.calls[1]?.[0]).toHaveLength(2001);
    expect(addSpy).toHaveBeenCalledTimes(addCountBeforeReplay);
    addSpy.mockRestore();
  });

  it("换代和卸载都会取消旧 rAF，2,001 次稀疏更新始终只提交单项", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { documentGenerationRef, handle, hook } =
      renderReplayHook(updateItems);
    const first = item("a.ts", 1);
    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
    });
    documentGenerationRef.current = 2;
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
    hook.unmount();
    await vi.runOnlyPendingTimersAsync();

    const sparseUpdateItems = vi.fn<PierDiffViewHandle["updateItems"]>(
      () => true
    );
    const sparse = renderReplayHook(sparseUpdateItems);
    act(() => {
      for (let index = 0; index < 2001; index += 1) {
        const next = item(`file-${index}.ts`, 1);
        sparse.hook.result.current.recordLatestItemUpdates([next]);
        sparse.hook.result.current.applyItemUpdates(sparse.handle, 1, [next]);
      }
    });
    expect(sparseUpdateItems).toHaveBeenCalledTimes(2001);
    expect(
      sparseUpdateItems.mock.calls.every(([items]) => items.length === 1)
    ).toBe(true);
    act(() => {
      sparse.hook.result.current.replayLatestItemUpdates(sparse.handle, 1);
    });
    expect(sparseUpdateItems).toHaveBeenCalledTimes(2002);
    expect(sparseUpdateItems.mock.calls.at(-1)?.[0]).toHaveLength(2001);
  });

  it("回放时只提交当前拓扑内的 latest-map 条目", async () => {
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const known = item("section:known", 1);
    const stale = item(
      "sha256:89975872776f66d3cab99439a8d0be7970987bdfb858f46fe7b36bb9a44fdf64",
      1
    );

    act(() => {
      hook.result.current.recordLatestItemUpdates([known, stale]);
    });

    act(() => {
      expect(
        hook.result.current.replayLatestItemUpdates(handle, 1, [
          "section:known",
        ])
      ).toBe(true);
    });

    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[0]).toEqual([known]);
  });

  it("用户重试沿用上次回放的拓扑 allowedIds", async () => {
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(false);
    const { handle, hook } = renderReplayHook(updateItems);
    const known = item("section:known", 1);
    const stale = item(
      "sha256:89975872776f66d3cab99439a8d0be7970987bdfb858f46fe7b36bb9a44fdf64",
      1
    );

    act(() => {
      hook.result.current.recordLatestItemUpdates([known, stale]);
    });
    act(() => {
      expect(
        hook.result.current.replayLatestItemUpdates(handle, 1, [
          "section:known",
        ])
      ).toBe(false);
    });
    expect(updateItems.mock.calls.at(-1)?.[0]).toEqual([known]);

    // 失败后 stale 又写回 latest-map；重试仍必须按 allowedIds 过滤。
    act(() => {
      hook.result.current.recordLatestItemUpdates([stale]);
    });
    updateItems.mockClear();
    updateItems.mockReturnValue(true);
    act(() => {
      hook.result.current.retryLatestItemUpdates();
    });
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[0]).toEqual([known]);
  });
});
