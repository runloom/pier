import {
  getGitDiffPanelSourceIdentity,
  gitDiffPanelSourceSchema,
  gitReviewFileDocumentRequestSchema,
  gitReviewFileDocumentResultSchema,
  gitReviewFileSectionSchema,
  gitReviewIndexEntrySchema,
  gitReviewIndexOkSchema,
  gitReviewQuerySchema,
  gitReviewResolvedQuerySchema,
  measureGitReviewParserText,
} from "@shared/contracts/git-review.ts";
import { describe, expect, it } from "vitest";

const operationId = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";
const sha1 = "1".repeat(40);
const sha256 = "2".repeat(64);
const source = {
  contextId: "worktree:abc",
  gitRootPath: "/Users/xyz/ABC/pier",
  path: "src/index.ts",
  query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
} as const;
const normalizedSource = gitDiffPanelSourceSchema.parse(source);

const patch = "@@ -1 +1 @@\n-old\n+new\n";
const patchMetrics = measureGitReviewParserText(patch);
const sectionBase = {
  additions: 2,
  deletions: 1,
  group: "unstaged",
  oldPath: null,
  path: "src/index.ts",
  sectionKey: "unstaged:src/index.ts",
  sourceRevision: "section-v1",
  status: "modified",
} as const;

describe("Git review shared contract", () => {
  it("normalizes queries and rejects incomplete or unsafe revision inputs", () => {
    expect(gitReviewQuerySchema.parse(source.query)).toEqual(source.query);
    for (const groups of [
      [],
      ["unstaged", "unstaged"],
      ["staged", "unstaged"],
      ["conflict"],
    ]) {
      expect(
        gitReviewQuerySchema.safeParse({ groups, kind: "uncommitted" }).success
      ).toBe(false);
    }

    for (const oid of [sha1, sha256, "HEAD~1"]) {
      expect(
        gitReviewQuerySchema.safeParse({ kind: "commit", oid }).success
      ).toBe(true);
    }
    for (const oid of ["-HEAD", "HEAD\nmain", "HEAD\0main"]) {
      expect(
        gitReviewQuerySchema.safeParse({ kind: "commit", oid }).success
      ).toBe(false);
    }
    expect(
      gitDiffPanelSourceSchema.safeParse({
        ...source,
        query: { kind: "commit", oid: "HEAD~1" },
      }).success
    ).toBe(false);
  });

  it("accepts only complete Git branch refs", () => {
    for (const targetRef of [
      "refs/heads/feature/review",
      "refs/remotes/origin/feature/review",
    ]) {
      expect(
        gitReviewQuerySchema.safeParse({ kind: "branch", targetRef }).success
      ).toBe(true);
    }
    for (const targetRef of [
      "main~1",
      "refs/heads/a//b",
      "refs/heads/.hidden",
      "refs/heads/feature.lock/child",
      "refs/remotes/origin",
      "refs/remotes/origin/.hidden",
    ]) {
      expect(
        gitReviewQuerySchema.safeParse({ kind: "branch", targetRef }).success
      ).toBe(false);
    }
  });

  it("represents SHA-1/SHA-256, root commits, and unborn uncommitted state", () => {
    expect(
      gitReviewResolvedQuerySchema.parse({
        baseOid: null,
        commitOid: sha256,
        kind: "commit",
        root: true,
      })
    ).toMatchObject({ root: true });
    expect(
      gitReviewResolvedQuerySchema.parse({
        groups: ["unstaged"],
        headOid: null,
        indexToken: "index-v1",
        kind: "uncommitted",
      })
    ).toMatchObject({ headOid: null });
  });

  it("uses a canonical stable identity after schema normalization", () => {
    const uppercaseCommit = {
      ...source,
      query: { kind: "commit", oid: "A".repeat(40) },
    } as const;
    const lowercaseCommit = {
      query: { oid: "a".repeat(40), kind: "commit" },
      path: source.path,
      gitRootPath: source.gitRootPath,
      contextId: source.contextId,
    } as const;
    expect(getGitDiffPanelSourceIdentity(uppercaseCommit)).toBe(
      getGitDiffPanelSourceIdentity(lowercaseCommit)
    );
    expect(getGitDiffPanelSourceIdentity(normalizedSource)).not.toBe(
      getGitDiffPanelSourceIdentity({
        ...normalizedSource,
        path: "src/other.ts",
      })
    );
  });

  it("keeps scope, safe paths, ordered groups, and aggregate status together", () => {
    expect(gitDiffPanelSourceSchema.parse(source)).toEqual(source);
    for (const path of ["\\notes.txt", "dir\\..\\file"]) {
      expect(
        gitDiffPanelSourceSchema.safeParse({ ...source, path }).success
      ).toBe(true);
    }
    for (const path of [
      "../outside.ts",
      "./inside.ts",
      "src//index.ts",
      "src/./index.ts",
      "src/\0index.ts",
      "/absolute.ts",
    ]) {
      expect(
        gitDiffPanelSourceSchema.safeParse({ ...source, path }).success
      ).toBe(false);
    }

    const entry = gitReviewIndexEntrySchema.parse({
      additions: 3,
      deletions: 1,
      entryKey: "src/index.ts",
      groups: ["unstaged", "staged"],
      groupStatuses: { staged: "added", unstaged: "modified" },
      oldPaths: [],
      path: "src/index.ts",
      status: "added",
    });
    for (const invalid of [
      { ...entry, groups: ["unstaged", "unstaged"] },
      { ...entry, groups: ["staged", "unstaged"] },
      { ...entry, status: "modified" },
      { ...entry, unexpected: true },
      {
        ...entry,
        groups: ["conflict"],
        groupStatuses: { conflict: "modified" },
        status: "modified",
      },
      {
        ...entry,
        groupStatuses: { staged: "conflicted", unstaged: "modified" },
        status: "conflicted",
      },
      {
        ...entry,
        groups: ["unstaged", "conflict"],
        groupStatuses: { conflict: "conflicted", unstaged: "modified" },
        status: "conflicted",
      },
    ]) {
      expect(gitReviewIndexEntrySchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("keeps index groups aligned with uncommitted, commit, and branch queries", () => {
    const commitEntry = {
      additions: 1,
      deletions: 0,
      entryKey: "sha256:commit-entry",
      groups: ["commit"],
      groupStatuses: { commit: "added" },
      oldPaths: [],
      path: "src/commit.ts",
      status: "added",
    } as const;
    const branchEntry = {
      ...commitEntry,
      entryKey: "sha256:branch-entry",
      groups: ["branch"],
      groupStatuses: { branch: "modified" },
      path: "src/branch.ts",
      status: "modified",
    } as const;
    expect(gitReviewIndexEntrySchema.parse(commitEntry).groups).toEqual([
      "commit",
    ]);
    expect(gitReviewIndexEntrySchema.parse(branchEntry).groups).toEqual([
      "branch",
    ]);
    for (const invalid of [
      { ...commitEntry, groups: ["commit", "staged"] },
      {
        ...commitEntry,
        groups: ["branch", "commit"],
        groupStatuses: { branch: "added", commit: "added" },
      },
    ]) {
      expect(gitReviewIndexEntrySchema.safeParse(invalid).success).toBe(false);
    }

    const baseResult = {
      durationMs: 1,
      gitRootPath: source.gitRootPath,
      kind: "ok",
      revision: "sha256:index",
      warnings: [],
    } as const;
    expect(
      gitReviewIndexOkSchema.safeParse({
        ...baseResult,
        entries: [commitEntry],
        query: {
          baseOid: sha1,
          commitOid: sha256,
          kind: "commit",
          root: false,
        },
        sourceQuery: { kind: "commit", oid: sha256 },
      }).success
    ).toBe(true);
    expect(
      gitReviewIndexOkSchema.safeParse({
        ...baseResult,
        entries: [branchEntry],
        query: {
          headOid: sha1,
          kind: "branch",
          mergeBaseOid: sha1,
          targetOid: sha256,
          targetRef: "refs/heads/main",
        },
        sourceQuery: { kind: "branch", targetRef: "refs/heads/main" },
      }).success
    ).toBe(true);
    expect(
      gitReviewIndexOkSchema.safeParse({
        ...baseResult,
        entries: [commitEntry],
        query: {
          headOid: sha1,
          kind: "branch",
          mergeBaseOid: sha1,
          targetOid: sha256,
          targetRef: "refs/heads/main",
        },
        sourceQuery: { kind: "branch", targetRef: "refs/heads/main" },
      }).success
    ).toBe(false);
    expect(
      gitReviewIndexOkSchema.safeParse({
        ...baseResult,
        entries: [branchEntry],
        query: {
          groups: ["unstaged"],
          headOid: sha1,
          indexToken: "sha256:index",
          kind: "uncommitted",
        },
        sourceQuery: { groups: ["unstaged"], kind: "uncommitted" },
      }).success
    ).toBe(false);
  });

  it("keeps patch, conflict state, and unknown fields mutually exclusive", () => {
    expect(
      gitReviewFileSectionSchema.parse({
        ...sectionBase,
        byteSize: patchMetrics.byteSize,
        contextLines: 20,
        kind: "patch",
        lineCount: patchMetrics.lineCount,
        patch,
      }).kind
    ).toBe("patch");
    expect(
      gitReviewFileSectionSchema.parse({
        ...sectionBase,
        byteSize: 0,
        group: "conflict",
        kind: "state",
        lineCount: 0,
        message: null,
        reason: "conflict",
        status: "conflicted",
      }).kind
    ).toBe("state");
    expect(
      gitReviewFileSectionSchema.safeParse({
        ...sectionBase,
        byteSize: patchMetrics.byteSize,
        contextLines: 20,
        group: "conflict",
        kind: "patch",
        lineCount: patchMetrics.lineCount,
        patch,
        status: "conflicted",
      }).success
    ).toBe(false);
  });

  it("bounds and fences conditional document requests", () => {
    expect(
      gitReviewFileDocumentRequestSchema.safeParse({
        clientHasDocument: true,
        ifRevision: null,
        operationId,
        source,
      }).success
    ).toBe(false);
    expect(
      gitReviewFileDocumentResultSchema.parse({
        kind: "notModified",
        revision: "document-v1",
        source,
      }).kind
    ).toBe("notModified");
    const patchSection = {
      ...sectionBase,
      byteSize: patchMetrics.byteSize,
      contextLines: 20,
      kind: "patch",
      lineCount: patchMetrics.lineCount,
      patch,
    } as const;
    expect(
      gitReviewFileDocumentResultSchema.parse({
        durationMs: 1,
        kind: "ok",
        resolvedQuery: {
          groups: ["unstaged"],
          headOid: sha1,
          indexToken: "index-v1",
          kind: "uncommitted",
        },
        revision: "document-v1",
        sections: [patchSection],
        source,
      }).kind
    ).toBe("ok");
    expect(
      gitReviewFileDocumentResultSchema.safeParse({
        durationMs: 1,
        kind: "ok",
        resolvedQuery: {
          groups: ["unstaged"],
          headOid: sha1,
          indexToken: "index-v1",
          kind: "uncommitted",
        },
        revision: "document-v1",
        sections: [],
        source,
      }).success
    ).toBe(false);
  });
});
