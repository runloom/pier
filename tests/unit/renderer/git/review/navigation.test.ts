import type { GitReviewDocumentLoaderSnapshot } from "@plugins/builtin/git/renderer/review/document/resource.ts";
import {
  findReviewNavigationTarget,
  isReviewNavigationContentReady,
  isReviewNavigationTerminal,
  MAX_REVIEW_REVEAL_CONTENT_COMMITS,
  MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS,
  MAX_REVIEW_REVEAL_SCROLLS,
  planReviewReveal,
  REVIEW_REVEAL_OFFSET_TOLERANCE_PX,
  readReviewRevealProbe,
  resolveReviewSectionKey,
} from "@plugins/builtin/git/renderer/review/navigation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchDocument, stateDocument } from "./document/fixture.ts";

afterEach(() => vi.restoreAllMocks());

describe("Review navigation verification", () => {
  it("状态 section 使用投影缓存身份导航且不被判为终态", () => {
    const snapshot = {
      retainedEntryKeys: ["entry:binary"],
      resources: [
        {
          document: stateDocument({
            entryKey: "entry:binary",
            path: "src/binary.dat",
            reason: "binary",
            revision: "document:binary",
          }),
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
    const cacheKey = '["document:binary","entry:binary","en"]';

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
      document: patchDocument({
        entryKey: entry.entryKey,
        patch: "diff",
        revision: "r",
      }),
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

  it("findReviewNavigationTarget resolves the requested staged/unstaged section", () => {
    const resource = {
      document: patchDocument({
        entryKey: "entry:a",
        patch: "u",
        revision: "document:a",
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
    ).toEqual({ cacheKey: "cache:s", sectionId: "section:s" });
    expect(
      findReviewNavigationTarget(resource, cacheKeys, "section:orphan")
    ).toBeNull();
  });
});

describe("Review navigation content readiness", () => {
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
        document: patchDocument({
          entryKey: "entry:1",
          patch: "diff",
          revision: "r1",
        }),
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

describe("planReviewReveal", () => {
  const target = { cacheKey: "cache:1", sectionId: "section:1" };
  const progress = {
    cacheKey: "cache:1",
    contentCommits: 0,
    geometryCorrections: 0,
    projectionRevision: 0,
    scrollCount: 1,
    sectionId: "section:1",
  };
  const base = {
    expectedViewportOffset: 0,
    isEstimate: false,
    progress,
    projectionRevision: 1,
    target,
    targetVisible: true,
    viewportOffset: 0,
    viewportReady: true,
    viewportSettled: true,
    windowAcknowledged: true,
  };

  it("exposes the bounded reveal budgets", () => {
    expect(MAX_REVIEW_REVEAL_SCROLLS).toBe(4);
    expect(MAX_REVIEW_REVEAL_CONTENT_COMMITS).toBe(1);
    expect(MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS).toBe(2);
    expect(REVIEW_REVEAL_OFFSET_TOLERANCE_PX).toBe(1);
  });

  it("waits for a ready viewport and a target", () => {
    expect(planReviewReveal({ ...base, viewportReady: false })).toEqual({
      kind: "wait",
    });
    expect(planReviewReveal({ ...base, target: null })).toEqual({
      kind: "wait",
    });
  });

  it("commits the first intent", () => {
    expect(planReviewReveal({ ...base, progress: null })).toEqual({
      kind: "scroll-intent",
    });
  });

  it("waits when the target is still an estimate", () => {
    expect(planReviewReveal({ ...base, isEstimate: true })).toEqual({
      kind: "wait",
    });
  });

  it("commits one content scroll when the cache key changes", () => {
    expect(
      planReviewReveal({ ...base, target: { ...target, cacheKey: "cache:2" } })
    ).toEqual({
      kind: "scroll-content",
      progress: {
        ...progress,
        cacheKey: "cache:2",
        contentCommits: 1,
        projectionRevision: 1,
        scrollCount: 2,
      },
    });
  });

  it("does not commit content twice across cache key changes", () => {
    expect(
      planReviewReveal({
        ...base,
        progress: { ...progress, cacheKey: "cache:2", contentCommits: 1 },
        target: { ...target, cacheKey: "cache:3" },
      })
    ).toEqual({ kind: "settle" });
  });

  it("reads probes from one reveal progress record", () => {
    expect(readReviewRevealProbe(null)).toEqual({
      contentCommitCount: 0,
      geometryCorrectionCount: 0,
      scrollIntentCount: 0,
      scrollToCount: 0,
    });
    expect(
      readReviewRevealProbe({
        ...progress,
        contentCommits: 1,
        geometryCorrections: 2,
        scrollCount: 4,
      })
    ).toEqual({
      contentCommitCount: 1,
      geometryCorrectionCount: 2,
      scrollIntentCount: 1,
      scrollToCount: 4,
    });
  });

  it("does not commit content twice for the same cache key", () => {
    expect(
      planReviewReveal({
        ...base,
        progress: { ...progress, cacheKey: "cache:2", scrollCount: 2 },
        target: { ...target, cacheKey: "cache:2" },
      })
    ).toEqual({ kind: "settle" });
  });

  it("allows at most two geometry corrections", () => {
    const drifted = { ...base, viewportOffset: 120 };
    expect(planReviewReveal(drifted).kind).toBe("scroll-geometry");
    const once = {
      ...progress,
      geometryCorrections: 1,
      scrollCount: 2,
    };
    expect(
      planReviewReveal({
        ...drifted,
        progress: once,
      }).kind
    ).toBe("scroll-geometry");
    expect(
      planReviewReveal({
        ...drifted,
        progress: { ...once, geometryCorrections: 2, scrollCount: 3 },
      }).kind
    ).toBe("settle");
  });

  it("waits for layout to settle before geometry correction", () => {
    expect(
      planReviewReveal({ ...base, viewportOffset: 120, viewportSettled: false })
    ).toEqual({ kind: "wait" });
  });

  it("respects the total scroll budget", () => {
    expect(
      planReviewReveal({
        ...base,
        viewportOffset: 120,
        progress: { ...progress, scrollCount: 4 },
      }).kind
    ).toBe("settle");
  });

  it("settles instead of chasing a new cache key after the scroll budget", () => {
    expect(
      planReviewReveal({
        ...base,
        progress: { ...progress, scrollCount: 4 },
        target: { ...target, cacheKey: "cache:2" },
      })
    ).toEqual({ kind: "settle" });
    expect(
      planReviewReveal({
        ...base,
        progress: { ...progress, scrollCount: 4 },
        target: { ...target, cacheKey: "cache:2" },
        viewportSettled: false,
      })
    ).toEqual({ kind: "wait" });
  });

  it("settles when the target is visible and acknowledged", () => {
    expect(planReviewReveal(base)).toEqual({ kind: "settle" });
  });

  it("does not correct a non-zero anchor offset that matches the viewport", () => {
    expect(
      planReviewReveal({
        ...base,
        expectedViewportOffset: 48,
        viewportOffset: 48,
      })
    ).toEqual({ kind: "settle" });
  });

  it("treats offsets within the tolerance as aligned", () => {
    expect(
      planReviewReveal({
        ...base,
        expectedViewportOffset: 48,
        viewportOffset: 48 + REVIEW_REVEAL_OFFSET_TOLERANCE_PX,
      })
    ).toEqual({ kind: "settle" });
  });
});
