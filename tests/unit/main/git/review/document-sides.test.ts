import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git/exec.ts";
import type { GitExecRawResult } from "@main/services/git/exec-raw-contract.ts";
import { GitReviewBudget } from "@main/services/git-review/budget.ts";
import {
  GitReviewDocumentStaleError,
  type ReadGitReviewPatchOptions,
} from "@main/services/git-review/document/patch-contract.ts";
import {
  GIT_REVIEW_DIFF_SIDES_MAX_BYTES,
  tryReadGitReviewDiffSides,
  withGitReviewDiffSides,
} from "@main/services/git-review/document/patch-sides.ts";
import { tryReadFingerprint } from "@main/services/git-review/document/patch-snapshot.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const sourceOid = "a".repeat(40);
const targetOid = "b".repeat(40);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

function collected(stdout: Buffer): GitExecRawResult {
  return {
    kind: "collected",
    stderrBytes: 0,
    stderrTail: Buffer.alloc(0),
    stdout,
    stdoutBytes: stdout.length,
  };
}

function patchMaterial(oids?: {
  readonly sourceOid?: string | null;
  readonly targetOid?: string | null;
}) {
  return {
    kind: "patch" as const,
    patch: "diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
    sourceOid: oids?.sourceOid === undefined ? sourceOid : oids.sourceOid,
    sourceRevision: "sha256:patch",
    targetOid: oids?.targetOid === undefined ? targetOid : oids.targetOid,
  };
}

function options(
  overrides: Partial<ReadGitReviewPatchOptions> = {}
): ReadGitReviewPatchOptions {
  return {
    budget: new GitReviewBudget(),
    execGitRaw: vi.fn(),
    fact: {
      conflict: null,
      movement: null,
      oldPath: null,
      origin: "tracked",
      sourceOid,
      statsExpected: true,
      status: "modified",
      targetOid,
      targetPath: "file.ts",
    },
    gitRootPath: "/repo",
    group: "staged",
    headOid: sourceOid,
    ...overrides,
  };
}

describe("git review patch sides", () => {
  it("reads staged sides from cat-file, not the worktree", async () => {
    const calls: string[][] = [];
    const readOptions = options({
      execGitRaw: async (args) => {
        calls.push([...args]);
        if (args[0] === "cat-file" && args[2] === sourceOid) {
          return collected(Buffer.from("old\n"));
        }
        if (args[0] === "cat-file" && args[2] === targetOid) {
          return collected(Buffer.from("new\n"));
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
    });
    const sides = await tryReadGitReviewDiffSides(readOptions, patchMaterial());
    expect(sides).toEqual({ newContents: "new\n", oldContents: "old\n" });
    expect(calls.every((args) => args[0] === "cat-file")).toBe(true);
  });

  it("uses empty oldContents for added files without a blob oid", async () => {
    const sides = await tryReadGitReviewDiffSides(
      options({
        execGitRaw: async (args) => {
          if (args[0] === "cat-file" && args[2] === targetOid) {
            return collected(Buffer.from("new\n"));
          }
          throw new Error(`unexpected git ${args.join(" ")}`);
        },
        fact: {
          conflict: null,
          movement: null,
          oldPath: null,
          origin: "tracked",
          sourceOid: null,
          statsExpected: true,
          status: "added",
          targetOid,
          targetPath: "file.ts",
        },
      }),
      patchMaterial({ sourceOid: null })
    );
    expect(sides).toEqual({ newContents: "new\n", oldContents: "" });
  });

  it("uses empty newContents for deleted files", async () => {
    const sides = await tryReadGitReviewDiffSides(
      options({
        execGitRaw: async (args) => {
          if (args[0] === "cat-file" && args[2] === sourceOid) {
            return collected(Buffer.from("gone\n"));
          }
          throw new Error(`unexpected git ${args.join(" ")}`);
        },
        fact: {
          conflict: null,
          movement: null,
          oldPath: null,
          origin: "tracked",
          sourceOid,
          statsExpected: false,
          status: "deleted",
          targetOid: null,
          targetPath: "file.ts",
        },
      }),
      patchMaterial({ targetOid: null })
    );
    expect(sides).toEqual({ newContents: "", oldContents: "gone\n" });
  });

  it("omits sides when a modified patch is missing a blob oid", async () => {
    const sides = await tryReadGitReviewDiffSides(
      options({
        fact: {
          conflict: null,
          movement: null,
          oldPath: null,
          origin: "tracked",
          sourceOid: null,
          statsExpected: true,
          status: "modified",
          targetOid,
          targetPath: "file.ts",
        },
      }),
      patchMaterial({ sourceOid: null })
    );
    expect(sides).toBeNull();
  });

  it("omits binary, non-utf8, and oversized blob sides", async () => {
    const binary = await tryReadGitReviewDiffSides(
      options({
        execGitRaw: async () => collected(Buffer.from("a\0b")),
      }),
      patchMaterial()
    );
    const invalid = await tryReadGitReviewDiffSides(
      options({
        execGitRaw: async () => collected(Buffer.from([0xff, 0xfe, 0xfd])),
      }),
      patchMaterial()
    );
    const oversized = await tryReadGitReviewDiffSides(
      options({
        execGitRaw: async () =>
          collected(Buffer.alloc(GIT_REVIEW_DIFF_SIDES_MAX_BYTES + 1)),
      }),
      patchMaterial()
    );
    expect(binary).toBeNull();
    expect(invalid).toBeNull();
    expect(oversized).toBeNull();
  });

  it("keeps matching worktree fences and stale-retries when they drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-sides-"));
    roots.push(root);
    await execGit(["init"], { cwd: root });
    await writeFile(join(root, "file.ts"), "worktree\n", "utf8");
    const readOptions = options({
      execGitRaw: async (args) => {
        if (args[0] === "cat-file" && args[2] === sourceOid) {
          return collected(Buffer.from("old\n"));
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      gitRootPath: root,
      group: "unstaged",
    });
    const fence = await tryReadFingerprint(readOptions);
    expect(fence.kind).toBe("snapshot");
    if (fence.kind !== "snapshot") {
      throw new Error("expected worktree fingerprint");
    }
    const attached = await withGitReviewDiffSides(
      readOptions,
      patchMaterial(),
      {
        digest: fence.snapshot.digest,
        identityToken: fence.snapshot.identityToken,
      }
    );
    expect(attached).toMatchObject({
      kind: "patch",
      newContents: "worktree\n",
      oldContents: "old\n",
    });
    await expect(
      withGitReviewDiffSides(readOptions, patchMaterial(), {
        digest: "sha256:not-this-worktree",
        identityToken: "stale-token",
      })
    ).rejects.toBeInstanceOf(GitReviewDocumentStaleError);
  });

  it("stale-retries when the worktree file is missing for unstaged sides", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-sides-missing-"));
    roots.push(root);
    await execGit(["init"], { cwd: root });
    const readOptions = options({
      execGitRaw: async (args) => {
        if (args[0] === "cat-file" && args[2] === sourceOid) {
          return collected(Buffer.from("old\n"));
        }
        throw new Error(`unexpected git ${args.join(" ")}`);
      },
      gitRootPath: root,
      group: "unstaged",
    });
    await expect(
      tryReadGitReviewDiffSides(readOptions, patchMaterial())
    ).rejects.toBeInstanceOf(GitReviewDocumentStaleError);
  });
});
