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
  return {
    contents: null,
    contentsDigest: "sha256:test",
    kind: "conflict",
    oldPath: null,
    presentation: "file-level",
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
    expect(notice).toContain("stage it to confirm");
    expect(notice).not.toMatch(/open the file/i);
  });

  it("tells modify/delete conflicts to open or stage", () => {
    expect(conflictSectionText(context(), fileLevel("UD"), "en")).toContain(
      "open the file or stage it"
    );
    expect(conflictSectionText(context(), fileLevel("DU"), "en")).toContain(
      "open the file or stage it"
    );
  });

  it("tells marker-free UU to stage if the worktree already looks right", () => {
    expect(conflictSectionText(context(), fileLevel("UU"), "en")).toContain(
      "stage the file if it already looks right"
    );
  });
});
