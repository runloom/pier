import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import type {
  GitReviewFileSource,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";
import { TestGitReviewService as GitReviewService } from "./git-review-test-fixtures.ts";

const roots: string[] = [];
const FILE_COUNT = 2001;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createLargeRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-large-index-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  const paths = Array.from(
    { length: FILE_COUNT },
    (_, index) => `file-${index.toString().padStart(4, "0")}.ts`
  );
  await Promise.all(
    paths.map((path) => writeFile(join(root, path), "before\n", "utf8"))
  );
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  await Promise.all(
    paths.map((path) => writeFile(join(root, path), "after\n", "utf8"))
  );
  return root;
}

function documentSource(
  root: string,
  entry: GitReviewIndexEntry
): GitReviewFileSource {
  return {
    contextId: "worktree:large-index",
    gitRootPath: root,
    oldPaths: entry.oldPaths,
    path: entry.path,
    target: { kind: "uncommitted" },
  };
}

describe("Git Review large index document probes", () => {
  it("超过旧 2000 边界后首中尾文件仍只探测目标路径", async () => {
    const root = await createLargeRepository();
    const service = new GitReviewService();
    const index = await service.getIndex({
      operationId: randomUUID(),
      source: {
        contextId: "worktree:large-index",
        gitRootPath: root,
        target: { kind: "uncommitted" },
      },
    });

    expect(index.kind).toBe("ok");
    if (index.kind !== "ok") {
      return;
    }
    expect(index.entries).toHaveLength(FILE_COUNT);
    const targets = [
      index.entries[0],
      index.entries[Math.floor(FILE_COUNT / 2)],
      index.entries.at(-1),
    ];
    for (const entry of targets) {
      expect(entry).toBeDefined();
      if (!entry) {
        continue;
      }
      const document = await service.getFileDocument({
        operationId: randomUUID(),
        source: documentSource(root, entry),
      });
      expect(document).toMatchObject({
        kind: "ok",
        sections: [expect.objectContaining({ kind: "patch" })],
      });
      if (document.kind === "ok" && document.sections[0]?.kind === "patch") {
        expect(document.sections[0].patch).toContain(entry.path);
      }
    }
  }, 20_000);
});
