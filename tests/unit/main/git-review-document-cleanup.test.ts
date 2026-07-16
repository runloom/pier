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
import type { GitReviewIndexExecutionBudget } from "@main/services/git-review/git-review-index-contract.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryRootCreation = vi.hoisted(() => ({
  handler: null as null | (() => Promise<string>),
  removeHandler: null as null | ((path: string) => Promise<void>),
}));

vi.mock(
  "@main/services/git-review/git-review-temporary-root.ts",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@main/services/git-review/git-review-temporary-root.ts")
      >();
    return {
      ...original,
      createGitReviewTemporaryRoot: () =>
        temporaryRootCreation.handler
          ? temporaryRootCreation.handler()
          : original.createGitReviewTemporaryRoot(),
      removeGitReviewTemporaryRoot: (path: string) =>
        temporaryRootCreation.removeHandler
          ? temporaryRootCreation.removeHandler(path)
          : original.removeGitReviewTemporaryRoot(path),
    };
  }
);

const roots: string[] = [];
const oid = "1".repeat(40);

afterEach(async () => {
  temporaryRootCreation.handler = null;
  temporaryRootCreation.removeHandler = null;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createOptions(
  exec: ExecGitRaw,
  signal?: AbortSignal,
  budget: GitReviewIndexExecutionBudget = new GitReviewBudget()
): Promise<{ options: ReadGitReviewPatchOptions; temporaryRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-cleanup-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await writeFile(join(root, "new.ts"), "new\n", "utf8");
  const temporaryRoot = join(root, "isolated-temp");
  temporaryRootCreation.handler = async () => {
    await mkdir(temporaryRoot);
    return temporaryRoot;
  };
  return {
    options: {
      budget,
      execGitRaw: exec,
      fact: {
        movement: null,
        oldPath: null,
        origin: "untracked",
        sourceOid: null,
        statsExpected: true,
        status: "added",
        targetOid: null,
        targetPath: "new.ts",
      },
      gitRootPath: root,
      group: "unstaged",
      headOid: oid,
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
    const exec: ExecGitRaw = async (args, options) => {
      if (args.includes("update-index")) {
        controller.abort();
      }
      return execGitRaw(args, options);
    };
    const fixture = await createOptions(exec, controller.signal);

    await expect(readGitReviewPatch(fixture.options)).rejects.toThrow();
    await expectRemoved(fixture.temporaryRoot);
  });

  it("临时目录创建 Promise 静默失联时取消仍能及时结算", async () => {
    const controller = new AbortController();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fixture = await createOptions(execGitRaw, controller.signal);
    temporaryRootCreation.handler = async () => {
      markStarted();
      return new Promise(() => undefined);
    };
    const pending = readGitReviewPatch(fixture.options);
    await started;

    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("取消后晚到的临时目录创建结果仍会被删除", async () => {
    const controller = new AbortController();
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveRoot: (root: string) => void = () => undefined;
    const fixture = await createOptions(execGitRaw, controller.signal);
    temporaryRootCreation.handler = async () => {
      markStarted();
      return new Promise<string>((resolve) => {
        resolveRoot = resolve;
      });
    };
    const pending = readGitReviewPatch(fixture.options);
    await started;

    controller.abort();
    await expect(pending).rejects.toThrow();
    await mkdir(fixture.temporaryRoot);
    resolveRoot(fixture.temporaryRoot);

    await vi.waitFor(() => expectRemoved(fixture.temporaryRoot));
  });

  it("清理超时时把未结算 rm 登记给原调度预算", async () => {
    let resolveRemove: () => void = () => undefined;
    const pendingRemove = new Promise<void>((resolve) => {
      resolveRemove = resolve;
    });
    const trackDetachedOperation = vi.fn();
    const innerBudget = new GitReviewBudget();
    const budget: GitReviewIndexExecutionBudget = {
      consumeOutputBytes: (delta) => innerBudget.consumeOutputBytes(delta),
      failureReason: () => innerBudget.failureReason(),
      remainingTimeMs: () => innerBudget.remainingTimeMs(),
      signal: innerBudget.signal,
      trackDetachedOperation,
    };
    const fixture = await createOptions(execGitRaw, undefined, budget);
    temporaryRootCreation.removeHandler = () => pendingRemove;

    const read = readGitReviewPatch(fixture.options);

    await expect(read).rejects.toMatchObject({ kind: "timeout" });
    expect(trackDetachedOperation).toHaveBeenCalledWith(pendingRemove);
    resolveRemove();
    innerBudget.dispose();
  });
});
