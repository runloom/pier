import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  execGitRaw,
} from "@main/services/git-exec.ts";
import type {
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
  GitReviewFileSource,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";
import { TestGitReviewService as GitReviewService } from "./git-review-test-fixtures.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-reuse-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", message], { cwd: root });
  return (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
}

function source(root: string): GitReviewFileSource {
  return {
    contextId: "worktree:reuse",
    gitRootPath: root,
    oldPaths: [],
    path: "file.ts",
    target: { kind: "uncommitted" },
  };
}

function request(
  documentSource: GitReviewFileSource
): GitReviewFileDocumentRequest {
  return {
    operationId: randomUUID(),
    source: documentSource,
  };
}

function expectOk(
  result: GitReviewFileDocumentResult
): asserts result is Extract<GitReviewFileDocumentResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
}

function countingExec(): {
  readonly exec: ExecGitRaw;
  patchCount: () => number;
} {
  let patches = 0;
  return {
    exec: async (args, options) => {
      if (args.includes("--patch-with-raw")) {
        patches += 1;
      }
      return execGitRaw(args, options);
    },
    patchCount: () => patches,
  };
}

describe("GitReviewService reuse", () => {
  it("100 个相同 full 请求共享同一个 in-flight document", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "next\n", "utf8");
    const counter = countingExec();
    const service = new GitReviewService({ execGitRaw: counter.exec });
    const documentSource = source(root);

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        service.getFileDocument(request(documentSource))
      )
    );

    expect(results.every((result) => result.kind === "ok")).toBe(true);
    expect(counter.patchCount()).toBe(1);
  });

  it("未提交文档 settled 后不长期缓存", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "next\n", "utf8");
    const counter = countingExec();
    const service = new GitReviewService({ execGitRaw: counter.exec });
    const documentSource = source(root);

    const first = await service.getFileDocument(request(documentSource));
    const second = await service.getFileDocument(request(documentSource));
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(counter.patchCount()).toBe(2);
  });

  it("显式 --unified=20 覆盖 GIT_DIFF_OPTS", async () => {
    const root = await createRepository();
    const base = Array.from({ length: 50 }, (_, index) => `line-${index}`).join(
      "\n"
    );
    await writeFile(join(root, "file.ts"), `${base}\n`, "utf8");
    await commitAll(root, "base");
    await writeFile(
      join(root, "file.ts"),
      `${base.replace("line-25", "changed-25")}\n`,
      "utf8"
    );
    const previous = process.env.GIT_DIFF_OPTS;
    process.env.GIT_DIFF_OPTS = "--unified=0";
    try {
      const result = await new GitReviewService().getFileDocument(
        request(source(root))
      );
      expectOk(result);
      const section = result.sections[0];
      expect(section).toMatchObject({ kind: "patch" });
      expect(section?.kind === "patch" ? section.patch : "").toContain(
        "@@ -6,41 +6,41 @@"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.GIT_DIFF_OPTS;
      } else {
        process.env.GIT_DIFF_OPTS = previous;
      }
    }
  });
});
