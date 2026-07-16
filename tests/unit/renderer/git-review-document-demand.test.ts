import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { describe, expect, it } from "vitest";
import {
  composeReviewDocumentDemand,
  GIT_REVIEW_SEED_BATCH_MAX,
  GIT_REVIEW_SEED_BATCH_MIN,
  gitReviewLookaheadEntryKeys,
  gitReviewSeedEntryKeys,
  mergeReviewDocumentDemand,
  prioritizeReviewNavigationDemand,
  reviewDocumentDemandForRenderWindow,
} from "../../../src/plugins/builtin/git/renderer/git-review-document-demand.ts";

function entry(index: number): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

describe("reviewDocumentDemandForRenderWindow", () => {
  it("returns no document demand before Pierre reports a window", () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const entryKeyBySectionId = new Map(
      entries.map(
        (item) => [firstSlot(item).sectionKey, item.entryKey] as const
      )
    );

    expect(
      reviewDocumentDemandForRenderWindow(
        entryKeyBySectionId,
        new Set(entries.map((item) => item.entryKey)),
        {
          bufferedItemIds: [],
          visibleItemIds: [],
        }
      )
    ).toEqual({ bufferedEntryKeys: [], visibleEntryKeys: [] });
  });

  it("ignores stale section mappings without scanning the full entry list", () => {
    expect(
      reviewDocumentDemandForRenderWindow(
        new Map([
          ["section:current", "entry:current"],
          ["section:stale", "entry:stale"],
        ]),
        new Set(["entry:current"]),
        {
          bufferedItemIds: ["section:stale"],
          visibleItemIds: ["section:current"],
        }
      )
    ).toEqual({ bufferedEntryKeys: [], visibleEntryKeys: ["entry:current"] });
  });

  it("maps exactly the official visible and buffered items without extra neighbors", () => {
    const entries = Array.from({ length: 209 }, (_, index) => entry(index));
    const entryKeyBySectionId = new Map(
      entries.map(
        (item) => [firstSlot(item).sectionKey, item.entryKey] as const
      )
    );

    expect(
      reviewDocumentDemandForRenderWindow(
        entryKeyBySectionId,
        new Set(entries.map((item) => item.entryKey)),
        {
          bufferedItemIds: ["section:99", "section:103", "unknown"],
          visibleItemIds: ["section:100", "section:101", "section:100"],
        }
      )
    ).toEqual({
      bufferedEntryKeys: ["entry:99", "entry:103"],
      visibleEntryKeys: ["entry:100", "entry:101"],
    });
  });

  it("deduplicates multiple section slots that belong to one file", () => {
    const item = entry(0);
    const secondSection: GitReviewIndexEntry["renderSlots"][number] = {
      ...firstSlot(item),
      group: "staged" as const,
      sectionKey: "section:0:staged",
    };
    const entries: GitReviewIndexEntry[] = [
      { ...item, renderSlots: [firstSlot(item), secondSection] },
    ];
    const mapping = new Map([
      ["section:0", "entry:0"],
      ["section:0:staged", "entry:0"],
    ]);

    expect(
      reviewDocumentDemandForRenderWindow(
        mapping,
        new Set(entries.map((candidate) => candidate.entryKey)),
        {
          bufferedItemIds: ["section:0:staged"],
          visibleItemIds: ["section:0"],
        }
      )
    ).toEqual({ bufferedEntryKeys: [], visibleEntryKeys: ["entry:0"] });
  });

  it("导航期间强制加载所选目标，即使它还不在 Pierre 当前窗口", () => {
    const demand = {
      bufferedEntryKeys: ["entry:9", "entry:11"],
      visibleEntryKeys: ["entry:10", "entry:12"],
    };

    expect(prioritizeReviewNavigationDemand(demand, "entry:10", true)).toEqual({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:10"],
    });
    // 窗口外点击：目标不在 visible/buffered 时也必须进入可见需求。
    expect(prioritizeReviewNavigationDemand(demand, "entry:99", true)).toEqual({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:99"],
    });
    expect(prioritizeReviewNavigationDemand(demand, "entry:10", false)).toBe(
      demand
    );
  });
});

describe("gitReviewSeedEntryKeys", () => {
  it("clamps seed size between 25 and 96", () => {
    const keys = Array.from({ length: 200 }, (_, index) => `entry:${index}`);
    expect(gitReviewSeedEntryKeys(keys)).toHaveLength(
      Math.min(
        GIT_REVIEW_SEED_BATCH_MAX,
        Math.max(GIT_REVIEW_SEED_BATCH_MIN, Math.ceil(800 / 40))
      )
    );
    expect(
      gitReviewSeedEntryKeys(keys, {
        itemHeightPx: 10,
        viewportHeightPx: 2000,
      })
    ).toHaveLength(GIT_REVIEW_SEED_BATCH_MAX);
    expect(
      gitReviewSeedEntryKeys(keys, {
        itemHeightPx: 100,
        viewportHeightPx: 100,
      })
    ).toHaveLength(GIT_REVIEW_SEED_BATCH_MIN);
    expect(gitReviewSeedEntryKeys(keys.slice(0, 10))).toEqual(
      keys.slice(0, 10)
    );
  });
});

describe("mergeReviewDocumentDemand", () => {
  it("deduplicates visible and drops buffered keys already visible", () => {
    expect(
      mergeReviewDocumentDemand(
        {
          bufferedEntryKeys: ["entry:b1", "entry:v1"],
          visibleEntryKeys: ["entry:v1", "entry:v2"],
        },
        {
          bufferedEntryKeys: ["entry:b1", "entry:b2"],
          visibleEntryKeys: ["entry:v2", "entry:v3"],
        }
      )
    ).toEqual({
      bufferedEntryKeys: ["entry:b1", "entry:b2"],
      visibleEntryKeys: ["entry:v1", "entry:v2", "entry:v3"],
    });
  });
});

describe("gitReviewLookaheadEntryKeys", () => {
  it("appends unsticky successors after demand∩sticky max index", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `entry:${index}`);
    // demand 0,1 与 sticky 2 无交集 → 无 lookahead
    expect(
      gitReviewLookaheadEntryKeys(
        keys,
        new Set(["entry:2"]),
        {
          bufferedEntryKeys: ["entry:1"],
          visibleEntryKeys: ["entry:0"],
        },
        2
      )
    ).toEqual([]);
    // demand∩sticky = entry:2 → 取后续 3,4
    expect(
      gitReviewLookaheadEntryKeys(
        keys,
        new Set(["entry:1", "entry:2"]),
        {
          bufferedEntryKeys: ["entry:2"],
          visibleEntryKeys: ["entry:0"],
        },
        2
      )
    ).toEqual(["entry:3", "entry:4"]);
    expect(
      gitReviewLookaheadEntryKeys(keys, new Set(), {
        bufferedEntryKeys: [],
        visibleEntryKeys: [],
      })
    ).toEqual([]);
  });
});

describe("composeReviewDocumentDemand", () => {
  it("keeps seed, window and lookahead together, but nav pending is selected only", () => {
    const keys = Array.from({ length: 40 }, (_, index) => `entry:${index}`);
    const seed = gitReviewSeedEntryKeys(keys);
    const sticky = new Set(["entry:5", "entry:30"]);
    const composed = composeReviewDocumentDemand({
      entryKeysInOrder: keys,
      navigationPending: false,
      seedEntryKeys: seed,
      selectedEntryKey: null,
      demandPrefetchEntryKeys: sticky,
      windowDemand: {
        bufferedEntryKeys: ["entry:30"],
        visibleEntryKeys: ["entry:5"],
      },
    });
    expect(composed.visibleEntryKeys).toEqual(
      expect.arrayContaining(["entry:0", "entry:5"])
    );
    // 窗口∩sticky 最大下标 30 → lookahead 31/32；seed 不参与连锁。
    expect(composed.bufferedEntryKeys).toEqual(
      expect.arrayContaining(["entry:30", "entry:31", "entry:32"])
    );
    expect(
      composeReviewDocumentDemand({
        entryKeysInOrder: keys,
        navigationPending: true,
        seedEntryKeys: seed,
        selectedEntryKey: "entry:39",
        demandPrefetchEntryKeys: new Set(),
        windowDemand: {
          bufferedEntryKeys: ["entry:6"],
          visibleEntryKeys: ["entry:5"],
        },
      })
    ).toEqual({
      bufferedEntryKeys: [],
      visibleEntryKeys: ["entry:39"],
    });
  });
});

function firstSlot(
  item: GitReviewIndexEntry
): GitReviewIndexEntry["renderSlots"][number] {
  const slot = item.renderSlots[0];
  if (!slot) {
    throw new Error("missing render slot");
  }
  return slot;
}
