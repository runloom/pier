import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGitReviewNavigation } from "../../../src/plugins/builtin/git/renderer/use-git-review-navigation.ts";

function setup(options?: {
  readonly isItemVisible?: () => boolean;
  readonly scrollToItem?: () => boolean;
}) {
  const applyNavigationDemand = vi.fn();
  const loader = {
    getResource: vi.fn(() => ({
      document: {
        kind: "ok" as const,
        revision: "document:a",
        sections: [
          {
            kind: "patch" as const,
            patch: "diff",
            sectionKey: "section:a",
          },
        ],
      },
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
  };
  const refs = {
    applyNavigationDemand,
    diffHandleRef: {
      current: {
        isItemVisible: options?.isItemVisible ?? (() => true),
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
      current: new Map([["section:a", "document:a:section:a"]]),
    },
    itemIndexByIdRef: { current: new Map([["section:a", 0]]) },
    loaderRef: { current: loader },
    pendingAnchorRef: { current: null },
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

describe("useGitReviewNavigation demand sync", () => {
  it("beginNavigation applies exclusive demand immediately", () => {
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

  it("beginGeneration keep-selected reapplies exclusive demand", () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation({
        entryKey: "entry:a",
        sectionKey: "section:a",
      });
    });
    applyNavigationDemand.mockClear();
    act(() => {
      hook.result.current.beginGeneration(new Set(["entry:a"]), 2);
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
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

  it("resumeSelectedNavigation scrolls without exclusive demand when projected but off-screen", async () => {
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
    await flushFrames();
    expect(hook.result.current.navigationPending).toBe(false);

    applyNavigationDemand.mockClear();
    scrollToItem.mockClear();
    visible = false;
    act(() => {
      hook.result.current.notifyProjectionChanged(["section:a"]);
      hook.result.current.resumeSelectedNavigation();
    });
    // 已投影：只 scroll，不排他 demand（否则 cancel 其它 seed 形成 thrash）。
    expect(applyNavigationDemand).not.toHaveBeenCalled();
    expect(scrollToItem).toHaveBeenCalledWith("section:a");
    expect(hook.result.current.navigationPending).toBe(false);
  });

  it("beginNavigation scrolls the requested sectionKey not the first section", async () => {
    const applyNavigationDemand = vi.fn();
    const scrollToItem = vi.fn(() => true);
    const loader = {
      getResource: vi.fn(() => ({
        document: {
          kind: "ok" as const,
          revision: "document:a",
          sections: [
            {
              kind: "patch" as const,
              patch: "diff-u",
              sectionKey: "section:u",
            },
            {
              kind: "patch" as const,
              patch: "diff-s",
              sectionKey: "section:s",
            },
          ],
        },
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
    };
    const refs = {
      applyNavigationDemand,
      diffHandleRef: {
        current: {
          isItemVisible: () => true,
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
      pendingAnchorRef: { current: null },
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
    expect(scrollToItem).toHaveBeenCalledWith("section:s");
    expect(scrollToItem).not.toHaveBeenCalledWith("section:u");
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
  });

  it("resume rebinds sectionKey when stage moves the selected slot", async () => {
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
    expect(scrollToItem).toHaveBeenCalledWith("section:a-staged");
    expect(hook.result.current.getSelectedSectionKey()).toBe(
      "section:a-staged"
    );
  });
});
