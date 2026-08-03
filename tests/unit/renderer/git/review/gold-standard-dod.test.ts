import { describe, expect, it, vi } from "vitest";
import {
  classifyReviewSlotBodyClass,
  isReviewEntryBodyHydratable,
  isReviewSlotIncludedInBody,
  reviewContentEntryKeysInOrder,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/body-class.ts";
import { composeReviewDocumentDemand } from "../../../../../src/plugins/builtin/git/renderer/review/document/demand.ts";
import {
  createHydrateTimeoutWatchdog,
  GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS,
} from "../../../../../src/plugins/builtin/git/renderer/review/document/hydrate-timeout.ts";
import { projectReviewLedger } from "../../../../../src/plugins/builtin/git/renderer/review/document/ledger-projection.ts";
import { GitReviewDocumentLoader } from "../../../../../src/plugins/builtin/git/renderer/review/document/loader.ts";
import { DEFAULT_MAX_CONCURRENT_DOCUMENTS } from "../../../../../src/plugins/builtin/git/renderer/review/document/loader-options.ts";
import {
  isReviewEstimateCacheKey,
  isReviewNavigationTerminal,
} from "../../../../../src/plugins/builtin/git/renderer/review/navigation.ts";
import type {
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "../../../../../src/shared/contracts/git/review.ts";

/**
 * 金标准 S1–S9 DoD 机测（Z1 路径证明）。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §12
 */

function slot(
  path: string,
  overrides: Partial<GitReviewIndexEntry["renderSlots"][number]> = {}
): GitReviewIndexEntry["renderSlots"][number] {
  return {
    additions: 1,
    deletions: 0,
    group: "unstaged",
    oldPath: null,
    sectionKey: `section:${path}`,
    status: "modified",
    targetPath: path,
    ...overrides,
  };
}

function entry(
  path: string,
  slots: readonly GitReviewIndexEntry["renderSlots"][number][]
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: slots.flatMap((s) => (s.oldPath ? [s.oldPath] : [])),
    path,
    renderSlots: [...slots],
    status: slots[0]?.status ?? "modified",
  };
}

function context() {
  return {
    i18n: {
      t: (_key: string, _opts: unknown, fallback: string) => fallback,
    },
  } as never;
}

describe("git review gold-standard DoD (S1–S9 on Z1)", () => {
  it("S1/S5: pure rename is meta — not body, not hydratable, navigation terminal", () => {
    const pure = entry("a.ts", [
      slot("a.ts", {
        additions: 0,
        deletions: 0,
        oldPath: "b.ts",
        status: "renamed",
        targetPath: "a.ts",
      }),
    ]);
    expect(classifyReviewSlotBodyClass(pure.renderSlots[0]!)).toBe("meta");
    expect(isReviewSlotIncludedInBody(pure.renderSlots[0]!)).toBe(false);
    expect(isReviewEntryBodyHydratable(pure)).toBe(false);
    expect(reviewContentEntryKeysInOrder([pure])).toEqual([]);
    expect(
      isReviewNavigationTerminal(
        { entry: pure, kind: "idle" },
        false,
        pure.renderSlots[0]!.sectionKey
      )
    ).toBe(true);
  });

  it("S2: body projection only includes content slots among mixed index", () => {
    const content = entry("c.ts", [
      slot("c.ts", { additions: 3, deletions: 1 }),
    ]);
    const rename = entry("r.ts", [
      slot("r.ts", {
        additions: 0,
        deletions: 0,
        oldPath: "old.ts",
        status: "renamed",
        targetPath: "r.ts",
      }),
    ]);
    const projection = projectReviewLedger({
      context: context(),
      entries: [content, rename],
      locale: "en",
      resourceByEntryKey: new Map([
        [content.entryKey, { entry: content, kind: "idle" }],
        [rename.entryKey, { entry: rename, kind: "idle" }],
      ]),
    });
    expect(projection.items.map((item) => item.id)).toEqual([
      content.renderSlots[0]!.sectionKey,
    ]);
  });

  it("S7: binary is notice — not body, not hydratable", () => {
    const binary = entry("pic.png", [
      slot("pic.png", {
        additions: 0,
        binary: true,
        deletions: 0,
        status: "added",
        targetPath: "pic.png",
      }),
    ]);
    expect(classifyReviewSlotBodyClass(binary.renderSlots[0]!)).toBe("notice");
    expect(isReviewEntryBodyHydratable(binary)).toBe(false);
  });

  it("S9: demand hydrate timeout forces retryable error within 8s budget", () => {
    expect(GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS).toBe(8000);
    let now = 0;
    const watchdog = createHydrateTimeoutWatchdog({
      now: () => now,
      timeoutMs: GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS,
    });
    const item = entry("slow.ts", [slot("slow.ts")]);
    const loader = new GitReviewDocumentLoader({
      cancel: vi.fn(async () => undefined),
      entries: [item],
      load: vi.fn(
        (): Promise<GitReviewFileDocumentResult> => new Promise(() => undefined)
      ),
    });
    // first note: arm timer
    expect(watchdog.noteDemanded([item.entryKey], () => "loading")).toEqual([]);
    now = GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS;
    const timedOut = watchdog.noteDemanded([item.entryKey], () => "loading");
    expect(timedOut).toEqual([item.entryKey]);
    expect(loader.failHydrateTimeout(timedOut)).toBe(true);
    const resource = loader.getResource(item.entryKey);
    expect(resource?.kind).toBe("error");
    if (resource?.kind === "error") {
      expect(resource.failure.reason).toBe("timeout");
      expect(resource.failure.retryable).toBe(true);
    }
  });

  it("S9: loaded with empty projection becomes product error (no silent estimate)", () => {
    const item = entry("empty-doc.ts", [slot("empty-doc.ts")]);
    const projection = projectReviewLedger({
      context: context(),
      entries: [item],
      locale: "en",
      resourceByEntryKey: new Map([
        [
          item.entryKey,
          {
            document: {
              entryKey: item.entryKey,
              kind: "ok",
              revision: "r1",
              sections: [],
              surfaceSections: {
                committed: null,
                head: null,
                index: null,
                staged: null,
              },
            },
            entry: item,
            kind: "loaded",
          },
        ],
      ]),
    });
    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]?.kind).toBe("error");
    expect(projection.items[0]?.cacheKey).toContain("projection-empty");
  });

  it("Z1 product concurrency is ≥ 8 (not product-constant 2)", () => {
    expect(DEFAULT_MAX_CONCURRENT_DOCUMENTS).toBeGreaterThanOrEqual(8);
  });

  it("full content ledger mounts all estimates; demand cannot drop ids", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      entry(`f${i}.ts`, [slot(`f${i}.ts`, { additions: 2, deletions: 1 })])
    );
    const idle = new Map(
      many.map((item) => [
        item.entryKey,
        { entry: item, kind: "idle" as const },
      ])
    );
    const full = projectReviewLedger({
      context: context(),
      entries: many,
      locale: "en",
      resourceByEntryKey: idle,
    });
    expect(full.items).toHaveLength(20);
    expect(full.items.every((item) => item.kind === "estimate")).toBe(true);
  });

  it("S2/S5: demand lookahead over content-only order never pulls pure rename", () => {
    const contentKeys = ["entry:c0", "entry:c1", "entry:c2"];
    const demand = composeReviewDocumentDemand({
      entryKeysInOrder: contentKeys,
      navigationPending: false,
      seedEntryKeys: [],
      selectedEntryKey: "entry:c1",
      demandPrefetchEntryKeys: new Set(["entry:c1"]),
      windowDemand: {
        bufferedEntryKeys: [],
        visibleEntryKeys: ["entry:c1"],
      },
      lookahead: 2,
      selectionRadius: 1,
    });
    for (const key of [
      ...demand.visibleEntryKeys,
      ...demand.bufferedEntryKeys,
    ]) {
      expect(contentKeys).toContain(key);
      expect(key).not.toMatch(/rename/u);
    }
  });

  it("S3: estimate cache keys are valid scroll targets (pending_scroll)", () => {
    expect(isReviewEstimateCacheKey("estimate:section:1")).toBe(true);
    expect(isReviewEstimateCacheKey("git-review-section:1:0:0")).toBe(false);
  });

  it("S9: watchdog arms immediately — timeout at exactly timeoutMs from first note", () => {
    let now = 1000;
    const watchdog = createHydrateTimeoutWatchdog({
      now: () => now,
      timeoutMs: 8000,
    });
    // first note at t=1000 arms since
    expect(watchdog.noteDemanded(["a"], () => "loading")).toEqual([]);
    // exactly 8s later
    now = 9000;
    expect(watchdog.noteDemanded(["a"], () => "loading")).toEqual(["a"]);
  });
});
