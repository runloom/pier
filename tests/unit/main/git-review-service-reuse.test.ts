import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  execGitRaw,
} from "@main/services/git-exec.ts";
import { createGitReviewScheduler } from "@main/services/git-review/git-review-scheduler.ts";
import type {
  GitReviewScheduleRequest,
  GitReviewScheduler,
} from "@main/services/git-review/git-review-scheduler-contract.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import type {
  GitDiffPanelSource,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";

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

function source(
  root: string,
  query: GitDiffPanelSource["query"] = {
    groups: ["unstaged"],
    kind: "uncommitted",
  }
): GitDiffPanelSource {
  return {
    contextId: "worktree:reuse",
    gitRootPath: root,
    path: "file.ts",
    query,
  };
}

function request(
  documentSource: GitDiffPanelSource,
  conditional?: string
): GitReviewFileDocumentRequest {
  return {
    clientHasDocument: conditional !== undefined,
    ifRevision: conditional ?? null,
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

  it("full 与 conditional 不合并，未提交文档 settled 后也不长期缓存", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "next\n", "utf8");
    const counter = countingExec();
    const service = new GitReviewService({ execGitRaw: counter.exec });
    const documentSource = source(root);

    const concurrent = await Promise.all([
      service.getFileDocument(request(documentSource)),
      service.getFileDocument(request(documentSource, "sha256:not-current")),
    ]);
    expect(concurrent.every((result) => result.kind === "ok")).toBe(true);
    expect(counter.patchCount()).toBe(2);

    await service.getFileDocument(request(documentSource));
    expect(counter.patchCount()).toBe(3);
  });

  it("branch document settled 后不进入长期缓存", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["branch", "target"], { cwd: root });
    await writeFile(join(root, "file.ts"), "head\n", "utf8");
    await commitAll(root, "head");
    const counter = countingExec();
    const service = new GitReviewService({ execGitRaw: counter.exec });
    const documentSource = source(root, {
      kind: "branch",
      targetRef: "refs/heads/target",
    });

    const first = await service.getFileDocument(request(documentSource));
    const second = await service.getFileDocument(request(documentSource));

    expectOk(first);
    expectOk(second);
    expect(counter.patchCount()).toBe(2);
  });

  it("固定 commit 文档进入加权 LRU，后续 conditional 命中不再读取 Git", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "next\n", "utf8");
    const commitOid = await commitAll(root, "next");
    const counter = countingExec();
    const service = new GitReviewService({ execGitRaw: counter.exec });
    const documentSource = source(root, { kind: "commit", oid: commitOid });

    const first = await service.getFileDocument(request(documentSource));
    expectOk(first);
    expect(counter.patchCount()).toBe(1);

    const second = await service.getFileDocument(
      request(documentSource, first.revision)
    );
    expect(second).toMatchObject({
      kind: "notModified",
      revision: first.revision,
    });
    expect(counter.patchCount()).toBe(1);
  });

  it("commit cache 命中仍经过 scheduler，并拒绝活动中的重复 operationId", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "next\n", "utf8");
    const commitOid = await commitAll(root, "next");
    const delegate = createGitReviewScheduler();
    let delayCacheHit = false;
    let releaseDelay: () => void = () => undefined;
    let markEntered: () => void = () => undefined;
    const delay = new Promise<void>((resolve) => {
      releaseDelay = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const scheduler: Pick<GitReviewScheduler, "schedule"> = {
      schedule<T>(input: GitReviewScheduleRequest<T>) {
        return delegate.schedule({
          ...input,
          run: async (context) => {
            if (delayCacheHit) {
              markEntered();
              await delay;
            }
            return input.run(context);
          },
        });
      },
    };
    const service = new GitReviewService({ scheduler });
    const documentSource = source(root, { kind: "commit", oid: commitOid });
    const initial = await service.getFileDocument(request(documentSource));
    expectOk(initial);

    delayCacheHit = true;
    const operationId = randomUUID();
    const cachedRequest = {
      ...request(documentSource, initial.revision),
      operationId,
    };
    const first = service.getFileDocument(cachedRequest);
    await entered;
    const duplicate = await service.getFileDocument(cachedRequest);

    expect(duplicate).toMatchObject({
      kind: "error",
      reason: "duplicateOperation",
      retryable: false,
    });
    releaseDelay();
    await expect(first).resolves.toMatchObject({ kind: "notModified" });
  });

  it("显式 --unified=20 覆盖 GIT_DIFF_OPTS，patch 与 contextLines 一致", async () => {
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
      expect(section).toMatchObject({ contextLines: 20, kind: "patch" });
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

  it("hunk 内以 ++/-- 开头的源码仍各计一次增删", async () => {
    const root = await createRepository();
    await writeFile(join(root, "file.ts"), "--old\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "file.ts"), "++new\n", "utf8");

    const result = await new GitReviewService().getFileDocument(
      request(source(root))
    );

    expectOk(result);
    expect(result.sections[0]).toMatchObject({ additions: 1, deletions: 1 });
  });
});
