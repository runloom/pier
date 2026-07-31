import {
  getGitReviewFileSourceIdentity,
  gitReviewFileDocumentRequestSchema,
  gitReviewFileDocumentResultSchema,
  gitReviewFileSectionSchema,
  gitReviewFileSourceSchema,
  gitReviewIndexEntrySchema,
  gitReviewIndexOkSchema,
} from "@shared/contracts/git/review.ts";
import { gitStatusSchema } from "@shared/contracts/git.ts";
import { describe, expect, it } from "vitest";

const operationId = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";
const source = {
  contextId: "worktree:abc",
  gitRootPath: "/Users/dev/ABC/pier",
  oldPaths: [],
  path: "src/index.ts",
  target: { kind: "uncommitted" },
} as const;
const normalizedSource = gitReviewFileSourceSchema.parse(source);

const patch = "@@ -1 +1 @@\n-old\n+new\n";
const changeBlock = {
  changeBlockIndex: 0,
  changeKey: `sha256:${"0".repeat(64)}`,
  headRange: { count: 1, start: 1 },
  hunkIndex: 0,
  stageState: "unstaged" as const,
  workingRange: { count: 1, start: 1 },
};

describe("Git review shared contract", () => {
  it("Git 状态使用唯一文件数与净行变化联合摘要", () => {
    const changeSummary = {
      changedFiles: 2,
      deletions: 3,
      excludedFiles: 1,
      insertions: 5,
      kind: "lineDelta",
    } as const;
    const parsed = gitStatusSchema.parse({
      branch: {
        ahead: 0,
        behind: 0,
        branch: "main",
        mergedIntoDefault: null,
        oid: "a".repeat(40),
        upstream: null,
        upstreamGone: false,
      },
      changeSummary,
      counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" },
      stashCount: 0,
    });

    expect(parsed.changeSummary).toEqual(changeSummary);
  });

  it("首批 source 不接受范围选择或其它预实现查询", () => {
    expect(
      gitReviewFileSourceSchema.safeParse({
        ...source,
        query: { groups: ["unstaged"], kind: "uncommitted" },
      }).success
    ).toBe(false);
  });

  it("uses a canonical stable identity after schema normalization", () => {
    expect(getGitReviewFileSourceIdentity({ ...normalizedSource })).toBe(
      getGitReviewFileSourceIdentity(normalizedSource)
    );
    expect(getGitReviewFileSourceIdentity(normalizedSource)).not.toBe(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        path: "src/other.ts",
      })
    );
    expect(getGitReviewFileSourceIdentity(normalizedSource)).not.toBe(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        oldPaths: ["src/previous.ts"],
      })
    );
    expect(getGitReviewFileSourceIdentity(normalizedSource)).not.toBe(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        target: { kind: "commit", oid: "1".repeat(40) },
      })
    );
  });

  it("缺省 target 归一化为 uncommitted", () => {
    const { target: _target, ...withoutTarget } = source;
    expect(gitReviewFileSourceSchema.parse(withoutTarget).target).toEqual({
      kind: "uncommitted",
    });
  });

  it("keeps scope, safe paths, and the renderer entry projection strict", () => {
    expect(gitReviewFileSourceSchema.parse(source)).toEqual(source);
    for (const path of ["\\notes.txt", "dir\\..\\file"]) {
      expect(
        gitReviewFileSourceSchema.safeParse({ ...source, path }).success
      ).toBe(true);
    }
    expect(
      gitReviewFileSourceSchema.safeParse({
        ...source,
        oldPaths: ["a.ts", "b.ts", "c.ts", "d.ts"],
      }).success
    ).toBe(false);
    for (const path of [
      "../outside.ts",
      "./inside.ts",
      "src//index.ts",
      "src/./index.ts",
      "src/\0index.ts",
      "/absolute.ts",
    ]) {
      expect(
        gitReviewFileSourceSchema.safeParse({ ...source, path }).success
      ).toBe(false);
    }

    const entry = gitReviewIndexEntrySchema.parse({
      entryKey: "src/index.ts",
      oldPaths: [],
      path: "src/index.ts",
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "section:src-index",
          status: "added",
          targetPath: "src/index.ts",
        },
      ],
      status: "added",
    });
    for (const invalid of [
      { ...entry, additions: 3 },
      { ...entry, deletions: 1 },
      { ...entry, groups: ["unstaged"] },
      { ...entry, groupStatuses: { staged: "added" } },
      { ...entry, status: "unknown" },
      { ...entry, unexpected: true },
    ]) {
      expect(gitReviewIndexEntrySchema.safeParse(invalid).success).toBe(false);
    }

    const stagedSlot = {
      ...entry.renderSlots[0],
      group: "staged" as const,
      sectionKey: "section:src-index:staged",
    };
    for (const invalidSlots of [
      [stagedSlot, entry.renderSlots[0]],
      [
        entry.renderSlots[0],
        { ...stagedSlot, sectionKey: "section:src-index" },
      ],
      [
        {
          ...entry.renderSlots[0],
          group: "conflict" as const,
          sectionKey: "section:src-index:conflict",
        },
      ],
    ]) {
      expect(
        gitReviewIndexEntrySchema.safeParse({
          ...entry,
          renderSlots: invalidSlots,
        }).success
      ).toBe(false);
    }
    expect(
      gitReviewIndexEntrySchema.safeParse({ ...entry, status: "modified" })
        .success
    ).toBe(false);
  });

  it("公共 index 不回传 main 内部解析元数据", () => {
    const result = gitReviewIndexOkSchema.parse({
      entries: [],
      groupSummaries: {
        committed: {
          changedFiles: 1,
          deletions: 2,
          excludedFiles: 0,
          insertions: 4,
          kind: "lineDelta",
        },
      },
      indexRevision: "index:test",
      kind: "ok",
      warnings: [],
    });
    expect(result.indexRevision).toBe("index:test");
    expect(result.groupSummaries.committed).toEqual({
      changedFiles: 1,
      deletions: 2,
      excludedFiles: 0,
      insertions: 4,
      kind: "lineDelta",
    });
    for (const internalField of ["gitRootPath", "query", "revision"] as const) {
      expect(
        gitReviewIndexOkSchema.safeParse({
          ...result,
          [internalField]: "internal",
        }).success
      ).toBe(false);
    }
  });

  it("keeps patch, conflict state, and unknown fields mutually exclusive", () => {
    expect(
      gitReviewFileSectionSchema.parse({
        changeBlocks: [changeBlock],
        kind: "patch",
        patch,
        sectionKey: "section:unstaged",
      }).kind
    ).toBe("patch");
    expect(
      gitReviewFileSectionSchema.parse({
        kind: "state",
        oldPath: null,
        reason: "conflict",
        sectionKey: "section:conflict",
        status: "conflicted",
        targetPath: "src/app.ts",
      }).kind
    ).toBe("state");
    const validState = {
      kind: "state" as const,
      oldPath: null,
      reason: "binary" as const,
      sectionKey: "section:state",
      status: "modified" as const,
      targetPath: "src/app.ts",
    };
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...validState,
        oldPath: "src/old.ts",
        status: "renamed",
      }).success
    ).toBe(true);
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...validState,
        oldPath: "src/old.ts",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...validState,
        status: "renamed",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...validState,
        reason: "conflict",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...validState,
        status: "conflicted",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.safeParse({
        changeBlocks: [changeBlock],
        kind: "patch",
        patch,
        sectionKey: "section:unstaged",
        sourceRevision: "internal",
      }).success
    ).toBe(false);
  });

  it("rejects legacy conditional document fields and validates documents", () => {
    expect(
      gitReviewFileDocumentRequestSchema.safeParse({
        clientHasDocument: true,
        ifRevision: null,
        operationId,
        source,
      }).success
    ).toBe(false);
    expect(
      gitReviewFileDocumentResultSchema.safeParse({
        kind: "notModified",
        revision: "document-v1",
        source,
      }).success
    ).toBe(false);
    const patchContent = {
      changeBlocks: [changeBlock],
      kind: "patch",
      patch,
      sectionKey: "section:unstaged",
    } as const;
    expect(
      gitReviewFileDocumentResultSchema.parse({
        entryKey: "src/index.ts",
        kind: "ok",
        revision: "document-v1",
        sections: [patchContent],
        surfaceSections: {
          committed: null,
          head: null,
          index: "section:unstaged",
          staged: null,
        },
      }).kind
    ).toBe("ok");
    expect(
      gitReviewFileDocumentResultSchema.safeParse({
        content: { changeBlocks: [], kind: "patch", patch },
        entryKey: "src/index.ts",
        kind: "ok",
        revision: "document-v1",
        sections: [],
      }).success
    ).toBe(false);
  });
});
