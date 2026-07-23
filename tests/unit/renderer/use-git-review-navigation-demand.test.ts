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

  it("resumeSelectedNavigation reapplies demand when the target left the viewport", async () => {
    let visible = true;
    const { applyNavigationDemand, hook } = setup({
      isItemVisible: () => visible,
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
    visible = false;
    act(() => {
      hook.result.current.notifyProjectionChanged();
      hook.result.current.resumeSelectedNavigation();
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.navigationPending).toBe(true);
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
});
