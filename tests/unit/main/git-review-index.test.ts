import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExecGitRaw,
  execGit,
  type GitExecRawResult,
} from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import type { GitReviewRepositoryIdentity } from "@main/services/git-review/git-review-identity.ts";
import { GitReviewIndexReader } from "@main/services/git-review/git-review-index.ts";
import {
  GIT_REVIEW_INDEX_MAX_NUL_RECORDS,
  GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
  type GitReviewIndexExecutionBudget,
} from "@main/services/git-review/git-review-index-contract.ts";
import { toGitReviewIndexFailure } from "@main/services/git-review/git-review-index-execution.ts";
import { createGitReviewScheduler } from "@main/services/git-review/git-review-scheduler.ts";
import type { GitReviewQuery } from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const sha1 = "1".repeat(40);
const sha1New = "2".repeat(40);
const zeroSha1 = "0".repeat(40);
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const scope = { contextId: "worktree:test", gitRootPath: "/repo" } as const;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-review-index-"));
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

function repositoryIdentity(): GitReviewRepositoryIdentity {
  return {
    canonicalRoot: "/repo",
    emptyTreeOid: emptyTree,
    headOid: sha1,
    objectFormat: "sha1",
    oidLength: 40,
  };
}

function fakeIdentityResolver(identity = repositoryIdentity()) {
  return {
    async resolveBranchInRepository() {
      return {
        headOid: identity.headOid ?? sha1,
        mergeBaseOid: "2".repeat(40),
        targetOid: "3".repeat(40),
        targetRef: "refs/heads/main",
      } as const;
    },
    async resolveCommitInRepository() {
      return {
        firstParentOid: "2".repeat(40),
        oid: "3".repeat(40),
        parentOids: ["2".repeat(40)],
      };
    },
    async resolveRepository() {
      return identity;
    },
  };
}

function createRecordExec(
  select: (args: readonly string[]) => {
    records: readonly Buffer[];
    stderr?: string;
  }
): ExecGitRaw {
  return vi.fn(async (args, options): Promise<GitExecRawResult> => {
    if (options.mode !== "stream") {
      throw new Error("test expected stream mode");
    }
    const selected = select(args);
    let completeRecords = 0;
    for (const record of selected.records) {
      completeRecords += 1;
      if (options.onRecord(record) === "stop") {
        return {
          completeRecords,
          kind: "truncated",
          stderrBytes: Buffer.byteLength(selected.stderr ?? ""),
          stderrTail: Buffer.from(selected.stderr ?? ""),
          stdoutBytes: 0,
        };
      }
    }
    return {
      completeRecords,
      kind: "streamed",
      stderrBytes: Buffer.byteLength(selected.stderr ?? ""),
      stderrTail: Buffer.from(selected.stderr ?? ""),
      stdoutBytes: 0,
    };
  });
}

function createRenameChainRecords(count: number): {
  stagedStats: Buffer[];
  status: Buffer[];
  unstagedStats: Buffer[];
} {
  const stagedStatus: Buffer[] = [];
  const unstagedStatus: Buffer[] = [];
  const stagedStats: Buffer[] = [];
  const unstagedStats: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = `source-${index}.ts`;
    const middle = `middle-${index}.ts`;
    const target = `target-${index}.ts`;
    stagedStatus.push(
      Buffer.from(
        `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R100 ${middle}`
      ),
      Buffer.from(source)
    );
    unstagedStatus.push(
      Buffer.from(
        `2 .R N... 100644 100644 100644 ${sha1New} ${sha1New} R100 ${target}`
      ),
      Buffer.from(middle)
    );
    stagedStats.push(
      Buffer.from("0\t0\t"),
      Buffer.from(source),
      Buffer.from(middle)
    );
    unstagedStats.push(
      Buffer.from("0\t0\t"),
      Buffer.from(middle),
      Buffer.from(target)
    );
  }
  return {
    stagedStats,
    status: [...stagedStatus, ...unstagedStatus],
    unstagedStats,
  };
}

describe("GitReviewIndexReader", () => {
  it("以常数命令合并 staged/unstaged，并固定 literal NUL 协议", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `1 MM N... 100644 100644 100644 ${sha1} ${sha1} src/a.ts`
            ),
          ],
        };
      }
      return { records: [Buffer.from("1\t2\tsrc/a.ts")] };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read({
      query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
      scope,
    });

    expect(result).toMatchObject({
      entries: [
        {
          additions: 2,
          deletions: 4,
          groups: ["unstaged", "staged"],
          groupStatuses: { staged: "modified", unstaged: "modified" },
          path: "src/a.ts",
        },
      ],
      kind: "ok",
    });
    expect(execGitRaw).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(execGitRaw).mock.calls.map(([args]) => args);
    expect(calls.every((args) => args.includes("--literal-pathspecs"))).toBe(
      true
    );
    expect(
      calls.every((args) => args.includes("--ignore-submodules=none"))
    ).toBe(true);
    expect(calls[0]).toContain("--porcelain=v2");
    expect(calls.slice(1).every((args) => args.includes("--numstat"))).toBe(
      true
    );
    expect(calls.slice(1).every((args) => args.includes("-l2000"))).toBe(true);
    expect(
      calls.slice(1).every((args) => args.includes("--find-copies=50%"))
    ).toBe(true);
    const options = vi
      .mocked(execGitRaw)
      .mock.calls.map(([, callOptions]) => callOptions);
    expect(options[0]).toMatchObject({
      maxRecords: GIT_REVIEW_INDEX_MAX_NUL_RECORDS,
      mode: "stream",
    });
    expect(
      options
        .slice(1)
        .every(
          (callOptions) =>
            callOptions.mode === "stream" &&
            callOptions.maxRecords === GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS
        )
    ).toBe(true);
  });

  it("可直接消费 scheduler 提供的共享执行预算", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [
            Buffer.from(
              `1 .M N... 100644 100644 100644 ${sha1} ${sha1} src/a.ts`
            ),
          ]
        : [Buffer.from("1\t0\tsrc/a.ts")],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });
    const scheduler = createGitReviewScheduler();
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: {
        canonicalRequestKey: "index:unstaged",
        contentRequirement: "full",
        operationKind: "index",
        repositoryKey: "/repo",
        sourceKey: "unstaged",
      },
      operationId: "index-composition",
      owner: {
        clientId: "renderer",
        generation: 1,
        windowRecordId: "window-1",
      },
      run: ({ budget, signal }) =>
        reader.read(
          {
            query: { groups: ["unstaged"], kind: "uncommitted" },
            scope,
          },
          { budget, signal }
        ),
    });

    await expect(lease.promise).resolves.toMatchObject({
      entries: [expect.objectContaining({ path: "src/a.ts" })],
      kind: "ok",
    });
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 0,
      pendingJobs: 0,
      runningJobs: 0,
    });
  });

  it("公开 indexToken 不重复混入由 resolved query 单独持有的 HEAD", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [
            Buffer.from(
              `1 .M N... 100644 100644 100644 ${sha1} ${sha1} src/a.ts`
            ),
          ]
        : [Buffer.from("1\t0\tsrc/a.ts")],
    }));
    const first = await new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(repositoryIdentity()),
    }).read({
      query: { groups: ["unstaged"], kind: "uncommitted" },
      scope,
    });
    const second = await new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver({
        ...repositoryIdentity(),
        headOid: sha1New,
      }),
    }).read({
      query: { groups: ["unstaged"], kind: "uncommitted" },
      scope,
    });

    expect(first).toMatchObject({
      kind: "ok",
      query: { headOid: sha1, kind: "uncommitted" },
    });
    expect(second).toMatchObject({
      kind: "ok",
      query: { headOid: sha1New, kind: "uncommitted" },
    });
    if (
      first.kind === "ok" &&
      first.query.kind === "uncommitted" &&
      second.kind === "ok" &&
      second.query.kind === "uncommitted"
    ) {
      expect(first.query.indexToken).toBe(second.query.indexToken);
      expect(first.revision).not.toBe(second.revision);
    }
  });

  it("严格跳过非 UTF-8 路径，且输出可见 warning", async () => {
    const prefix = Buffer.from(
      `1 .M N... 100644 100644 100644 ${sha1} ${sha1} `
    );
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [Buffer.concat([prefix, Buffer.from([0xc3, 0x28])])]
        : [],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [],
      kind: "ok",
      warnings: [{ code: "invalidPathEncoding", skipped: 1 }],
    });
  });

  it("文件预算只裁切最终条目，不将半条数据发布为成功", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [
            Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} a.ts`),
            Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} b.ts`),
          ]
        : [Buffer.from("1\t0\ta.ts"), Buffer.from("1\t0\tb.ts")],
    }));
    const budget = new GitReviewBudget({ maxFiles: 1 });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read(
      {
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      },
      { budget }
    );
    budget.dispose();

    expect(result).toMatchObject({
      entries: [{ path: "a.ts" }],
      kind: "ok",
      warnings: [{ code: "filesTruncated", limit: 1, omitted: null }],
    });
  });

  it("注入预算零剩余额度时返回 limit=0，不退化成 internal", async () => {
    const controller = new AbortController();
    const budget: GitReviewIndexExecutionBudget = {
      consumeOutputBytes: () => "ok",
      failureReason: () => null,
      remainingTimeMs: () => 1000,
      signal: controller.signal,
      tryConsumeFiles: () => false,
    };
    const reader = new GitReviewIndexReader({
      execGitRaw: createRecordExec((args) => ({
        records: args.includes("status")
          ? [Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} a.ts`)]
          : [Buffer.from("1\t0\ta.ts")],
      })),
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read(
        {
          query: { groups: ["unstaged"], kind: "uncommitted" },
          scope,
        },
        { budget }
      )
    ).resolves.toMatchObject({
      entries: [],
      kind: "ok",
      warnings: [{ code: "filesTruncated", limit: 0, omitted: null }],
    });
  });

  it("组装期间跨过 deadline 返回 timeout，不误报 filesTruncated", async () => {
    let now = 0;
    const inner = new GitReviewBudget({ deadlineAtMs: 1, now: () => now });
    const budget: GitReviewIndexExecutionBudget = {
      consumeOutputBytes: (delta) => inner.consumeOutputBytes(delta),
      failureReason: () => inner.failureReason(),
      remainingTimeMs: () => inner.remainingTimeMs(),
      signal: inner.signal,
      tryConsumeFiles: (delta) => {
        now = 1;
        return inner.tryConsumeFiles(delta);
      },
    };
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} a.ts`)]
        : [Buffer.from("1\t0\ta.ts")],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read(
      {
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      },
      { budget }
    );
    inner.dispose();

    expect(result).toMatchObject({
      kind: "error",
      reason: "timeout",
      retryable: true,
    });
  });

  it("最终结果校验期间跨过 deadline 仍返回 timeout", async () => {
    let now = 0;
    let readerClockCalls = 0;
    const budget = new GitReviewBudget({ deadlineAtMs: 1, now: () => now });
    const reader = new GitReviewIndexReader({
      execGitRaw: createRecordExec((args) => ({
        records: args.includes("status") ? [] : [],
      })),
      identityResolver: fakeIdentityResolver(),
      now: () => {
        readerClockCalls += 1;
        if (readerClockCalls === 2) {
          now = 1;
        }
        return 0;
      },
    });

    const result = await reader.read(
      {
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      },
      { budget }
    );
    budget.dispose();

    expect(result).toMatchObject({
      kind: "error",
      reason: "timeout",
      retryable: true,
    });
  });

  it("外部取消在返回成功前保留为 aborted", async () => {
    const controller = new AbortController();
    controller.abort("caller");
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status") ? [] : [],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read(
        {
          query: { groups: ["unstaged"], kind: "uncommitted" },
          scope,
        },
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({
      kind: "error",
      reason: "aborted",
      retryable: true,
    });
  });

  it("单 group 查询仍按 primary 全量逻辑项截断，空结果不伪装 clean", async () => {
    const statusRecords = Array.from({ length: 2001 }, (_, index) =>
      Buffer.from(
        `1 .M N... 100644 100644 100644 ${sha1} ${sha1} unstaged-${index}.ts`
      )
    );
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status") ? statusRecords : [],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["staged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [],
      kind: "ok",
      warnings: [{ code: "filesTruncated", limit: 2000, omitted: null }],
    });
    expect(execGitRaw).toHaveBeenCalledTimes(2);
  });

  it("2,000/2,001 条非相邻 rename 链按最终文件口径截断", async () => {
    for (const [count, truncated] of [
      [2000, false],
      [2001, true],
    ] as const) {
      const fixture = createRenameChainRecords(count);
      const execGitRaw = createRecordExec((args) => {
        if (args.includes("status")) {
          return { records: fixture.status };
        }
        return {
          records: args.includes("--cached")
            ? fixture.stagedStats
            : fixture.unstagedStats,
        };
      });
      const result = await new GitReviewIndexReader({
        execGitRaw,
        identityResolver: fakeIdentityResolver(),
      }).read({
        query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
        scope,
      });

      expect(result).toMatchObject({ entries: { length: 2000 }, kind: "ok" });
      if (result.kind === "ok") {
        expect(
          result.warnings.some((warning) => warning.code === "filesTruncated")
        ).toBe(truncated);
      }
    }
  }, 15_000);

  it("不为 binary/submodule/untracked 伪造统计，仅对应有统计的错配报警", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `1 .M N... 100644 100644 100644 ${sha1} ${sha1} missing.ts`
            ),
            Buffer.from(
              `1 .M S.M. 160000 160000 160000 ${sha1} ${sha1} submodule`
            ),
            Buffer.from("? untracked.ts"),
          ],
        };
      }
      return { records: [Buffer.from("-\t-\tmissing.ts")] };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read({
      query: { groups: ["unstaged"], kind: "uncommitted" },
      scope,
    });

    expect(result).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ additions: null, path: "missing.ts" }),
        expect.objectContaining({ additions: null, path: "submodule" }),
        expect.objectContaining({ additions: null, path: "untracked.ts" }),
      ]),
      kind: "ok",
      warnings: [],
    });
  });

  it("缺失或 rename oldPath 错配的 numstat 不会附到其他条目", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `2 .R N... 100644 100644 100644 ${sha1} ${sha1} R100 target.ts`
            ),
            Buffer.from("source.ts"),
          ],
        };
      }
      return {
        records: [
          Buffer.from("1\t1\t"),
          Buffer.from("different-source.ts"),
          Buffer.from("target.ts"),
        ],
      };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ additions: null, path: "target.ts" }),
      ],
      kind: "ok",
      warnings: [{ code: "entryStatsUnavailable", count: 1 }],
    });
  });

  it("一对一 staged→unstaged rename 链合并为最终路径并按 group targetPath 取统计", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R100 b.ts`
            ),
            Buffer.from("a.ts"),
            Buffer.from(
              `2 .R N... 100644 100644 100644 ${sha1New} ${sha1New} R100 c.ts`
            ),
            Buffer.from("b.ts"),
          ],
        };
      }
      return {
        records: args.includes("--cached")
          ? [Buffer.from("1\t0\t"), Buffer.from("a.ts"), Buffer.from("b.ts")]
          : [Buffer.from("2\t1\t"), Buffer.from("b.ts"), Buffer.from("c.ts")],
      };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          additions: 3,
          deletions: 1,
          groups: ["unstaged", "staged"],
          oldPaths: ["b.ts", "a.ts"],
          path: "c.ts",
        }),
      ],
      kind: "ok",
      warnings: [],
    });
    await expect(
      reader.read({
        query: { groups: ["staged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          groups: ["staged"],
          oldPaths: ["a.ts"],
          path: "b.ts",
        }),
      ],
      kind: "ok",
    });
    await expect(
      reader.read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          groups: ["unstaged"],
          oldPaths: ["b.ts"],
          path: "c.ts",
        }),
      ],
      kind: "ok",
    });
  });

  it("unstaged copy 保留源条目，不被误合并为 rename 链", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R100 b.ts`
            ),
            Buffer.from("a.ts"),
            Buffer.from(
              `2 .C N... 100644 100644 100644 ${sha1New} ${sha1New} C100 c.ts`
            ),
            Buffer.from("b.ts"),
          ],
        };
      }
      return {
        records: args.includes("--cached")
          ? [Buffer.from("1\t0\t"), Buffer.from("a.ts"), Buffer.from("b.ts")]
          : [Buffer.from("1\t0\t"), Buffer.from("b.ts"), Buffer.from("c.ts")],
      };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ groups: ["staged"], path: "b.ts" }),
        expect.objectContaining({ groups: ["unstaged"], path: "c.ts" }),
      ],
      kind: "ok",
    });
  });

  it("deleted 与 conflict 在索引层保留唯一且有序的 group", async () => {
    const execGitRaw = createRecordExec((args) => {
      if (args.includes("status")) {
        return {
          records: [
            Buffer.from(
              `1 .D N... 100644 100644 000000 ${sha1} ${sha1} worktree-deleted.ts`
            ),
            Buffer.from(
              `1 D. N... 100644 000000 000000 ${sha1} ${zeroSha1} staged-deleted.ts`
            ),
            Buffer.from(
              `u UU N... 100644 100644 100644 100644 ${sha1} ${sha1New} ${zeroSha1} conflict.ts`
            ),
          ],
        };
      }
      return {
        records: args.includes("--cached")
          ? [Buffer.from("0\t1\tstaged-deleted.ts")]
          : [Buffer.from("0\t1\tworktree-deleted.ts")],
      };
    });
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read({
      query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
      scope,
    });

    expect(result).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          groups: ["conflict"],
          path: "conflict.ts",
          status: "conflicted",
        }),
        expect.objectContaining({
          groups: ["staged"],
          path: "staged-deleted.ts",
          status: "deleted",
        }),
        expect.objectContaining({
          groups: ["unstaged"],
          path: "worktree-deleted.ts",
          status: "deleted",
        }),
      ]),
      kind: "ok",
    });
  });

  it("conflict 的重复 numstat 辅助记录在主事实过滤后不会误报重复路径", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status")
        ? [
            Buffer.from(
              `u UU N... 100644 100644 100644 100644 ${sha1} ${sha1New} ${zeroSha1} conflict.ts`
            ),
          ]
        : [Buffer.from("1\t1\tconflict.ts"), Buffer.from("2\t2\tconflict.ts")],
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          additions: null,
          deletions: null,
          groups: ["conflict"],
          path: "conflict.ts",
        }),
      ],
      kind: "ok",
      warnings: [],
    });
  });

  it("只对 C-locale 官方 rename-limit advisory 生成 typed warning", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("status") ? [] : [],
      stderr: args.includes("status")
        ? "warning: exhaustive rename detection was skipped due to too many files.\n"
        : "unrelated diagnostic\n",
    }));
    const reader = new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver(),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      kind: "ok",
      warnings: [{ code: "renameDetectionLimited", limit: 2000 }],
    });
  });

  it("真实仓库保留特殊路径、rename 旧路径和双 group 统计", async () => {
    const root = await createRepository();
    await writeFile(join(root, "tracked.ts"), "base\n", "utf8");
    await writeFile(join(root, "rename-old.ts"), "rename\n", "utf8");
    await commitAll(root, "base");
    await writeFile(join(root, "tracked.ts"), "staged\n", "utf8");
    await execGit(["add", "--", "tracked.ts"], { cwd: root });
    await writeFile(join(root, "tracked.ts"), "staged\nworktree\n", "utf8");
    const renamedPath = ":(glob)-renamed\tfile\n.ts";
    await rename(join(root, "rename-old.ts"), join(root, renamedPath));
    await execGit(
      ["--literal-pathspecs", "add", "-A", "--", "rename-old.ts", renamedPath],
      { cwd: root }
    );
    await writeFile(join(root, "-untracked.ts"), "new\n", "utf8");
    const reader = new GitReviewIndexReader();

    const result = await reader.read({
      query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
      scope: { contextId: "worktree:real", gitRootPath: root },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          additions: null,
          groups: ["unstaged"],
          path: "-untracked.ts",
          status: "added",
        }),
        expect.objectContaining({
          groups: ["staged"],
          oldPaths: ["rename-old.ts"],
          path: renamedPath,
          status: "renamed",
        }),
        expect.objectContaining({
          additions: 2,
          deletions: 1,
          groups: ["unstaged", "staged"],
          path: "tracked.ts",
        }),
      ])
    );
  });

  it("真实 staged a→b 与 unstaged b→c rename 链只发布最终路径", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["mv", "a.ts", "b.ts"], { cwd: root });
    await rename(join(root, "b.ts"), join(root, "c.ts"));
    await execGit(["add", "-N", "--", "c.ts"], { cwd: root });

    const resolution = await new GitReviewIndexReader().resolve({
      query: { groups: ["unstaged", "staged"], kind: "uncommitted" },
      scope: { contextId: "worktree:rename-chain", gitRootPath: root },
    });

    expect(resolution).toMatchObject({
      kind: "ok",
      resolvedEntries: [
        {
          groupFacts: {
            staged: { oldPath: "a.ts", targetPath: "b.ts" },
            unstaged: { oldPath: "b.ts", targetPath: "c.ts" },
          },
          path: "c.ts",
        },
      ],
      result: {
        entries: [
          expect.objectContaining({
            groups: ["unstaged", "staged"],
            oldPaths: ["b.ts", "a.ts"],
            path: "c.ts",
          }),
        ],
        kind: "ok",
        warnings: [],
      },
    });
  });

  it("显式覆盖仓库 ignore 配置，dirty submodule 仍进入 canonical index", async () => {
    const child = await createRepository();
    await writeFile(join(child, "child.ts"), "base\n", "utf8");
    await commitAll(child, "child base");
    const root = await createRepository();
    await execGit(
      ["-c", "protocol.file.allow=always", "submodule", "add", child, "sub"],
      { cwd: root }
    );
    await commitAll(root, "add submodule");
    await writeFile(join(root, "sub", "child.ts"), "dirty\n", "utf8");
    await execGit(["config", "diff.ignoreSubmodules", "all"], { cwd: root });
    await execGit(["config", "submodule.sub.ignore", "all"], { cwd: root });

    const result = await new GitReviewIndexReader().read({
      query: { groups: ["unstaged"], kind: "uncommitted" },
      scope: { contextId: "worktree:submodule", gitRootPath: root },
    });

    expect(result).toMatchObject({
      entries: [
        expect.objectContaining({
          additions: null,
          deletions: null,
          groups: ["unstaged"],
          path: "sub",
        }),
      ],
      kind: "ok",
    });
  });

  it("SHA-256 unborn 仓库可读取 staged index", async (ctx) => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-index-sha256-"));
    roots.push(root);
    try {
      await execGit(["init", "--object-format=sha256"], { cwd: root });
    } catch {
      ctx.skip();
      return;
    }
    await writeFile(join(root, "staged.ts"), "new\n", "utf8");
    await execGit(["add", "--", "staged.ts"], { cwd: root });

    const result = await new GitReviewIndexReader().read({
      query: { groups: ["staged"], kind: "uncommitted" },
      scope: { contextId: "worktree:sha256", gitRootPath: root },
    });

    expect(result).toMatchObject({
      entries: [expect.objectContaining({ path: "staged.ts" })],
      kind: "ok",
      query: { headOid: null, kind: "uncommitted" },
    });
  });

  it("commit/branch 索引各自固定为两条机器协议命令和解析后的 OID 范围", async () => {
    const execGitRaw = createRecordExec((args) => ({
      records: args.includes("--raw")
        ? [
            Buffer.from(`:100644 100644 ${sha1} ${sha1New} M`),
            Buffer.from("file.ts"),
          ]
        : [Buffer.from("1\t1\tfile.ts")],
    }));
    const identityResolver = fakeIdentityResolver();
    const reader = new GitReviewIndexReader({ execGitRaw, identityResolver });

    await expect(
      reader.read({ query: { kind: "commit", oid: "HEAD" }, scope })
    ).resolves.toMatchObject({ kind: "ok" });
    await expect(
      reader.read({
        query: { kind: "branch", targetRef: "refs/heads/main" },
        scope,
      })
    ).resolves.toMatchObject({ kind: "ok" });

    expect(execGitRaw).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(execGitRaw).mock.calls.map(([args]) => args);
    expect(
      calls.every((args) => args.includes("--ignore-submodules=none"))
    ).toBe(true);
    const machineArgs = [
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--ignore-submodules=none",
      "--find-renames=50%",
      "--find-copies=50%",
      "-l2000",
    ];
    expect(calls[0]).toEqual([
      "--literal-pathspecs",
      "diff",
      ...machineArgs,
      "--no-abbrev",
      "--raw",
      "-z",
      "2".repeat(40),
      "3".repeat(40),
      "--",
    ]);
    expect(calls[1]).toEqual([
      "--literal-pathspecs",
      "diff",
      ...machineArgs,
      "--numstat",
      "-z",
      "2".repeat(40),
      "3".repeat(40),
      "--",
    ]);
    expect(calls[2]).toEqual([
      "--literal-pathspecs",
      "diff",
      ...machineArgs,
      "--no-abbrev",
      "--raw",
      "-z",
      "2".repeat(40),
      sha1,
      "--",
    ]);
    expect(calls[3]).toEqual([
      "--literal-pathspecs",
      "diff",
      ...machineArgs,
      "--numstat",
      "-z",
      "2".repeat(40),
      sha1,
      "--",
    ]);
    expect(
      vi
        .mocked(execGitRaw)
        .mock.calls.every(
          ([, options]) =>
            options.mode === "stream" &&
            options.maxRecords === GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS
        )
    ).toBe(true);
  });

  it("不存在的 commit 在 index 边界映射为不可重试 invalidSource", async () => {
    const root = await createRepository();

    await expect(
      new GitReviewIndexReader().read({
        query: { kind: "commit", oid: "HEAD" },
        scope: { contextId: "worktree:unborn", gitRootPath: root },
      })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "invalidSource",
      retryable: false,
    });
  });

  it("非 Git scope 返回不可重试 notRepository", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-review-index-not-repo-"));
    roots.push(root);

    await expect(
      new GitReviewIndexReader().read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope: { contextId: "worktree:not-repo", gitRootPath: root },
      })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "notRepository",
      retryable: false,
    });
  });

  it("技术诊断按 4 KiB UTF-8 字节边界截断", () => {
    const failure = toGitReviewIndexFailure(new Error("界".repeat(2000)));

    expect(failure.message).not.toBeNull();
    expect(
      Buffer.byteLength(failure.message ?? "", "utf8")
    ).toBeLessThanOrEqual(4096);
    expect(failure.message).not.toContain("�");
  });

  it("只把请求边界校验失败归因为 invalidSource", async () => {
    const reader = new GitReviewIndexReader({
      execGitRaw: createRecordExec(() => ({ records: [] })),
      identityResolver: fakeIdentityResolver(),
    });
    const invalidQuery = {
      kind: "commit",
      oid: "-not-a-safe-revision",
    } as unknown as GitReviewQuery;

    await expect(
      reader.read({ query: invalidQuery, scope })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "invalidSource",
      retryable: false,
    });
  });

  it("内部结果契约回归归因为 internal，不伪装成用户输入错误", async () => {
    const reader = new GitReviewIndexReader({
      execGitRaw: createRecordExec((args) => ({
        records: args.includes("status") ? [] : [],
      })),
      identityResolver: fakeIdentityResolver({
        ...repositoryIdentity(),
        canonicalRoot: "relative-internal-root",
      }),
    });

    await expect(
      reader.read({
        query: { groups: ["unstaged"], kind: "uncommitted" },
        scope,
      })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "internal",
      retryable: false,
    });
  });

  it("真实 root commit 和 branch 均使用唯一语义 group", async () => {
    const root = await createRepository();
    await writeFile(join(root, "root.ts"), "root\n", "utf8");
    const base = await commitAll(root, "root");
    await execGit(["branch", "review-base", base], { cwd: root });
    await writeFile(join(root, "root.ts"), "head\n", "utf8");
    await writeFile(join(root, "head.ts"), "head\n", "utf8");
    await commitAll(root, "head");
    const reader = new GitReviewIndexReader();
    const commonScope = { contextId: "worktree:real", gitRootPath: root };

    const rootCommit = await reader.read({
      query: { kind: "commit", oid: base },
      scope: commonScope,
    });
    const branch = await reader.read({
      query: { kind: "branch", targetRef: "refs/heads/review-base" },
      scope: commonScope,
    });

    expect(rootCommit).toMatchObject({
      entries: [expect.objectContaining({ groups: ["commit"] })],
      kind: "ok",
      query: { baseOid: null, kind: "commit", root: true },
    });
    expect(branch).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ groups: ["branch"], path: "head.ts" }),
      ]),
      kind: "ok",
      query: {
        headOid: expect.any(String),
        kind: "branch",
        mergeBaseOid: base,
      },
    });
  });
});
