import { describe, expect, it, vi } from "vitest";
import {
  remapDocumentSectionsToEntry,
  retainLoadedDocumentForEntry,
  softRemapDocumentSectionsToEntry,
} from "../../../src/plugins/builtin/git/renderer/git-review-document-loader-utils.ts";
import {
  type PendingReviewAnchor,
  restoreReviewReadingViewport,
} from "../../../src/plugins/builtin/git/renderer/git-review-document-projection.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "../../../src/shared/contracts/git-review.ts";

function makeEntry(
  slots: readonly {
    group: "staged" | "unstaged";
    sectionKey: string;
    targetPath?: string;
  }[]
): GitReviewIndexEntry {
  const path = slots[0]?.targetPath ?? "src/a.ts";
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: slots.map((slot) => ({
      group: slot.group,
      oldPath: null,
      sectionKey: slot.sectionKey,
      status: "modified" as const,
      targetPath: slot.targetPath ?? path,
    })),
    status: "modified",
  };
}

function makeDoc(
  sections: readonly { sectionKey: string; patch: string }[]
): GitReviewFileDocumentOk {
  return {
    kind: "ok",
    revision: "rev-1",
    sections: sections.map((section) => ({
      kind: "patch" as const,
      patch: section.patch,
      sectionKey: section.sectionKey,
    })),
  };
}

describe("softRemapDocumentSectionsToEntry", () => {
  it("strict-remaps when slot count matches (group migration)", () => {
    const entry = makeEntry([{ group: "staged", sectionKey: "key-staged" }]);
    const doc = makeDoc([
      { sectionKey: "key-unstaged", patch: "diff --git a" },
    ]);
    const remapped = softRemapDocumentSectionsToEntry(entry, doc);
    expect(remapped?.sections).toEqual([
      { kind: "patch", patch: "diff --git a", sectionKey: "key-staged" },
    ]);
    expect(remapped?.revision).toContain("slot-remap");
  });

  it("keeps exact sectionKey and soft-fills new half-stage slot", () => {
    const entry = makeEntry([
      { group: "staged", sectionKey: "key-staged" },
      { group: "unstaged", sectionKey: "key-unstaged" },
    ]);
    const doc = makeDoc([
      { sectionKey: "key-unstaged", patch: "diff --git unstaged-body" },
    ]);
    const remapped = softRemapDocumentSectionsToEntry(entry, doc);
    expect(remapped).not.toBeNull();
    expect(remapped?.sections.map((s) => s.sectionKey)).toEqual([
      "key-unstaged",
    ]);
    expect(remapped?.sections[0]).toMatchObject({
      patch: "diff --git unstaged-body",
      sectionKey: "key-unstaged",
    });
    expect(remapDocumentSectionsToEntry(entry, doc)).toBeNull();
  });

  it("soft-bridges 1→2 free body onto unstaged residual (not staged first slot)", () => {
    // R2：旧 body 键全变时，优先挂操作侧 unstaged，禁止 staged 第一槽吞残体
    const entry = makeEntry([
      { group: "staged", sectionKey: "key-staged-new" },
      { group: "unstaged", sectionKey: "key-unstaged-new" },
    ]);
    const doc = makeDoc([
      { sectionKey: "key-old-only", patch: "diff --git old" },
    ]);
    const remapped = softRemapDocumentSectionsToEntry(entry, doc);
    expect(remapped?.sections).toHaveLength(1);
    expect(remapped?.sections[0]).toMatchObject({
      patch: "diff --git old",
      sectionKey: "key-unstaged-new",
    });
    expect(remapped?.revision).toContain("slot-soft-remap");
  });

  it("retainLoadedDocumentForEntry uses soft remap for half-stage", () => {
    const entry = makeEntry([
      { group: "staged", sectionKey: "key-staged" },
      { group: "unstaged", sectionKey: "key-unstaged" },
    ]);
    const doc = makeDoc([
      { sectionKey: "key-unstaged", patch: "diff --git unstaged-body" },
    ]);
    const retained = retainLoadedDocumentForEntry(entry, doc);
    expect(retained?.kind).toBe("loaded");
    expect(retained?.document.sections).toHaveLength(1);
    expect(retained?.document.sections[0]?.sectionKey).toBe("key-unstaged");
  });
});

describe("restoreReviewReadingViewport (P0)", () => {
  it("R1: same id + same membership order → skipped (no external restore)", () => {
    const restoreAnchor = vi.fn(() => true);
    const pending: PendingReviewAnchor = {
      anchor: { id: "unstaged-key", offset: -8 },
      entryKey: "entry:a",
      generation: 3,
      preferredSide: "unstaged",
      // 纯高度：membership 序不变
      previousItemIds: ["unstaged-key", "unstaged-other"],
      restored: false,
      scrollTop: 420,
    };
    expect(
      restoreReviewReadingViewport(
        { restoreAnchor },
        pending,
        ["unstaged-key", "unstaged-other"],
        new Map([
          ["unstaged-key", "entry:a"],
          ["unstaged-other", "entry:b"],
        ]),
        new Map([
          ["unstaged-key", "unstaged"],
          ["unstaged-other", "unstaged"],
        ])
      )
    ).toBe("skipped");
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("R1b: same id + topology insert-above → skipped (Pierre line anchor)", () => {
    const restoreAnchor = vi.fn(() => true);
    const pending: PendingReviewAnchor = {
      anchor: { id: "unstaged-key", offset: -8 },
      entryKey: "entry:a",
      generation: 3,
      preferredSide: "unstaged",
      previousItemIds: ["unstaged-key"],
      restored: false,
      scrollTop: 420,
    };
    expect(
      restoreReviewReadingViewport(
        { restoreAnchor },
        pending,
        ["staged-key", "unstaged-key"],
        new Map([
          ["staged-key", "entry:a"],
          ["unstaged-key", "entry:a"],
        ]),
        new Map([
          ["staged-key", "staged"],
          ["unstaged-key", "unstaged"],
        ])
      )
    ).toBe("skipped");
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("R2: half-stage remaps to unstaged operation side not staged first", () => {
    const restoreAnchor = vi.fn(() => true);
    const pending: PendingReviewAnchor = {
      anchor: { id: "old-unstaged", offset: -24 },
      entryKey: "entry:a",
      generation: 3,
      preferredSide: "unstaged",
      previousItemIds: ["old-unstaged"],
      restored: false,
      scrollTop: 420,
    };
    expect(
      restoreReviewReadingViewport(
        { restoreAnchor },
        pending,
        ["staged-key", "unstaged-key"],
        new Map([
          ["staged-key", "entry:a"],
          ["unstaged-key", "entry:a"],
        ]),
        new Map([
          ["staged-key", "staged"],
          ["unstaged-key", "unstaged"],
        ])
      )
    ).toBe("restored");
    expect(restoreAnchor).toHaveBeenCalledWith({
      id: "unstaged-key",
      offset: -24,
    });
  });

  it("R4: full stage lands neighborhood not same-entry staged", () => {
    const restoreAnchor = vi.fn(() => true);
    const pending: PendingReviewAnchor = {
      anchor: { id: "unstaged:a", offset: -30 },
      entryKey: "entry:a",
      generation: 3,
      preferredSide: "unstaged",
      previousItemIds: ["unstaged:a", "unstaged:b"],
      restored: false,
      scrollTop: null,
    };
    expect(
      restoreReviewReadingViewport(
        { restoreAnchor },
        pending,
        ["staged:a", "unstaged:b"],
        new Map([
          ["staged:a", "entry:a"],
          ["unstaged:b", "entry:b"],
        ]),
        new Map([
          ["staged:a", "staged"],
          ["unstaged:b", "unstaged"],
        ])
      )
    ).toBe("restored");
    expect(restoreAnchor).toHaveBeenCalledWith({
      id: "unstaged:b",
      offset: 0,
    });
  });

  it("failed restore when CodeView rejects target keeps result for retry", () => {
    const restoreAnchor = vi.fn(() => false);
    const pending: PendingReviewAnchor = {
      anchor: { id: "old-unstaged", offset: -10 },
      entryKey: "entry:a",
      generation: 3,
      preferredSide: "unstaged",
      previousItemIds: ["old-unstaged"],
      restored: false,
      scrollTop: null,
    };
    expect(
      restoreReviewReadingViewport(
        { restoreAnchor },
        pending,
        ["staged-key", "unstaged-key"],
        new Map([
          ["staged-key", "entry:a"],
          ["unstaged-key", "entry:a"],
        ]),
        new Map([
          ["staged-key", "staged"],
          ["unstaged-key", "unstaged"],
        ])
      )
    ).toBe("failed");
  });
});
