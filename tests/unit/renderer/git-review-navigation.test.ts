import type { GitReviewDocumentLoaderSnapshot } from "@plugins/builtin/git/renderer/git-review-document-resource.ts";
import {
  findReviewNavigationTarget,
  isReviewNavigationContentReady,
  isReviewNavigationTerminal,
  NAVIGATION_MAX_RESCROLL_ATTEMPTS,
  resolveReviewSectionKey,
  scheduleReviewNavigationVerification,
  shouldScrollReviewNavigation,
} from "@plugins/builtin/git/renderer/git-review-navigation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function frameHarness(): {
  flushFrame(): void;
} {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback) => {
      frames.push(callback);
      return frames.length;
    }
  );
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(
    () => undefined
  );
  return {
    flushFrame() {
      const pending = [...frames];
      frames.length = 0;
      for (const frame of pending) {
        frame(0);
      }
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Review navigation verification", () => {
  it("状态 section 使用投影缓存身份导航且不被判为终态", () => {
    const snapshot = {
      retainedEntryKeys: ["entry:binary"],
      resources: [
        {
          document: {
            kind: "ok",
            revision: "document:binary",
            sections: [
              {
                kind: "state",
                oldPath: null,
                reason: "binary",
                sectionKey: "state:binary",
                status: "modified",
                targetPath: "src/binary.dat",
              },
            ],
          },
          entry: {
            entryKey: "entry:binary",
            oldPaths: [],
            path: "src/binary.dat",
            renderSlots: [
              {
                group: "unstaged",
                oldPath: null,
                sectionKey: "state:binary",
                status: "modified",
                targetPath: "src/binary.dat",
              },
            ],
            status: "modified",
          },
          kind: "loaded",
        },
      ],
      settled: true,
    } satisfies GitReviewDocumentLoaderSnapshot;
    const cacheKey = '["document:binary","state:binary","en"]';

    expect(
      findReviewNavigationTarget(
        snapshot.resources[0],
        new Map([["state:binary", cacheKey]])
      )
    ).toEqual({ cacheKey, sectionId: "state:binary" });
    expect(
      isReviewNavigationTerminal(snapshot.resources[0], snapshot.settled)
    ).toBe(false);
  });

  it("resolveReviewSectionKey rebinds when preferred left the entry", () => {
    expect(
      resolveReviewSectionKey({
        entryKey: "entry:a",
        entryKeyBySectionId: new Map([["section:staged", "entry:a"]]),
        firstSectionIdByEntryKey: new Map([["entry:a", "section:staged"]]),
        preferredSectionKey: "section:unstaged",
      })
    ).toBe("section:staged");
    expect(
      resolveReviewSectionKey({
        entryKey: "entry:a",
        entryKeyBySectionId: new Map([
          ["section:unstaged", "entry:a"],
          ["section:staged", "entry:a"],
        ]),
        firstSectionIdByEntryKey: new Map([["entry:a", "section:unstaged"]]),
        preferredSectionKey: "section:staged",
      })
    ).toBe("section:staged");
  });

  it("isReviewNavigationTerminal when settled resource lacks orphan sectionKey", () => {
    const entry = {
      entryKey: "entry:a",
      oldPaths: [] as string[],
      path: "a.ts",
      renderSlots: [
        {
          group: "staged" as const,
          oldPath: null,
          sectionKey: "section:staged",
          status: "modified" as const,
          targetPath: "a.ts",
        },
      ],
      status: "modified" as const,
    };
    const loaded = {
      document: {
        kind: "ok" as const,
        revision: "r",
        sections: [
          {
            kind: "patch" as const,
            patch: "diff",
            sectionKey: "section:staged",
          },
        ],
      },
      entry,
      kind: "loaded" as const,
    };
    expect(isReviewNavigationTerminal(loaded, true, "section:unstaged")).toBe(
      true
    );
    expect(isReviewNavigationTerminal(loaded, true, "section:staged")).toBe(
      false
    );
    expect(
      isReviewNavigationTerminal(
        { entry, kind: "unchanged" },
        true,
        "section:unstaged"
      )
    ).toBe(true);
    expect(
      isReviewNavigationTerminal(
        { entry, kind: "unchanged" },
        true,
        "section:staged"
      )
    ).toBe(false);
  });

  it("findReviewNavigationTarget prefers explicit sectionKey over first section", () => {
    const resource = {
      document: {
        kind: "ok" as const,
        revision: "document:a",
        sections: [
          {
            kind: "patch" as const,
            patch: "u",
            sectionKey: "section:u",
          },
          {
            kind: "patch" as const,
            patch: "s",
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
    };
    const cacheKeys = new Map([
      ["section:u", "cache:u"],
      ["section:s", "cache:s"],
    ]);
    expect(findReviewNavigationTarget(resource, cacheKeys)).toEqual({
      cacheKey: "cache:u",
      sectionId: "section:u",
    });
    expect(
      findReviewNavigationTarget(resource, cacheKeys, "section:s")
    ).toEqual({
      cacheKey: "cache:s",
      sectionId: "section:s",
    });
  });

  it("locks product default maxRescrollAttempts at 0", () => {
    expect(NAVIGATION_MAX_RESCROLL_ATTEMPTS).toBe(0);
  });

  it("默认不重发 scrollTo，仅观测可见性直至进入视口", () => {
    const frames = frameHarness();
    const onVisible = vi.fn();
    const scrollToItem = vi.fn(() => true);
    const isVisible = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);

    // 主路径 scrollTo 由调用方触发一次；verify 默认 maxRescroll=0
    scheduleReviewNavigationVerification({
      getSectionId: () => "section:1999",
      isCurrent: () => true,
      isTerminal: () => false,
      isVisible,
      onTerminal: vi.fn(),
      onTimeout: vi.fn(),
      onVisible,
      scrollToItem,
    });
    frames.flushFrame();
    frames.flushFrame();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(onVisible).not.toHaveBeenCalled();

    frames.flushFrame();
    frames.flushFrame();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(onVisible).toHaveBeenCalledOnce();
  });

  it("显式 maxRescroll 时才有界重发定位", () => {
    const frames = frameHarness();
    const onTimeout = vi.fn();
    const onVisible = vi.fn();
    const scrollToItem = vi.fn(() => true);
    let checks = 0;
    const isVisible = vi.fn(() => {
      checks += 1;
      return checks > 3;
    });

    scheduleReviewNavigationVerification({
      getSectionId: () => "section:2000",
      isCurrent: () => true,
      isTerminal: () => false,
      isVisible,
      maxRescrollAttempts: 2,
      onTerminal: vi.fn(),
      onTimeout,
      onVisible,
      scrollToItem,
    });
    for (let frame = 0; frame < 20; frame += 1) {
      frames.flushFrame();
    }

    expect(scrollToItem.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onVisible).toHaveBeenCalledOnce();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("超过截止时间后停止重试并交给 UI 反馈", () => {
    const frames = frameHarness();
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(5000);
    const onTimeout = vi.fn();

    scheduleReviewNavigationVerification({
      getSectionId: () => "section:1",
      isCurrent: () => true,
      isTerminal: () => false,
      isVisible: () => false,
      onTerminal: vi.fn(),
      onTimeout,
      onVisible: vi.fn(),
      scrollToItem: vi.fn(() => true),
    });
    frames.flushFrame();
    frames.flushFrame();

    expect(onTimeout).toHaveBeenCalledOnce();
  });
});

describe("Review navigation content readiness", () => {
  it("scrolls when ledger has estimate or loaded cacheKey (stable-ledger)", () => {
    expect(
      shouldScrollReviewNavigation({
        projectedCacheKey: "git-review-placeholder:section:1",
        resource: {
          entry: {
            entryKey: "entry:1",
            oldPaths: [],
            path: "a.ts",
            renderSlots: [],
            status: "modified",
          },
          kind: "loading",
          operationId: "op-1",
        },
      })
    ).toBe(false);
    // estimate 账本可滚（不要求 body loaded）
    expect(
      shouldScrollReviewNavigation({
        projectedCacheKey: "estimate:section:1",
        resource: {
          entry: {
            entryKey: "entry:1",
            oldPaths: [],
            path: "a.ts",
            renderSlots: [],
            status: "modified",
          },
          kind: "loading",
          operationId: "op-1",
        },
      })
    ).toBe(true);
    expect(
      shouldScrollReviewNavigation({
        projectedCacheKey: "document:1:section:1",
        resource: {
          document: {
            kind: "ok",
            revision: "r1",
            sections: [],
          },
          entry: {
            entryKey: "entry:1",
            oldPaths: [],
            path: "a.ts",
            renderSlots: [],
            status: "modified",
          },
          kind: "loaded",
        },
      })
    ).toBe(true);
  });

  it("treats only loaded/error documents as navigation-ready content", () => {
    expect(isReviewNavigationContentReady(undefined)).toBe(false);
    expect(
      isReviewNavigationContentReady({
        entry: {
          entryKey: "entry:1",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [],
          status: "modified",
        },
        kind: "idle",
      })
    ).toBe(false);
    expect(
      isReviewNavigationContentReady({
        document: {
          revision: "r1",
          sections: [],
        },
        entry: {
          entryKey: "entry:1",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [],
          status: "modified",
        },
        kind: "loaded",
      } as never)
    ).toBe(true);
  });
});
