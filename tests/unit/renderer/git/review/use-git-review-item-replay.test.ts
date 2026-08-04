import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import { useGitReviewItemReplay } from "@plugins/builtin/git/renderer/hooks/use-item-replay.ts";
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
    getScrollTop: () => null,
    getSelectedLines: () => null,
    getSelectedText: () => "",
    getViewportLayoutKey: () => "layout:stable",
    isItemVisible: () => true,
    isViewportReady: () => true,
    requestViewportLayoutSettled: (_targetItemId, _stableFrames, callback) => {
      queueMicrotask(callback);
      return () => undefined;
    },
    resolvePointerLineHit: () => null,
    restoreAnchor: () => true,
    scrollToItem: () => true,
    selectAll: () => false,
    setAllCollapsed: () => undefined,
    setScrollTop: () => false,
    updateItems,
  };
}

function renderReplayHook(
  updateItems: PierDiffViewHandle["updateItems"],
  enabled = true
) {
  const handle = diffHandle(updateItems);
  const enabledRef = { current: enabled };
  const committedProjectionGenerationRef = { current: 1 };
  const diffHandleRef = { current: handle as PierDiffViewHandle | null };
  const documentGenerationRef = { current: 1 };
  const latestItemUpdatesRef = new Map<string, PierDiffViewItem>();
  const hook = renderHook(() =>
    useGitReviewItemReplay({
      committedProjectionGenerationRef,
      diffHandleRef,
      documentGenerationRef,
      enabledRef,
      latestItemUpdatesRef: { current: latestItemUpdatesRef },
    })
  );
  return {
    committedProjectionGenerationRef,
    diffHandleRef,
    documentGenerationRef,
    enabledRef,
    handle,
    hook,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useGitReviewItemReplay", () => {
  it("非活动阅读面只记录最新正文，激活后一次回放", () => {
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { enabledRef, handle, hook } = renderReplayHook(updateItems, false);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      expect(
        hook.result.current.applyItemUpdates(handle, 1, [first], {
          flush: true,
        })
      ).toBe(true);
    });
    expect(updateItems).not.toHaveBeenCalled();

    enabledRef.current = true;
    act(() => {
      expect(hook.result.current.replayLatestItemUpdates(handle, 1)).toBe(true);
    });
    expect(updateItems).toHaveBeenCalledOnce();
    expect(updateItems.mock.calls[0]?.[0]).toEqual([first]);
  });

  it("同帧 apply 延后到 rAF；Pierre 拒绝后不跨帧自动补写", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      // 只入队，不立刻打 Pierre
      expect(hook.result.current.applyItemUpdates(handle, 1, [first])).toBe(
        true
      );
    });
    expect(updateItems).toHaveBeenCalledTimes(0);

    // coalesce rAF → 首次 apply 拒绝；后续帧不得再提交第二个可见状态。
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[1]).toEqual({ preserveAnchor: false });
    expect(hook.result.current.replayFailure).not.toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.retryLatestItemUpdates());
    expect(updateItems).toHaveBeenCalledTimes(2);
    expect(updateItems.mock.calls[1]?.[0]).toEqual([first]);
    expect(hook.result.current.replayFailure).toBeNull();
  });

  it("flush:true 同步 updateItems 且 preserveAnchor false", () => {
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      expect(
        hook.result.current.applyItemUpdates(handle, 1, [first], {
          flush: true,
        })
      ).toBe(true);
    });
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[0]).toEqual([first]);
    expect(updateItems.mock.calls[0]?.[1]).toEqual({ preserveAnchor: false });
  });

  it("导航保护期把 preserveAnchor 透传给同帧正文提交", () => {
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      expect(
        hook.result.current.applyItemUpdates(handle, 1, [first], {
          flush: true,
          preserveAnchor: true,
        })
      ).toBe(true);
    });
    expect(updateItems).toHaveBeenCalledWith([first], {
      preserveAnchor: true,
    });
  });

  it("flushPendingItemUpdates 冲刷挂起 coalesce 后不再 rAF 二次 apply", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
    });
    expect(updateItems).toHaveBeenCalledTimes(0);

    act(() => {
      expect(hook.result.current.flushPendingItemUpdates(handle, 1)).toBe(true);
    });
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[1]).toEqual({ preserveAnchor: false });

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
  });

  it("同帧多 settle 合并为一次 updateItems", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);
    const second = item("b.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first, second]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
      hook.result.current.applyItemUpdates(handle, 1, [second]);
    });
    expect(updateItems).toHaveBeenCalledTimes(0);

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
    const payload = updateItems.mock.calls[0]?.[0] ?? [];
    expect(payload).toHaveLength(2);
    expect(new Set(payload.map((entry) => entry.id))).toEqual(
      new Set(["a.ts", "b.ts"])
    );
  });

  it("A 被拒绝后收到 B，合并 latest A+B 在下一次请求内提交", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);
    const first = item("a.ts", 1);
    const second = item("b.ts", 1);

    act(() => {
      hook.result.current.recordLatestItemUpdates([first]);
      hook.result.current.applyItemUpdates(handle, 1, [first]);
    });
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(hook.result.current.replayFailure).not.toBeNull();

    act(() => {
      hook.result.current.recordLatestItemUpdates([second]);
      expect(hook.result.current.applyItemUpdates(handle, 1, [second])).toBe(
        true
      );
    });
    expect(updateItems).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems.mock.calls[1]?.[0]).toEqual([first, second]);
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
    expect(updateItems.mock.calls.at(-1)?.[0]).toEqual([first, second]);
  });

  it("2,001 次同帧稀疏 apply 合并为一次 rAF 提交", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
      .mockReturnValue(true);
    const { handle, hook } = renderReplayHook(updateItems);

    act(() => {
      for (let index = 0; index < 2001; index += 1) {
        const next = item(`file-${index}.ts`, 1);
        hook.result.current.recordLatestItemUpdates([next]);
        hook.result.current.applyItemUpdates(handle, 1, [next]);
      }
    });
    expect(updateItems).toHaveBeenCalledTimes(0);

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItems).toHaveBeenCalledTimes(1);
    expect(updateItems.mock.calls[0]?.[0]).toHaveLength(2001);
  });

  it("换代取消已排程的 coalesce rAF", async () => {
    vi.useFakeTimers();
    const updateItems = vi
      .fn<PierDiffViewHandle["updateItems"]>()
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
    // generation 不匹配 → applyUpdates 早退，不打 Pierre
    expect(updateItems).toHaveBeenCalledTimes(0);
    hook.unmount();
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
