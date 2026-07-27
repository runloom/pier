import { describe, expect, it, vi } from "vitest";
import { restoreReviewReadingViewport } from "../../../src/plugins/builtin/git/renderer/git-review-document-projection.ts";
import {
  didMembershipTopologyChange,
  type ReviewReadingSide,
  readingSideFromStageState,
  resolveReviewReadingAnchor,
  shouldRestoreReadingAnchorExternally,
} from "../../../src/plugins/builtin/git/renderer/git-review-reading-anchor.ts";

function sideMap(
  entries: readonly (readonly [string, ReviewReadingSide])[]
): Map<string, ReviewReadingSide> {
  return new Map(entries);
}

function entryMap(
  entries: readonly (readonly [string, string])[]
): Map<string, string> {
  return new Map(entries);
}

describe("didMembershipTopologyChange", () => {
  it("false when order and ids match", () => {
    expect(didMembershipTopologyChange(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("true when length changes (half-stage insert)", () => {
    expect(
      didMembershipTopologyChange(["unstaged:a"], ["staged:a", "unstaged:a"])
    ).toBe(true);
  });

  it("true when order or ids diverge", () => {
    expect(didMembershipTopologyChange(["a", "b"], ["b", "a"])).toBe(true);
    expect(didMembershipTopologyChange(["a"], ["b"])).toBe(true);
  });
});

describe("shouldRestoreReadingAnchorExternally", () => {
  it("R1: same id + same membership order → no external restore", () => {
    expect(
      shouldRestoreReadingAnchorExternally(
        {
          anchor: { id: "unstaged:a", offset: -10 },
          previousItemIds: ["unstaged:a", "unstaged:b"],
        },
        ["unstaged:a", "unstaged:b"]
      )
    ).toBe(false);
  });

  it("R1b: same id + topology insert-above → still no external restore (Pierre line anchor)", () => {
    // 半暂存 id 存活时外层 scrollTo 会清 Pierre 行锚并闪一下
    expect(
      shouldRestoreReadingAnchorExternally(
        {
          anchor: { id: "unstaged:a", offset: -18 },
          previousItemIds: ["unstaged:a", "unstaged:b"],
        },
        ["staged:a", "unstaged:a", "unstaged:b"]
      )
    ).toBe(false);
  });

  it("identity lost → external restore needed", () => {
    expect(
      shouldRestoreReadingAnchorExternally(
        {
          anchor: { id: "unstaged:a", offset: -10 },
          previousItemIds: ["unstaged:a", "unstaged:b"],
        },
        ["staged:a", "unstaged:b"]
      )
    ).toBe(true);
  });
});

describe("resolveReviewReadingAnchor (P0)", () => {
  it("same surviving id keeps offset (resolve branch only)", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["staged:a", "unstaged:a"],
      entryKeyBySectionId: entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:a", "entry:a"],
      ]),
      pending: {
        anchor: { id: "unstaged:a", offset: -24 },
        entryKey: "entry:a",
        preferredSide: "unstaged",
        previousItemIds: ["unstaged:a"],
      },
      sideBySectionId: sideMap([
        ["staged:a", "staged"],
        ["unstaged:a", "unstaged"],
      ]),
    });
    expect(anchor).toEqual({ id: "unstaged:a", offset: -24 });
  });

  it("R2 half-stage id remapped: stays on unstaged operation side (not staged first slot)", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["staged:a", "unstaged:a", "unstaged:b"],
      entryKeyBySectionId: entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:a", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      pending: {
        anchor: { id: "old-unstaged:a", offset: -18 },
        entryKey: "entry:a",
        preferredSide: "unstaged",
        previousItemIds: ["old-unstaged:a", "unstaged:b"],
      },
      sideBySectionId: sideMap([
        ["staged:a", "staged"],
        ["unstaged:a", "unstaged"],
        ["unstaged:b", "unstaged"],
      ]),
    });
    expect(anchor).toEqual({ id: "unstaged:a", offset: -18 });
  });

  it("R2: preferred staged side when user was viewing staged", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["staged:a", "unstaged:a"],
      entryKeyBySectionId: entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:a", "entry:a"],
      ]),
      pending: {
        anchor: { id: "old-staged:a", offset: -8 },
        entryKey: "entry:a",
        preferredSide: "staged",
        previousItemIds: ["old-staged:a"],
      },
      sideBySectionId: sideMap([
        ["staged:a", "staged"],
        ["unstaged:a", "unstaged"],
      ]),
    });
    expect(anchor).toEqual({ id: "staged:a", offset: -8 });
  });

  it("R3 subsequent half-stage: remapped id still prefers operation side", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["staged:a", "staged:b", "unstaged:a-v2", "unstaged:b"],
      entryKeyBySectionId: entryMap([
        ["staged:a", "entry:a"],
        ["staged:b", "entry:b"],
        ["unstaged:a-v2", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      pending: {
        anchor: { id: "unstaged:a-v1", offset: -12 },
        entryKey: "entry:a",
        preferredSide: "unstaged",
        previousItemIds: ["staged:a", "unstaged:a-v1", "unstaged:b"],
      },
      sideBySectionId: sideMap([
        ["staged:a", "staged"],
        ["staged:b", "staged"],
        ["unstaged:a-v2", "unstaged"],
        ["unstaged:b", "unstaged"],
      ]),
    });
    expect(anchor).toEqual({ id: "unstaged:a-v2", offset: -12 });
  });

  it("R4 full stage: neighborhood next unstaged, not follow staged of same entry", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["staged:a", "unstaged:b", "unstaged:c"],
      entryKeyBySectionId: entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:b", "entry:b"],
        ["unstaged:c", "entry:c"],
      ]),
      pending: {
        anchor: { id: "unstaged:a", offset: -30 },
        entryKey: "entry:a",
        preferredSide: "unstaged",
        previousItemIds: ["unstaged:a", "unstaged:b", "unstaged:c"],
      },
      sideBySectionId: sideMap([
        ["staged:a", "staged"],
        ["unstaged:b", "unstaged"],
        ["unstaged:c", "unstaged"],
      ]),
    });
    expect(anchor).toEqual({ id: "unstaged:b", offset: 0 });
  });

  it("R4: neighborhood predecessor when no successor", () => {
    const anchor = resolveReviewReadingAnchor({
      currentItemIds: ["unstaged:z", "staged:a"],
      entryKeyBySectionId: entryMap([
        ["unstaged:z", "entry:z"],
        ["staged:a", "entry:a"],
      ]),
      pending: {
        anchor: { id: "unstaged:a", offset: -4 },
        entryKey: "entry:a",
        preferredSide: "unstaged",
        previousItemIds: ["unstaged:z", "unstaged:a"],
      },
      sideBySectionId: sideMap([
        ["unstaged:z", "unstaged"],
        ["staged:a", "staged"],
      ]),
    });
    expect(anchor).toEqual({ id: "unstaged:z", offset: 0 });
  });
});

describe("restoreReviewReadingViewport integration", () => {
  it("R1 pure height: skipped", () => {
    const restoreAnchor = vi.fn(() => true);
    const result = restoreReviewReadingViewport(
      { restoreAnchor },
      {
        anchor: { id: "unstaged:a", offset: -10 },
        entryKey: "entry:a",
        generation: 1,
        preferredSide: "unstaged",
        previousItemIds: ["unstaged:a", "unstaged:b"],
        restored: false,
        scrollTop: 100,
      },
      ["unstaged:a", "unstaged:b"],
      entryMap([
        ["unstaged:a", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      sideMap([
        ["unstaged:a", "unstaged"],
        ["unstaged:b", "unstaged"],
      ])
    );
    expect(result).toBe("skipped");
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("R1b insert-above same id: skipped (Pierre line anchor owns it)", () => {
    const restoreAnchor = vi.fn(() => true);
    const result = restoreReviewReadingViewport(
      { restoreAnchor },
      {
        anchor: { id: "unstaged:a", offset: -18 },
        entryKey: "entry:a",
        generation: 1,
        preferredSide: "unstaged",
        previousItemIds: ["unstaged:a", "unstaged:b"],
        restored: false,
        scrollTop: 200,
      },
      ["staged:a", "unstaged:a", "unstaged:b"],
      entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:a", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      sideMap([
        ["staged:a", "staged"],
        ["unstaged:a", "unstaged"],
        ["unstaged:b", "unstaged"],
      ])
    );
    expect(result).toBe("skipped");
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("R2 remapped id: restored preferred unstaged side not staged first", () => {
    const restoreAnchor = vi.fn(() => true);
    const result = restoreReviewReadingViewport(
      { restoreAnchor },
      {
        anchor: { id: "old-unstaged:a", offset: -22 },
        entryKey: "entry:a",
        generation: 1,
        preferredSide: "unstaged",
        previousItemIds: ["old-unstaged:a", "unstaged:b"],
        restored: false,
        scrollTop: 300,
      },
      ["staged:a", "unstaged:a", "unstaged:b"],
      entryMap([
        ["staged:a", "entry:a"],
        ["unstaged:a", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      sideMap([
        ["staged:a", "staged"],
        ["unstaged:a", "unstaged"],
        ["unstaged:b", "unstaged"],
      ])
    );
    expect(result).toBe("restored");
    expect(restoreAnchor).toHaveBeenCalledWith({
      id: "unstaged:a",
      offset: -22,
    });
  });

  it("R3 subsequent half-stage with remapped id still prefers operation side", () => {
    const restoreAnchor = vi.fn(() => true);
    const result = restoreReviewReadingViewport(
      { restoreAnchor },
      {
        anchor: { id: "unstaged:a-v1", offset: -12 },
        entryKey: "entry:a",
        generation: 2,
        preferredSide: "unstaged",
        previousItemIds: ["staged:a", "unstaged:a-v1", "unstaged:b"],
        restored: false,
        scrollTop: null,
      },
      ["staged:a", "staged:b", "unstaged:a-v2", "unstaged:b"],
      entryMap([
        ["staged:a", "entry:a"],
        ["staged:b", "entry:b"],
        ["unstaged:a-v2", "entry:a"],
        ["unstaged:b", "entry:b"],
      ]),
      sideMap([
        ["staged:a", "staged"],
        ["staged:b", "staged"],
        ["unstaged:a-v2", "unstaged"],
        ["unstaged:b", "unstaged"],
      ])
    );
    expect(result).toBe("restored");
    expect(restoreAnchor).toHaveBeenCalledWith({
      id: "unstaged:a-v2",
      offset: -12,
    });
  });
});

describe("readingSideFromStageState", () => {
  it("maps stage control state", () => {
    expect(readingSideFromStageState("staged")).toBe("staged");
    expect(readingSideFromStageState("unstaged")).toBe("unstaged");
    expect(readingSideFromStageState(undefined)).toBe("other");
  });
});
