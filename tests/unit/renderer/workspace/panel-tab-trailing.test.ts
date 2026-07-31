import { describe, expect, it } from "vitest";
import {
  panelTabTrailingAriaSuffix,
  panelTabTrailingVisible,
} from "@/components/workspace/panel-tab-trailing.tsx";

describe("panelTabTrailing helpers", () => {
  it("hides zero lineDelta and shows non-zero sides only", () => {
    expect(
      panelTabTrailingVisible({
        deletions: 0,
        insertions: 0,
        kind: "git-line-delta",
      })
    ).toBe(false);
    expect(
      panelTabTrailingVisible({
        deletions: 0,
        insertions: 4,
        kind: "git-line-delta",
      })
    ).toBe(true);
    expect(
      panelTabTrailingAriaSuffix({
        deletions: 0,
        insertions: 4,
        kind: "git-line-delta",
      })
    ).toBe("+4");
    expect(
      panelTabTrailingAriaSuffix({
        deletions: 3,
        insertions: 0,
        kind: "git-line-delta",
      })
    ).toBe("−3");
    expect(
      panelTabTrailingAriaSuffix({
        deletions: 3,
        insertions: 12,
        kind: "git-line-delta",
      })
    ).toBe("+12 −3");
  });

  it("uses text label for text trailing", () => {
    expect(panelTabTrailingVisible({ kind: "text", label: "3" })).toBe(true);
    expect(panelTabTrailingAriaSuffix({ kind: "text", label: "3" })).toBe("3");
  });
});
