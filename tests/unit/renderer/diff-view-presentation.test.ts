import { describe, expect, it } from "vitest";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
  shouldRotateCollapseChevron,
} from "../../../packages/ui/src/diff-view-presentation.ts";

describe("pierDiffItemPresentation", () => {
  it("maps null patch to loading and content patch to ready", () => {
    expect(pierDiffItemPresentation({ patch: null })).toBe("loading");
    expect(pierDiffItemPresentation({ patch: "diff --git a/a b/a\n" })).toBe(
      "ready"
    );
  });
});

describe("shouldRotateCollapseChevron", () => {
  it("does not rotate while loading even if the slot is empty/disabled", () => {
    expect(
      shouldRotateCollapseChevron({
        collapsed: false,
        disabled: true,
        loading: true,
      })
    ).toBe(false);
  });

  it("keeps DiffsHub ready-empty and collapsed rotation", () => {
    expect(
      shouldRotateCollapseChevron({
        collapsed: false,
        disabled: true,
        loading: false,
      })
    ).toBe(true);
    expect(
      shouldRotateCollapseChevron({
        collapsed: true,
        disabled: false,
        loading: false,
      })
    ).toBe(true);
    expect(
      shouldRotateCollapseChevron({
        collapsed: false,
        disabled: false,
        loading: false,
      })
    ).toBe(false);
  });
});

describe("shouldRenderDiffLineStats", () => {
  it("hides zero-zero stats used by unloaded placeholders", () => {
    expect(shouldRenderDiffLineStats({ additions: 0, deletions: 0 })).toBe(
      false
    );
    expect(shouldRenderDiffLineStats({ additions: 3, deletions: 0 })).toBe(
      true
    );
    expect(shouldRenderDiffLineStats({ additions: 0, deletions: 2 })).toBe(
      true
    );
  });
});
