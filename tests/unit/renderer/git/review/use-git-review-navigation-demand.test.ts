import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGitReviewNavigation } from "../../../../../src/plugins/builtin/git/renderer/hooks/use-navigation.ts";
import { patchDocument } from "./document-fixture.ts";

function setup(options?: {
  readonly itemCacheKey?: string;
  readonly initialSelection?: boolean;
  readonly getViewportLayoutKey?: () => string | null;
  readonly isItemVisible?: () => boolean;
  readonly isViewportReady?: () => boolean;
  readonly scrollToItem?: () => boolean;
}) {
  const applyNavigationDemand = vi.fn();
  const loader = {
    getResource: vi.fn(() => ({
      document: patchDocument({
        entryKey: "entry:a",
        patch: "diff",
        revision: "document:a",
        sectionKey: "section:a",
      }),
      entry: {
        entryKey: "entry:a",
        oldPaths: [],
        path: "a.ts",
        renderSlots: [
          {
            group: "unstaged" as const,
            oldPath: null,
            sectionKey: "section:a",
            status: "modified" as const,
            targetPath: "a.ts",
          },
        ],
        status: "modified" as const,
      },
      kind: "loaded" as const,
    })),
    isSettled: () => true,
    setProtectedEntryKey: vi.fn(),
    setStickyMemberEntryKeys: vi.fn(),
  };
  const refs = {
    applyNavigationDemand,
    diffHandleRef: {
      current: {
        getViewportLayoutKey:
          options?.getViewportLayoutKey ?? (() => "layout:stable"),
        isItemVisible: options?.isItemVisible ?? (() => true),
        isViewportReady: options?.isViewportReady ?? (() => true),
        requestViewportLayoutSettled: (
          _targetItemId: string,
          _stableFrames: number,
          callback: () => void
        ) => {
          let cancelled = false;
          queueMicrotask(() => {
            if (!cancelled) {
              callback();
            }
          });
          return () => {
            cancelled = true;
          };
        },
        scrollToItem: options?.scrollToItem ?? (() => true),
      },
    },
    documentGenerationRef: { current: 1 },
    entryKeyBySectionIdRef: {
      current: new Map([["section:a", "entry:a"]]),
    },
    firstSectionIdByEntryKeyRef: {
      current: new Map([["entry:a", "section:a"]]),
    },
    itemCacheKeysRef: {
      current: new Map([
        ["section:a", options?.itemCacheKey ?? "document:a:section:a"],
      ]),
    },
    itemIndexByIdRef: { current: new Map([["section:a", 0]]) },
    ...(options?.initialSelection === true
      ? {
          initialSelectedEntryKey: "entry:a",
          initialSelectedSectionKey: "section:a",
        }
      : {}),
    loaderRef: { current: loader },
    renderedGenerationRef: { current: 1 },
  };
  const hook = renderHook(() => useGitReviewNavigation(refs as never));
  return { applyNavigationDemand, hook, loader, refs };
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

function acknowledgeTargetWindow(
  hook: ReturnType<typeof setup>["hook"],
  sectionKey = "section:a"
): void {
  act(() => {
    hook.result.current.notifyRenderWindowApplied({
      bufferedItemIds: [],
      estimatedItemIds: [],
      visibleItemIds: [sectionKey],
    });
  });
}

describe("useGitReviewNavigation demand sync", () => {
  it("beginNavigation arms pending before applyNavigationDemand (sticky gate)", () => {
    const { applyNavigationDemand, hook } = setup();
    applyNavigationDemand.mockImplementation(() => {
      expect(hook.result.current.hasPendingNavigation()).toBe(true);
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.navigationPending).toBe(true);
    expect(hook.result.current.getNavigationMemberReason()).toBe("tree");
  });

  it("beginNavigation applies boost demand immediately", () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.navigationPending).toBe(true);
  });

  it("scrolls to estimate header immediately (Zed pending_scroll; no wait for document)", async () => {
    const scrollToItem = vi.fn(() => true);
    const { hook } = setup({
      itemCacheKey: "estimate:section:a",
      isItemVisible: () => true,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
      hook.result.current.tryPendingNavigation();
    });
    expect(scrollToItem).toHaveBeenCalledTimes(1);
    // 显式树导航要看到正文，必须展开目标；被动恢复才禁止展开。
    expect(scrollToItem).toHaveBeenCalledWith("section:a", {
      behavior: "instant",
      expandCollapsed: true,
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("beginGeneration keeps settled selection without turning refresh into navigation", async () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    applyNavigationDemand.mockClear();
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    applyNavigationDemand.mockClear();
    act(() => {
      hook.result.current.beginGeneration(new Set(["entry:a"]), 2);
    });
    expect(applyNavigationDemand).not.toHaveBeenCalled();
    expect(hook.result.current.getNavigationMemberReason()).toBeNull();
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("remount generation restores the persisted selection without changing refresh policy", () => {
    const { applyNavigationDemand, hook } = setup({
      initialSelection: true,
    });
    act(() => {
      hook.result.current.beginGeneration(new Set(["entry:a"]), 2, {
        restoreSelection: true,
      });
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.getNavigationMemberReason()).toBe("restore");
    expect(hook.result.current.navigationPending).toBe(true);
  });

  it("tryPendingNavigation scrolls at most once then verify does not rescroll", async () => {
    const scrollToItem = vi.fn(() => true);
    const { hook } = setup({ scrollToItem });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    expect(scrollToItem).toHaveBeenCalledTimes(1);
    await flushFrames();
    await flushFrames();
    expect(scrollToItem).toHaveBeenCalledTimes(1);
  });

  it("waits for a visible non-zero viewport before restoring a selected item", async () => {
    let viewportReady = false;
    const scrollToItem = vi.fn(() => true);
    const { hook } = setup({
      isViewportReady: () => viewportReady,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
      hook.result.current.tryPendingNavigation();
    });
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(hook.result.current.navigationPending).toBe(true);

    viewportReady = true;
    await flushFrames();
    expect(scrollToItem).toHaveBeenCalledOnce();
  });

  it("re-arms the semantic selection when later layout removes it from the viewport", async () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);

    act(() => {
      hook.result.current.notifyRenderWindowApplied({
        bufferedItemIds: [],
        estimatedItemIds: [],
        visibleItemIds: [],
      });
    });
    expect(hook.result.current.navigationPending).toBe(true);
    expect(hook.result.current.getNavigationMemberReason()).toBe("restore");
  });

  it("does not resubmit a restore scroll when predecessor measurement changes", () => {
    let layoutKey = "layout:before";
    const scrollToItem = vi.fn(() => true);
    const { hook, refs } = setup({
      getViewportLayoutKey: () => layoutKey,
      initialSelection: true,
      scrollToItem,
    });
    refs.documentGenerationRef.current = 2;
    refs.renderedGenerationRef.current = 2;
    act(() => {
      hook.result.current.beginGeneration(new Set(["entry:a"]), 2, {
        restoreSelection: true,
      });
      hook.result.current.tryPendingNavigation();
    });
    expect(scrollToItem).toHaveBeenCalledOnce();

    layoutKey = "layout:after";
    act(() => hook.result.current.tryPendingNavigation());
    expect(scrollToItem).toHaveBeenCalledOnce();
  });

  it("keeps explicit tree navigation pending until the requested item is visible", async () => {
    let visible = false;
    const scrollToItem = vi.fn(() => true);
    const { hook } = setup({
      isItemVisible: () => visible,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    expect(hook.result.current.navigationPending).toBe(true);
    expect(scrollToItem).toHaveBeenCalledTimes(1);

    visible = true;
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);
    expect(scrollToItem).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit explicit navigation when an earlier projection changes", async () => {
    let visible = true;
    const scrollToItem = vi.fn(() => true);
    const { hook } = setup({
      isItemVisible: () => visible,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    expect(hook.result.current.navigationPending).toBe(true);

    visible = false;
    act(() => {
      hook.result.current.notifyProjectionChanged(["section:a"]);
      hook.result.current.tryPendingNavigation();
    });
    expect(scrollToItem).toHaveBeenCalledOnce();
    expect(hook.result.current.navigationPending).toBe(true);

    visible = true;
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("resumeSelectedNavigation only advances the settled watermark while the target stays visible", async () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);

    applyNavigationDemand.mockClear();
    act(() => {
      // projection change can re-arm navigation for the still-selected entry
      hook.result.current.notifyProjectionChanged();
      hook.result.current.resumeSelectedNavigation();
    });
    // 目标仍可见:不得重压排他 demand。排他会取消其它在飞加载,
    // 被取消项的重投影又推动 revision 变化,形成 resume 活锁。
    expect(applyNavigationDemand).not.toHaveBeenCalled();
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("resumeSelectedNavigation does not re-scroll when target is already projected", async () => {
    let visible = true;
    const scrollToItem = vi.fn(() => true);
    const { applyNavigationDemand, hook } = setup({
      isItemVisible: () => visible,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);

    applyNavigationDemand.mockClear();
    scrollToItem.mockClear();
    visible = false;
    act(() => {
      hook.result.current.notifyProjectionChanged(["section:a"]);
      hook.result.current.resumeSelectedNavigation();
    });
    // 终态：已投影则用户拥有滚动；resume 不得 align:start 再 scroll。
    expect(applyNavigationDemand).not.toHaveBeenCalled();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("beginNavigation scrolls to the exact staged/unstaged tree section", async () => {
    const applyNavigationDemand = vi.fn();
    const scrollToItem = vi.fn(() => true);
    const loader = {
      getResource: vi.fn(() => ({
        document: patchDocument({
          entryKey: "entry:a",
          patch: "diff-u",
          revision: "document:a",
          sectionKey: "section:s",
        }),
        entry: {
          entryKey: "entry:a",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [
            {
              group: "unstaged" as const,
              oldPath: null,
              sectionKey: "section:u",
              status: "modified" as const,
              targetPath: "a.ts",
            },
            {
              group: "staged" as const,
              oldPath: null,
              sectionKey: "section:s",
              status: "modified" as const,
              targetPath: "a.ts",
            },
          ],
          status: "modified" as const,
        },
        kind: "loaded" as const,
      })),
      isSettled: () => true,
      setProtectedEntryKey: vi.fn(),
      setStickyMemberEntryKeys: vi.fn(),
    };
    const refs = {
      applyNavigationDemand,
      diffHandleRef: {
        current: {
          getViewportLayoutKey: (targetItemId?: string) =>
            `layout:${targetItemId ?? "none"}`,
          isItemVisible: () => true,
          isViewportReady: () => true,
          requestViewportLayoutSettled: (
            _targetItemId: string,
            _stableFrames: number,
            callback: () => void
          ) => {
            queueMicrotask(callback);
            return () => undefined;
          },
          scrollToItem,
        },
      },
      documentGenerationRef: { current: 1 },
      entryKeyBySectionIdRef: {
        current: new Map([
          ["section:u", "entry:a"],
          ["section:s", "entry:a"],
        ]),
      },
      firstSectionIdByEntryKeyRef: {
        current: new Map([["entry:a", "section:u"]]),
      },
      itemCacheKeysRef: {
        current: new Map([
          ["section:u", "document:a:section:u"],
          ["section:s", "document:a:section:s"],
        ]),
      },
      itemIndexByIdRef: {
        current: new Map([
          ["section:u", 0],
          ["section:s", 1],
        ]),
      },
      loaderRef: { current: loader },
      renderedGenerationRef: { current: 1 },
    };
    const hook = renderHook(() => useGitReviewNavigation(refs as never));
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:s",
      });
    });
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    // 树导航只提交一次即时定位，不再启动动画后的纠正链。
    expect(scrollToItem).toHaveBeenCalledWith("section:s", {
      behavior: "instant",
      expandCollapsed: true,
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
  });

  it("refresh rebinds selected section identity without scrolling", async () => {
    let visible = true;
    const scrollToItem = vi.fn(() => true);
    const { applyNavigationDemand, hook, refs } = setup({
      isItemVisible: () => visible,
      scrollToItem,
    });
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    act(() => {
      hook.result.current.tryPendingNavigation();
    });
    acknowledgeTargetWindow(hook);
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);

    // stage: old section:a 消失，新 section:a-staged 成为该 entry 唯一 slot
    refs.entryKeyBySectionIdRef.current = new Map([
      ["section:a-staged", "entry:a"],
    ]);
    refs.firstSectionIdByEntryKeyRef.current = new Map([
      ["entry:a", "section:a-staged"],
    ]);
    refs.itemCacheKeysRef.current = new Map([
      ["section:a-staged", "document:a:section:a-staged"],
    ]);
    refs.itemIndexByIdRef.current = new Map([["section:a-staged", 0]]);
    // 旧 id 离开视口；新 id 尚未滚入
    visible = false;
    applyNavigationDemand.mockClear();
    scrollToItem.mockClear();
    act(() => {
      hook.result.current.resumeSelectedNavigation();
    });
    expect(applyNavigationDemand).not.toHaveBeenCalled();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(hook.result.current.getSelectedSectionKey()).toBe(
      "section:a-staged"
    );
  });
});
