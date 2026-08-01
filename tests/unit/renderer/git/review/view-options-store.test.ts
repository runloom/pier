import {
  type ReviewViewOptions,
  useReviewViewOptionsStore,
} from "@plugins/builtin/git/renderer/review/document/ui-state.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const STORAGE_KEY = "pier.git.review.viewOptions";

function resetStore(options?: Partial<ReviewViewOptions>): void {
  useReviewViewOptionsStore.setState({
    diffStyle: options?.diffStyle === "unified" ? "unified" : "split",
    wrapLines: options?.wrapLines === true,
  });
}

describe("useReviewViewOptionsStore", () => {
  beforeEach(() => {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    resetStore({ diffStyle: "split", wrapLines: false });
  });

  afterEach(() => {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    resetStore({ diffStyle: "split", wrapLines: false });
  });

  it("shares one state for toolbar and CodeView consumers", () => {
    const setOptions = useReviewViewOptionsStore.getState().setOptions;
    setOptions({ wrapLines: true });
    setOptions({ diffStyle: "unified" });

    const snapshot = useReviewViewOptionsStore.getState();
    expect(snapshot.diffStyle).toBe("unified");
    expect(snapshot.wrapLines).toBe(true);
    // 二次 getState 仍是同一写结果（非双 useState）
    expect(useReviewViewOptionsStore.getState()).toMatchObject({
      diffStyle: "unified",
      wrapLines: true,
    });
  });

  it("persists preferences to localStorage", () => {
    useReviewViewOptionsStore.getState().setOptions({
      diffStyle: "unified",
      wrapLines: true,
    });
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "{}")).toEqual({
      diffStyle: "unified",
      wrapLines: true,
    });
  });

  it("ignores invalid patch fields without clobbering prior values", () => {
    useReviewViewOptionsStore.getState().setOptions({ wrapLines: true });
    useReviewViewOptionsStore.getState().setOptions({
      diffStyle: "side-by-side" as ReviewViewOptions["diffStyle"],
    });
    expect(useReviewViewOptionsStore.getState().diffStyle).toBe("split");
    expect(useReviewViewOptionsStore.getState().wrapLines).toBe(true);
  });
});
