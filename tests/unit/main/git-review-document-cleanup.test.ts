import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  execGitRaw,
} from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { readGitReviewPatch } from "@main/services/git-review/git-review-document-patch.ts";
import type { ReadGitReviewPatchOptions } from "@main/services/git-review/git-review-document-patch-contract.ts";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const oid = "1".repeat(40);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createOptions(
  exec: ExecGitRaw,
  signal?: AbortSignal
): Promise<{ options: ReadGitReviewPatchOptions; temporaryRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-cleanup-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await writeFile(join(root, "new.ts"), "new\n", "utf8");
  const temporaryRoot = join(root, "isolated-temp");
  return {
    options: {
      budget: new GitReviewBudget(),
      createTemporaryRoot: async () => {
        await mkdir(temporaryRoot);
        return temporaryRoot;
      },
      execGitRaw: exec,
      fact: {
        movement: null,
        oldPath: null,
        origin: "untracked",
        statsExpected: true,
        status: "added",
        targetPath: "new.ts",
      },
      gitRootPath: root,
      group: "unstaged",
      query: {
        groups: ["unstaged"],
        headOid: oid,
        indexToken: "index",
        kind: "uncommitted",
      },
      ...(signal === undefined ? {} : { signal }),
    },
    temporaryRoot,
  };
}

async function expectRemoved(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("Git Review untracked 临时目录清理", () => {
  it("Git 子命令失败时保留原错误并删除临时 index/ODB", async () => {
    const forced = new Error("forced update-index failure");
    const exec: ExecGitRaw = async (args, options) => {
      if (args.includes("update-index")) {
        throw forced;
      }
      return execGitRaw(args, options);
    };
    const fixture = await createOptions(exec);

    await expect(readGitReviewPatch(fixture.options)).rejects.toBe(forced);
    await expectRemoved(fixture.temporaryRoot);
  });

  it("取消发生在临时目录创建后时仍删除临时 index/ODB", async () => {
    const controller = new AbortController();
    controller.abort();
    const fixture = await createOptions(execGitRaw, controller.signal);

    await expect(readGitReviewPatch(fixture.options)).rejects.toThrow();
    await expectRemoved(fixture.temporaryRoot);
  });
});
