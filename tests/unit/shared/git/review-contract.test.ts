import {
  canonicalizeGitReviewTarget,
  getGitReviewFileSourceIdentity,
  gitReviewFileDocumentRequestSchema,
  gitReviewFileDocumentResultSchema,
  gitReviewFileSectionSchema,
  gitReviewFileSourceSchema,
  gitReviewIndexEntrySchema,
  gitReviewIndexOkSchema,
  gitReviewTargetIdentityKey,
  gitReviewTargetSchema,
  isGitReviewCommitRange,
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

  it("commit fromOid 表示连续范围，等于 oid 时归一成单篇", () => {
    const newest = "2".repeat(40);
    const oldest = "1".repeat(40);
    const range = gitReviewTargetSchema.parse({
      fromOid: oldest,
      kind: "commit",
      oid: newest,
    });
    expect(range).toEqual({
      fromOid: oldest,
      kind: "commit",
      oid: newest,
    });
    expect(isGitReviewCommitRange(range)).toBe(true);
    expect(gitReviewTargetIdentityKey(range)).toBe(
      `commit:${oldest}..${newest}`
    );

    const sameEnds = canonicalizeGitReviewTarget({
      fromOid: newest,
      kind: "commit",
      oid: newest,
    });
    expect(sameEnds).toEqual({ kind: "commit", oid: newest });
    expect(isGitReviewCommitRange(sameEnds)).toBe(false);
    expect(gitReviewTargetIdentityKey(sameEnds)).toBe(`commit:${newest}`);
    expect(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        target: {
          fromOid: newest,
          kind: "commit",
          oid: newest,
        },
      })
    ).toBe(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        target: { kind: "commit", oid: newest },
      })
    );
    expect(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        target: range,
      })
    ).not.toBe(
      getGitReviewFileSourceIdentity({
        ...normalizedSource,
        target: { kind: "commit", oid: newest },
      })
    );
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

  it("requires porcelain XY on conflict slots only", () => {
    const conflictEntry = gitReviewIndexEntrySchema.parse({
      entryKey: "src/gone.ts",
      oldPaths: [],
      path: "src/gone.ts",
      renderSlots: [
        {
          group: "conflict",
          oldPath: null,
          sectionKey: "section:src-gone:conflict",
          status: "conflicted",
          targetPath: "src/gone.ts",
          xy: "DU",
        },
      ],
      status: "conflicted",
    });
    expect(conflictEntry.renderSlots[0]?.xy).toBe("DU");
    expect(
      gitReviewIndexEntrySchema.safeParse({
        ...conflictEntry,
        renderSlots: conflictEntry.renderSlots.map((slot) => {
          const { xy: _xy, ...rest } = slot;
          return rest;
        }),
      }).success
    ).toBe(false);
    expect(
      gitReviewIndexEntrySchema.safeParse({
        entryKey: "src/index.ts",
        oldPaths: [],
        path: "src/index.ts",
        renderSlots: [
          {
            group: "unstaged",
            oldPath: null,
            sectionKey: "section:src-index",
            status: "modified",
            targetPath: "src/index.ts",
            xy: "UU",
          },
        ],
        status: "modified",
      }).success
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
        changeBlocks: [changeBlock],
        kind: "patch",
        newContents: "new\n",
        oldContents: "old\n",
        patch,
        sectionKey: "section:unstaged-sides",
      }).kind
    ).toBe("patch");
    expect(
      gitReviewFileSectionSchema.safeParse({
        changeBlocks: [changeBlock],
        kind: "patch",
        oldContents: "old\n",
        patch,
        sectionKey: "section:unstaged-unpaired",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.parse({
        kind: "state",
        oldPath: null,
        reason: "conflict",
        sectionKey: "section:conflict-legacy",
        status: "conflicted",
        targetPath: "src/app.ts",
      }).kind
    ).toBe("state");
    expect(
      gitReviewFileSectionSchema.parse({
        contents: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n",
        contentsDigest: "sha256:abc",
        kind: "conflict",
        oldPath: null,
        presentation: "markers-text",
        sectionKey: "section:conflict",
        stages: {
          baseOid: "1".repeat(40),
          oursOid: "2".repeat(40),
          theirsOid: "3".repeat(40),
        },
        status: "conflicted",
        targetPath: "src/app.ts",
        xy: "UU",
      }).kind
    ).toBe("conflict");
    expect(
      gitReviewFileSectionSchema.safeParse({
        contents: null,
        contentsDigest: "sha256:abc",
        kind: "conflict",
        oldPath: null,
        presentation: "markers-text",
        sectionKey: "section:conflict-empty",
        stages: { baseOid: null, oursOid: null, theirsOid: null },
        status: "conflicted",
        targetPath: "src/app.ts",
        xy: "UU",
      }).success
    ).toBe(false);
    const conflictSection = gitReviewFileSectionSchema.parse({
      contents: null,
      contentsDigest: "sha256:abc",
      kind: "conflict",
      oldPath: null,
      presentation: "file-level",
      sectionKey: "section:conflict-file",
      stages: { baseOid: null, oursOid: null, theirsOid: null },
      status: "conflicted",
      targetPath: "src/app.ts",
      xy: "DD",
    });
    expect(conflictSection.kind).toBe("conflict");
    if (conflictSection.kind === "conflict") {
      expect(conflictSection.presentation).toBe("file-level");
    }
    expect(
      gitReviewFileSectionSchema.parse({
        contents: "keep current\n",
        contentsDigest: "sha256:file-level-text",
        kind: "conflict",
        oldPath: null,
        presentation: "file-level",
        sectionKey: "section:conflict-file-text",
        stages: { baseOid: null, oursOid: null, theirsOid: null },
        status: "conflicted",
        targetPath: "src/app.ts",
        xy: "UD",
      }).contents
    ).toBe("keep current\n");
    expect(
      gitReviewFileSectionSchema.safeParse({
        contents: "nope",
        contentsDigest: "sha256:abc",
        kind: "conflict",
        oldPath: null,
        presentation: "binary",
        sectionKey: "section:conflict-binary-text",
        stages: { baseOid: null, oursOid: null, theirsOid: null },
        status: "conflicted",
        targetPath: "src/app.ts",
        xy: "UU",
      }).success
    ).toBe(false);
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

  it("accepts image sections with at least one previewable side", () => {
    const blobSide = {
      byteSize: 68,
      height: 1,
      kind: "blob" as const,
      mime: "image/png" as const,
      oid: "a".repeat(40),
      width: 1,
    };
    expect(
      gitReviewFileSectionSchema.parse({
        after: blobSide,
        before: null,
        gitRootPath: "/tmp/repo",
        kind: "image",
        oldPath: null,
        sectionKey: "section:unstaged-image",
        status: "added",
        targetPath: "icon.png",
      }).kind
    ).toBe("image");
    expect(
      gitReviewFileSectionSchema.safeParse({
        after: null,
        before: null,
        gitRootPath: "/tmp/repo",
        kind: "image",
        oldPath: null,
        sectionKey: "section:empty-image",
        status: "added",
        targetPath: "icon.png",
      }).success
    ).toBe(false);
    expect(
      gitReviewFileSectionSchema.safeParse({
        after: blobSide,
        before: null,
        gitRootPath: "/tmp/repo",
        kind: "image",
        oldPath: null,
        sectionKey: "section:conflict-image",
        status: "conflicted",
        targetPath: "icon.png",
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
