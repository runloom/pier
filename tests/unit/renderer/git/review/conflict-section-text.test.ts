import type { GitReviewFileSection } from "@shared/contracts/git/review.ts";
import { describe, expect, it, vi } from "vitest";
import { conflictSectionText } from "../../../../../src/plugins/builtin/git/renderer/review/document/state-text.ts";

type ReviewConflictSection = Extract<
  GitReviewFileSection,
  { kind: "conflict" }
>;

function context() {
  return {
    i18n: {
      t: vi.fn((_key: string, _values?: unknown, fallback?: string) =>
        typeof fallback === "string" ? fallback : _key
      ),
    },
  } as never;
}

function fileLevel(xy: ReviewConflictSection["xy"]): ReviewConflictSection {
  return section("file-level", xy);
}

function section(
  presentation: ReviewConflictSection["presentation"],
  xy: ReviewConflictSection["xy"]
): ReviewConflictSection {
  return {
    contents: null,
    contentsDigest: "sha256:test",
    kind: "conflict",
    oldPath: null,
    presentation,
    sectionKey: "section:conflict",
    stages: { baseOid: null, oursOid: null, theirsOid: null },
    status: "conflicted",
    targetPath: "src/file.ts",
    xy,
  };
}

describe("conflictSectionText", () => {
  it("does not tell the user to open a both-deleted file", () => {
    const notice = conflictSectionText(context(), fileLevel("DD"), "en");
    expect(notice).toContain("confirm the deletion");
    expect(notice).not.toMatch(/open the file/i);
  });

  it("tells modify/delete conflicts to pick a version", () => {
    expect(conflictSectionText(context(), fileLevel("UD"), "en")).toContain(
      "keep the current file or confirm the deletion"
    );
    expect(conflictSectionText(context(), fileLevel("DU"), "en")).toContain(
      "use the incoming version or confirm the deletion"
    );
  });

  it("tells marker-free UU to stage if the worktree already looks right", () => {
    expect(conflictSectionText(context(), fileLevel("UU"), "en")).toContain(
      "Stage the current file if it already looks right"
    );
  });

  it("specializes binary copy to the xy actions actually shown", () => {
    const du = conflictSectionText(context(), section("binary", "DU"), "en");
    expect(du).toContain("preview is unavailable");
    expect(du).toContain("use the incoming version or confirm the deletion");
    expect(du).not.toMatch(/current version or the incoming version/i);

    const uu = conflictSectionText(context(), section("binary", "UU"), "en");
    expect(uu).toContain("preview is unavailable");
    expect(uu).toContain("Stage the current file if it already looks right");
  });
});
