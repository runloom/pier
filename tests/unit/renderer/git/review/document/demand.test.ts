import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { describe, expect, it } from "vitest";
import {
  composeReviewDocumentDemand,
  GIT_REVIEW_MAX_FULL_BODY_ENTRIES,
  GIT_REVIEW_SEED_BATCH_MAX,
  GIT_REVIEW_SEED_BATCH_MIN,
  gitReviewLookaheadEntryKeys,
  gitReviewSeedEntryKeys,
  gitReviewSelectionRadiusEntryKeys,
  mergeReviewDocumentDemand,
  prioritizeReviewNavigationDemand,
  reviewDocumentDemandForRenderWindow,
  selectBodyHydrationPriorityEntryKeys,
} from "../../../../../../src/plugins/builtin/git/renderer/review/document/demand.ts";

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

  it("导航期间只 boost selected 到队首，不 exclusive 缩 demand", () => {
    const demand = {
      bufferedEntryKeys: ["entry:9", "entry:11"],
      visibleEntryKeys: ["entry:10", "entry:12"],
    };

    expect(prioritizeReviewNavigationDemand(demand, "entry:10", true)).toEqual({
      bufferedEntryKeys: ["entry:9", "entry:11"],
      visibleEntryKeys: ["entry:10", "entry:12"],
    });
    expect(prioritizeReviewNavigationDemand(demand, "entry:12", true)).toEqual({
      bufferedEntryKeys: ["entry:9", "entry:11"],
      visibleEntryKeys: ["entry:12", "entry:10"],
    });
    expect(prioritizeReviewNavigationDemand(demand, "entry:99", true)).toEqual({
      bufferedEntryKeys: ["entry:9", "entry:11"],
      visibleEntryKeys: ["entry:99", "entry:10", "entry:12"],
    });
    expect(prioritizeReviewNavigationDemand(demand, "entry:10", false)).toBe(
      demand
    );
  });
});

describe("gitReviewSeedEntryKeys", () => {
  it("clamps seed size to viewport-first [MIN, MAX] using estimate slot height", () => {
    const keys = Array.from({ length: 200 }, (_, index) => `entry:${index}`);
    // 默认 ~168px/槽 × 800px 视口 → 约 5+1，仍夹到 MIN
    expect(gitReviewSeedEntryKeys(keys)).toHaveLength(
      GIT_REVIEW_SEED_BATCH_MIN
    );
    expect(
      gitReviewSeedEntryKeys(keys, {
        itemHeightPx: 10,
        viewportHeightPx: 2000,
      })
    ).toHaveLength(GIT_REVIEW_SEED_BATCH_MAX);
    expect(
      gitReviewSeedEntryKeys(keys, {
        itemHeightPx: 400,
        viewportHeightPx: 100,
      })
    ).toHaveLength(GIT_REVIEW_SEED_BATCH_MIN);
    expect(gitReviewSeedEntryKeys(keys.slice(0, 4))).toEqual(keys.slice(0, 4));
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
  it("prefetches both sides of the window demand span", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `entry:${index}`);
    // 前沿锚在**可见**窗口（entry:0），不是 visible ∪ buffered：
    // buffered 是上一轮 lookahead 的产物，用它当锚会让 demand 追自己的尾巴，
    // 与投影成员 / Pierre 渲染窗口构成无滞回闭环并永久摆动。
    // 带宽 = [minVisible-2, maxVisible+2] → 下标 1、2；entry:1 已在 demand 内。
    expect(
      gitReviewLookaheadEntryKeys(
        keys,
        new Set(),
        {
          bufferedEntryKeys: ["entry:1"],
          visibleEntryKeys: ["entry:0"],
        },
        2
      )
    ).toEqual(["entry:2"]);
    // 稳定性不变量：buffered 不得推动前沿。
    // buffered 是上一轮 lookahead 的产物，而 demand → 投影成员 → Pierre 渲染窗口
    // → demand 是个闭环。若 buffered 参与算前沿，「全部渲染 → 前沿 +lookahead →
    // 装不下 → 前沿回缩」会在两态间永久摆动（实测投影成员 29 ↔ 33 每帧翻转）。
    const visibleOnly = gitReviewLookaheadEntryKeys(
      keys,
      new Set(),
      { bufferedEntryKeys: [], visibleEntryKeys: ["entry:5"] },
      2
    );
    const withFarBuffered = gitReviewLookaheadEntryKeys(
      keys,
      new Set(),
      {
        bufferedEntryKeys: ["entry:8", "entry:9"],
        visibleEntryKeys: ["entry:5"],
      },
      2
    );
    expect(withFarBuffered).toEqual(visibleOnly);
    // span 仅 entry:2 → after 3,4；before 1,0（prefetch 不再过滤邻项）
    expect(
      gitReviewLookaheadEntryKeys(
        keys,
        new Set(["entry:1"]),
        {
          bufferedEntryKeys: ["entry:2"],
          visibleEntryKeys: [],
        },
        2
      )
    ).toEqual(["entry:3", "entry:1", "entry:4", "entry:0"]);
    expect(
      gitReviewLookaheadEntryKeys(keys, new Set(), {
        bufferedEntryKeys: [],
        visibleEntryKeys: [],
      })
    ).toEqual([]);
  });
});

describe("gitReviewSelectionRadiusEntryKeys", () => {
  it("returns neighbors around the selection", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `entry:${index}`);
    expect(gitReviewSelectionRadiusEntryKeys(keys, "entry:5", 2)).toEqual([
      "entry:4",
      "entry:6",
      "entry:3",
      "entry:7",
    ]);
    expect(gitReviewSelectionRadiusEntryKeys(keys, null, 2)).toEqual([]);
  });
});

describe("selectBodyHydrationPriorityEntryKeys", () => {
  it("emits stable index order, not pin-first", () => {
    const keys = Array.from({ length: 200 }, (_, index) => `entry:${index}`);
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: ["entry:50"],
        visibleEntryKeys: ["entry:10"],
      },
      entryKeysInOrder: keys,
      maxMembers: 5,
      selectedEntryKey: "entry:99",
    });
    // pin = 10,50,99 → |pin|=3，再按 index 填 0,1 → 0,1,10,50,99
    expect(selected).toEqual([
      "entry:0",
      "entry:1",
      "entry:10",
      "entry:50",
      "entry:99",
    ]);
  });

  it("never truncates pin set even when larger than maxMembers", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `entry:${index}`);
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: keys.slice(3, 8),
        visibleEntryKeys: keys.slice(0, 3),
      },
      entryKeysInOrder: keys,
      maxMembers: 2,
      selectedEntryKey: "entry:9",
    });
    expect(selected.length).toBeGreaterThan(2);
    expect(selected).toContain("entry:9");
    expect(selected).toContain("entry:0");
  });

  it("tree-nav keeps sticky members and does not set-swap by index prefix", () => {
    const keys = Array.from({ length: 20 }, (_, index) => `entry:${index}`);
    const previous = ["entry:10", "entry:11", "entry:12"];
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:15"],
      },
      entryKeysInOrder: keys,
      maxMembers: 5,
      navigationPending: true,
      navigationReason: "tree",
      previousMemberEntryKeys: previous,
      selectedEntryKey: "entry:15",
    });
    // pin={15} + sticky={10,11,12}；保护期禁止 fill，不得插 entry:0 改拓扑
    // index 序：10,11,12,15
    expect(selected).toEqual(["entry:10", "entry:11", "entry:12", "entry:15"]);
    for (const key of previous) {
      expect(selected).toContain(key);
    }
  });

  it("tree-nav retains all sticky even when pin∪sticky exceeds maxMembers", () => {
    const keys = Array.from({ length: 20 }, (_, index) => `entry:${index}`);
    const previous = [
      "entry:10",
      "entry:11",
      "entry:12",
      "entry:13",
      "entry:14",
    ];
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:15", "entry:16"],
      },
      entryKeysInOrder: keys,
      maxMembers: 3,
      navigationPending: true,
      navigationReason: "tree",
      previousMemberEntryKeys: previous,
      selectedEntryKey: "entry:15",
    });
    // pin={15,16} + sticky={10..14} → 可暂超 cap；fill 预算为 0，无 entry:0 前缀
    expect(selected).toEqual([
      "entry:10",
      "entry:11",
      "entry:12",
      "entry:13",
      "entry:14",
      "entry:15",
      "entry:16",
    ]);
  });

  it("userScrolling keeps pinnedPrefix even when over maxMembers", () => {
    const keys = Array.from({ length: 30 }, (_, index) => `entry:${index}`);
    const pinnedPrefix = [
      "entry:5",
      "entry:6",
      "entry:7",
      "entry:8",
      "entry:9",
    ];
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:20"],
      },
      entryKeysInOrder: keys,
      maxMembers: 2,
      pinnedPrefixEntryKeys: pinnedPrefix,
      previousMemberEntryKeys: pinnedPrefix,
      readingMode: "userScrolling",
      selectedEntryKey: "entry:20",
    });
    expect(selected.length).toBeGreaterThan(2);
    for (const key of pinnedPrefix) {
      expect(selected).toContain(key);
    }
    expect(selected).toContain("entry:20");
    // 不得裁 pin 换成纯前缀 fill
    expect(selected).not.toEqual(keys.slice(0, 2));
  });

  it("idle may drop sticky-only members back to maxMembers", () => {
    const keys = Array.from({ length: 20 }, (_, index) => `entry:${index}`);
    const previous = keys.slice(0, 10);
    const selected = selectBodyHydrationPriorityEntryKeys({
      candidateEntryKeys: keys,
      demand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:0"],
      },
      entryKeysInOrder: keys,
      maxMembers: 3,
      previousMemberEntryKeys: previous,
      readingMode: "idle",
      selectedEntryKey: "entry:0",
    });
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected).toContain("entry:0");
  });

  it("exposes a stable product default cap", () => {
    expect(GIT_REVIEW_MAX_FULL_BODY_ENTRIES).toBe(128);
  });
});

describe("composeReviewDocumentDemand", () => {
  it("uses seed only before window; then window + lookahead + selection radius", () => {
    const keys = Array.from({ length: 40 }, (_, index) => `entry:${index}`);
    const seed = gitReviewSeedEntryKeys(keys);
    const sticky = new Set(["entry:5", "entry:30"]);
    const composed = composeReviewDocumentDemand({
      entryKeysInOrder: keys,
      navigationPending: false,
      seedEntryKeys: seed,
      selectedEntryKey: "entry:5",
      demandPrefetchEntryKeys: sticky,
      windowDemand: {
        bufferedEntryKeys: ["entry:30"],
        visibleEntryKeys: ["entry:5"],
      },
      lookahead: 2,
      selectionRadius: 1,
    });
    // window 已 active：seed 退居 buffered（继续水合，不 cancel）
    expect(composed.visibleEntryKeys).toEqual(["entry:5"]);
    expect(composed.visibleEntryKeys).not.toContain("entry:0");
    // lookahead 带宽绕**可见**项（entry:5）展开 → 3،4،6،7；
    // entry:30 只是 buffered，仍在取数单内但不再把前沿推到 entry:31。
    expect(composed.bufferedEntryKeys).toEqual(
      expect.arrayContaining([
        "entry:0",
        "entry:30",
        "entry:7",
        "entry:4",
        "entry:6",
      ])
    );
    expect(composed.bufferedEntryKeys).not.toContain("entry:31");
    // 无 window 时仍 seed
    const seeded = composeReviewDocumentDemand({
      entryKeysInOrder: keys,
      navigationPending: false,
      seedEntryKeys: seed,
      selectedEntryKey: null,
      demandPrefetchEntryKeys: new Set(),
      windowDemand: { bufferedEntryKeys: [], visibleEntryKeys: [] },
    });
    expect(seeded.visibleEntryKeys).toEqual(seed);
    // nav：boost 目标到队首，且不新开目标上方的 window/lookahead。
    const nav = composeReviewDocumentDemand({
      entryKeysInOrder: keys,
      navigationPending: true,
      seedEntryKeys: seed,
      selectedEntryKey: "entry:39",
      demandPrefetchEntryKeys: new Set(),
      windowDemand: {
        bufferedEntryKeys: ["entry:6"],
        visibleEntryKeys: ["entry:5"],
      },
    });
    expect(nav.visibleEntryKeys).toEqual(["entry:39"]);
    expect(nav.bufferedEntryKeys).not.toContain("entry:5");
    expect(nav.bufferedEntryKeys).not.toContain("entry:6");
  });

  it("tree-nav demand excludes not-yet-loaded predecessors above the target", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `entry:${index}`);
    const demand = composeReviewDocumentDemand({
      entryKeysInOrder: keys,
      navigationPending: true,
      seedEntryKeys: keys.slice(0, 4),
      selectedEntryKey: "entry:8",
      demandPrefetchEntryKeys: new Set(),
      windowDemand: {
        bufferedEntryKeys: ["entry:6", "entry:10"],
        visibleEntryKeys: ["entry:7", "entry:8", "entry:9"],
      },
      lookahead: 0,
      selectionRadius: 0,
    });
    expect(demand.visibleEntryKeys).toEqual(["entry:8", "entry:9"]);
    expect(demand.bufferedEntryKeys).toEqual(["entry:10"]);
    expect(demand.visibleEntryKeys).not.toContain("entry:7");
    expect(demand.bufferedEntryKeys).not.toContain("entry:6");
  });

  it("导航完成但选择仍受保护时只允许目标及其后序窗口水合", () => {
    const keys = Array.from({ length: 10 }, (_, index) => `entry:${index}`);
    expect(
      composeReviewDocumentDemand({
        entryKeysInOrder: keys,
        navigationPending: false,
        protectSelectedAnchor: true,
        seedEntryKeys: [],
        selectedEntryKey: "entry:5",
        demandPrefetchEntryKeys: new Set(),
        windowDemand: {
          bufferedEntryKeys: ["entry:3", "entry:7"],
          visibleEntryKeys: ["entry:4", "entry:5", "entry:6"],
        },
        lookahead: 0,
        selectionRadius: 0,
      })
    ).toEqual({
      bufferedEntryKeys: ["entry:7"],
      visibleEntryKeys: ["entry:5", "entry:6"],
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
