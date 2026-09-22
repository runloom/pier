import { findPartialCollapsedSeparatorItemId } from "@pier/ui/diff-view/header-events.ts";
import { bindPartialExpandSeparators } from "@pier/ui/diff-view/path-title-chrome.ts";
import { conflictStageTexts } from "@pier/ui/diff-view/unresolved-conflict/stage-diff.tsx";
import { describe, expect, it, vi } from "vitest";

const conflict = {
  contents: null,
  contentsDigest: "sha256:test",
  presentation: "file-level" as const,
  stages: { baseOid: null, oursOid: null, theirsOid: null },
  xy: "DU" as const,
};

describe("conflictStageTexts", () => {
  it("uses stage blobs only when the worktree body is missing", () => {
    expect(
      conflictStageTexts({
        ...conflict,
        oursContents: null,
        theirsContents: "incoming\n",
      })
    ).toEqual({ ours: "", theirs: "incoming\n" });
    expect(
      conflictStageTexts({
        ...conflict,
        contents: "resolved\n",
        oursContents: "ours\n",
        theirsContents: "incoming\n",
      })
    ).toBeNull();
    expect(
      conflictStageTexts({
        ...conflict,
        oursContents: null,
        theirsContents: null,
      })
    ).toBeNull();
    expect(conflictStageTexts(conflict)).toBeNull();
  });
});

describe("findPartialCollapsedSeparatorItemId", () => {
  it("maps a non-expandable unmodified row to the rendered file", () => {
    const host = document.createElement("div");
    const separator = document.createElement("div");
    separator.setAttribute("data-separator", "line-info-basic");
    const label = document.createElement("span");
    label.setAttribute("data-unmodified-lines", "");
    separator.append(label);
    const rendered = [{ element: host, id: "section" }];
    expect(
      findPartialCollapsedSeparatorItemId([label, separator, host], rendered)
    ).toBe("section");
    separator.setAttribute("data-expand-index", "0");
    expect(
      findPartialCollapsedSeparatorItemId([label, separator, host], rendered)
    ).toBeNull();
  });

  it("turns a partial unmodified row into a keyboard button", () => {
    const root = document.createElement("div");
    const separator = document.createElement("div");
    separator.setAttribute("data-separator", "line-info-basic");
    separator.textContent = "40 unmodified lines";
    root.append(separator);
    bindPartialExpandSeparators(root);
    expect(separator.getAttribute("role")).toBe("button");
    expect(separator.tabIndex).toBe(0);
    const clicked = vi.fn();
    separator.addEventListener("click", clicked);
    separator.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
    expect(clicked).toHaveBeenCalledOnce();
    separator.setAttribute("data-expand-index", "1");
    bindPartialExpandSeparators(root);
    expect(separator.hasAttribute("role")).toBe(false);
    expect(separator.tabIndex).toBe(-1);
  });
});
