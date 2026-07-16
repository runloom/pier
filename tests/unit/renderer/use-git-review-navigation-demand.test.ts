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
      hook.result.current.beginNavigation("entry:a");
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.navigationPending).toBe(true);
  });

  it("beginGeneration keep-selected reapplies exclusive demand", () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation("entry:a");
    });
    applyNavigationDemand.mockClear();
    act(() => {
      hook.result.current.beginGeneration(new Set(["entry:a"]), 2);
    });
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
  });

  it("resumeSelectedNavigation reapplies demand after a completed navigation", async () => {
    const { applyNavigationDemand, hook } = setup();
    act(() => {
      hook.result.current.beginNavigation("entry:a");
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
    expect(applyNavigationDemand).toHaveBeenCalledWith("entry:a");
    expect(hook.result.current.navigationPending).toBe(true);
  });
});
