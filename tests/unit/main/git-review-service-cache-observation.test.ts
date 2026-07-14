import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  execGitRaw,
} from "@main/services/git-exec.ts";
import { GitReviewCommitLru } from "@main/services/git-review/git-review-commit-lru.ts";
import { GitReviewObserver } from "@main/services/git-review/git-review-observer.ts";
import { createGitReviewScheduler } from "@main/services/git-review/git-review-scheduler.ts";
import type {
  GitReviewScheduleRequest,
  GitReviewScheduler,
} from "@main/services/git-review/git-review-scheduler-contract.ts";
import { GitReviewService } from "@main/services/git-review/git-review-service.ts";
import type {
  GitDiffPanelSource,
  GitReviewFileDocumentOk,
  GitReviewFileDocumentRequest,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createCommitSource(): Promise<GitDiffPanelSource> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-cache-observe-"));
  roots.push(root);
  await execGit(["init"], { cwd: root });
  await execGit(["config", "user.name", "Pier Test"], { cwd: root });
  await execGit(["config", "user.email", "pier@example.invalid"], {
    cwd: root,
  });
  await writeFile(join(root, "file.ts"), "base\n", "utf8");
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", "base"], { cwd: root });
  await writeFile(join(root, "file.ts"), "next\n", "utf8");
  await execGit(["add", "-A", "--"], { cwd: root });
  await execGit(["commit", "-m", "next"], { cwd: root });
  const oid = (await execGit(["rev-parse", "HEAD"], { cwd: root })).trim();
  return {
    contextId: "worktree:cache-observe",
    gitRootPath: root,
    path: "file.ts",
    query: { kind: "commit", oid },
  };
}

function request(
  source: GitDiffPanelSource,
  operationId = randomUUID()
): GitReviewFileDocumentRequest {
  return {
    clientHasDocument: false,
    ifRevision: null,
    operationId,
    source,
  };
}

function createPausedScheduler(observer: GitReviewObserver): {
  entered: Promise<void>;
  release: () => void;
  scheduler: Pick<GitReviewScheduler, "schedule">;
} {
  const delegate = createGitReviewScheduler({ observer });
  let markEntered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    scheduler: {
      schedule<T>(input: GitReviewScheduleRequest<T>) {
        return delegate.schedule({
          ...input,
          run: async (context) => {
            markEntered();
            await gate;
            return input.run(context);
          },
        });
      },
    },
  };
}

function countingExec(): { exec: ExecGitRaw; patchCount: () => number } {
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

describe("Git Review commit cache 观测", () => {
  it("以 runner 实际 lookup 为准记录排队期间的 miss→hit 与 hit→evict", async () => {
    const source = await createCommitSource();
    const cache = new GitReviewCommitLru<GitReviewFileDocumentOk>();
    const fillService = new GitReviewService({ commitCache: cache });
    const firstEvents: Array<{
      cacheHit: boolean;
      operationId: string;
      state: string;
    }> = [];
    const firstObserver = new GitReviewObserver({
      logger: () => undefined,
      onEvent: (event) => firstEvents.push(event),
    });
    const firstPause = createPausedScheduler(firstObserver);
    const firstCounter = countingExec();
    const firstService = new GitReviewService({
      commitCache: cache,
      execGitRaw: firstCounter.exec,
      scheduler: firstPause.scheduler,
    });
    const firstOperationId = randomUUID();
    const first = firstService.getFileDocument(
      request(source, firstOperationId)
    );
    await firstPause.entered;
    await fillService.getFileDocument(request(source));
    firstPause.release();
    await expect(first).resolves.toMatchObject({ kind: "ok" });
    expect(firstCounter.patchCount()).toBe(0);
    expect(
      firstEvents.find(
        (event) =>
          event.operationId === firstOperationId && event.state === "settled"
      )?.cacheHit
    ).toBe(true);

    const secondEvents: Array<{
      cacheHit: boolean;
      operationId: string;
      state: string;
    }> = [];
    const secondObserver = new GitReviewObserver({
      logger: () => undefined,
      onEvent: (event) => secondEvents.push(event),
    });
    const secondPause = createPausedScheduler(secondObserver);
    const secondCounter = countingExec();
    const secondService = new GitReviewService({
      commitCache: cache,
      execGitRaw: secondCounter.exec,
      scheduler: secondPause.scheduler,
    });
    const secondOperationId = randomUUID();
    const second = secondService.getFileDocument(
      request(source, secondOperationId)
    );
    await secondPause.entered;
    cache.clear();
    secondPause.release();
    await expect(second).resolves.toMatchObject({ kind: "ok" });
    expect(secondCounter.patchCount()).toBe(1);
    expect(
      secondEvents.find(
        (event) =>
          event.operationId === secondOperationId && event.state === "settled"
      )?.cacheHit
    ).toBe(false);
  });
});
