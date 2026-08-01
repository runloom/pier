import { describe, expect, it } from "vitest";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
  shouldRotateCollapseChevron,
} from "../../../../packages/ui/src/diff-view/presentation.ts";

describe("pierDiffItemPresentation", () => {
  it("treats estimate / null patch as loading until real body arrives", () => {
    // estimate 未水合：header loading，避免被当成「已就绪的空文件」
    expect(pierDiffItemPresentation({ patch: null })).toBe("loading");
    expect(pierDiffItemPresentation({ kind: "estimate", patch: null })).toBe(
      "loading"
    );
    expect(pierDiffItemPresentation({ patch: "diff --git a/a b/a\n" })).toBe(
      "ready"
    );
    expect(pierDiffItemPresentation({ kind: "loaded", patch: "x" })).toBe(
      "ready"
    );
  });

  it("treats header-only state notices as ready empty content", () => {
    expect(
      pierDiffItemPresentation({
        kind: "ready-notice",
        patch: null,
        stateNotice: "Binary file — content not shown",
      })
    ).toBe("ready");
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
