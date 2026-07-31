import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computePinnedPrefixEntryKeys,
  createGitReviewReadingSession,
  isReadingProtectedMode,
} from "../../../../../src/plugins/builtin/git/renderer/review/reading-session.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("computePinnedPrefixEntryKeys", () => {
  const order = ["a", "b", "c", "d", "e"];
  const candidates = new Set(order);

  it("idle: only selected + viewport + target", () => {
    expect(
      computePinnedPrefixEntryKeys({
        candidates,
        entryKeysInOrder: order,
        mode: "idle",
        navigationTargetEntryKey: null,
        previousPinnedEntryKeys: ["a", "b", "c"],
        selectedEntryKey: "d",
        viewportEntryKeys: ["e"],
      })
    ).toEqual(["d", "e"]);
  });

  it("navigating: keeps previous pin that still candidates", () => {
    expect(
      computePinnedPrefixEntryKeys({
        candidates,
        entryKeysInOrder: order,
        mode: "navigating",
        navigationTargetEntryKey: "e",
        previousPinnedEntryKeys: ["a", "b"],
        selectedEntryKey: "e",
        viewportEntryKeys: ["c"],
      })
    ).toEqual(["a", "b", "c", "e"]);
  });

  it("drops previous pin no longer in candidates", () => {
    expect(
      computePinnedPrefixEntryKeys({
        candidates: new Set(["c", "d"]),
        entryKeysInOrder: order,
        mode: "userScrolling",
        previousPinnedEntryKeys: ["a", "c"],
        selectedEntryKey: "d",
        viewportEntryKeys: [],
      })
    ).toEqual(["c", "d"]);
  });
});

describe("isReadingProtectedMode", () => {
  it("idle is not protected; others are", () => {
    expect(isReadingProtectedMode("idle")).toBe(false);
    expect(isReadingProtectedMode("navigating")).toBe(true);
    expect(isReadingProtectedMode("userScrolling")).toBe(true);
    expect(isReadingProtectedMode("refreshing")).toBe(true);
  });
});

describe("createGitReviewReadingSession", () => {
  it("beginNavigating pins target and ends to idle", () => {
    const session = createGitReviewReadingSession();
    session.beginNavigating("entry:9");
    expect(session.getMode()).toBe("navigating");
    const pin = session.syncPinnedPrefix({
      candidates: new Set(["entry:1", "entry:9"]),
      entryKeysInOrder: ["entry:1", "entry:9"],
      selectedEntryKey: "entry:9",
      viewportEntryKeys: ["entry:1"],
    });
    expect(pin).toEqual(["entry:1", "entry:9"]);
    session.endNavigating();
    expect(session.getMode()).toBe("idle");
  });

  it("noteUserScroll protects then returns idle after debounce", () => {
    vi.useFakeTimers();
    const session = createGitReviewReadingSession({ scrollIdleMs: 50 });
    session.syncPinnedPrefix({
      candidates: new Set(["a", "b"]),
      entryKeysInOrder: ["a", "b"],
      selectedEntryKey: "a",
      viewportEntryKeys: ["b"],
    });
    session.noteUserScroll();
    expect(session.getMode()).toBe("userScrolling");
    const mid = session.syncPinnedPrefix({
      candidates: new Set(["a", "b", "c"]),
      entryKeysInOrder: ["a", "b", "c"],
      selectedEntryKey: "a",
      viewportEntryKeys: ["c"],
    });
    // 保护期保留 previous pin a,b 并加上 c
    expect(mid).toEqual(["a", "b", "c"]);
    vi.advanceTimersByTime(50);
    expect(session.getMode()).toBe("idle");
  });

  it("refreshing keeps pin until endRefreshing", () => {
    const session = createGitReviewReadingSession();
    session.syncPinnedPrefix({
      candidates: new Set(["x", "y"]),
      entryKeysInOrder: ["x", "y"],
      selectedEntryKey: "x",
      viewportEntryKeys: ["y"],
    });
    session.beginRefreshing();
    expect(session.getMode()).toBe("refreshing");
    const pin = session.syncPinnedPrefix({
      candidates: new Set(["x", "y", "z"]),
      entryKeysInOrder: ["x", "y", "z"],
      selectedEntryKey: "x",
      viewportEntryKeys: [],
    });
    expect(pin).toContain("x");
    expect(pin).toContain("y");
    session.endRefreshing();
    expect(session.getMode()).toBe("idle");
  });
});
