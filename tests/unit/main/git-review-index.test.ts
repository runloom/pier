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
import { GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS } from "@main/services/git-review/git-review-index-contract.ts";
import { toGitReviewIndexFailure } from "@main/services/git-review/git-review-index-execution.ts";
import { createGitReviewScheduler } from "@main/services/git-review/git-review-scheduler.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestGitReviewIndexReader as GitReviewIndexReader } from "./git-review-test-fixtures.ts";

const roots: string[] = [];
const sha1 = "1".repeat(40);
const sha1New = "2".repeat(40);
const zeroSha1 = "0".repeat(40);
const scope = {
  contextId: "worktree:test",
  gitRootPath: "/repo",
  target: { kind: "uncommitted" },
} as const;

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
    headOid: sha1,
    objectFormat: "sha1",
    oidLength: 40,
  };
}

function fakeIdentityResolver(identity = repositoryIdentity()) {
  return {
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

function createPathRecordsExec(paths: readonly string[]): ExecGitRaw {
  return createRecordExec((args) => ({
    records: args.includes("status")
      ? paths.map((path) => Buffer.from(`? ${path}`))
      : paths.map((path) => Buffer.from(`1\t0\t${path}`)),
  }));
}

function countTreeNodes(paths: readonly string[]): number {
  const directories = new Set<string>();
  for (const path of paths) {
    let cursor = 0;
    while (true) {
      const slash = path.indexOf("/", cursor);
      if (slash < 0) {
        break;
      }
      directories.add(path.slice(0, slash));
      cursor = slash + 1;
    }
  }
  return paths.length + directories.size;
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
      scope,
    });

    expect(result).toMatchObject({
      entries: [{ path: "src/a.ts" }],
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
    expect(calls[0]).toContain("status.renameLimit=0");
    expect(calls.slice(1).every((args) => args.includes("--numstat"))).toBe(
      true
    );
    expect(calls.slice(1).every((args) => args.includes("-l0"))).toBe(true);
    expect(
      calls.slice(1).every((args) => args.includes("--find-copies=50%"))
    ).toBe(true);
    const options = vi
      .mocked(execGitRaw)
      .mock.calls.map(([, callOptions]) => callOptions);
    expect(options[0]).toMatchObject({
      maxRecords: null,
      mode: "stream",
    });
    expect(
      options
        .slice(1)
        .every(
          (callOptions) =>
            callOptions.mode === "stream" && callOptions.maxRecords === null
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
      key: {
        canonicalRequestKey: "index:unstaged",
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
            scope,
          },
          { budget, signal }
        ),
    });

    await expect(lease.promise).resolves.toMatchObject({
      entries: [expect.objectContaining({ path: "src/a.ts" })],
      kind: "ok",
    });
  });

  it("HEAD 与 index fence 只保留在 main 私有解析结果", async () => {
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
    }).resolve({
      scope,
    });
    const second = await new GitReviewIndexReader({
      execGitRaw,
      identityResolver: fakeIdentityResolver({
        ...repositoryIdentity(),
        headOid: sha1New,
      }),
    }).resolve({
      scope,
    });

    if (first.kind === "ok" && second.kind === "ok") {
      expect(first.metadata.headOid).toBe(sha1);
      expect(second.metadata.headOid).toBe(sha1New);
      expect(first.metadata.indexRevision).not.toBe(
        second.metadata.indexRevision
      );
      expect(first.result).not.toHaveProperty("query");
      expect(first.result).not.toHaveProperty("revision");
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
        scope,
      })
    ).resolves.toMatchObject({
      entries: [],
      kind: "ok",
      warnings: [{ code: "invalidPathEncoding", skipped: 1 }],
    });
  });

  it("超过旧树节点上限时仍接纳全部合法路径", async () => {
    const deepPaths = Array.from({ length: 78 }, (_, index) =>
      [
        `a${index.toString().padStart(3, "0")}`,
        ...Array.from(
          { length: GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS - 2 },
          () => "d"
        ),
        "file.ts",
      ].join("/")
    );
    const shallowPaths = Array.from(
      { length: 17 },
      (_, index) => `z${index.toString().padStart(2, "0")}.ts`
    );
    const reader = new GitReviewIndexReader({
      execGitRaw: createPathRecordsExec([...deepPaths, ...shallowPaths]),
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read({ scope });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(
      countTreeNodes(result.entries.map((entry) => entry.path))
    ).toBeGreaterThan(10_000);
    expect(result.entries).toHaveLength(95);
    expect(result.warnings).toEqual([]);
  });

  it("只拒绝超过单路径深度边界的条目，不限制其它文件数量", async () => {
    const deepPaths = Array.from({ length: 100 }, (_, index) =>
      [
        `a${index.toString().padStart(4, "0")}`,
        ...Array.from(
          {
            length: GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS - (index === 0 ? 1 : 2),
          },
          () => "d".repeat(30)
        ),
        "file.ts",
      ].join("/")
    );
    const literalBackslashPath = "z-dir\\..\\file.ts";
    const reader = new GitReviewIndexReader({
      execGitRaw: createPathRecordsExec([...deepPaths, literalBackslashPath]),
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read({ scope });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.entries.map((entry) => entry.path)).toContain(
      literalBackslashPath
    );
    expect(result.entries).not.toContainEqual(
      expect.objectContaining({ path: deepPaths[0] })
    );
    expect(result.entries).toHaveLength(100);
    expect(
      countTreeNodes(result.entries.map((entry) => entry.path))
    ).toBeGreaterThan(10_000);
    expect(result.warnings).toContainEqual({
      code: "pathDepthExceeded",
      skipped: 1,
    });
  });

  it("最终结果校验期间跨过 deadline 仍返回 timeout", async () => {
    let now = 0;
    let commandCount = 0;
    const budget = new GitReviewBudget({ deadlineAtMs: 1, now: () => now });
    const reader = new GitReviewIndexReader({
      execGitRaw: createRecordExec(() => {
        commandCount += 1;
        if (commandCount === 2) {
          now = 1;
        }
        return { records: [] };
      }),
      identityResolver: fakeIdentityResolver(),
    });

    const result = await reader.read(
      {
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

  it("primary 超过 2,000 条时仍返回全部轻量索引", async () => {
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

    const result = await reader.read({ scope });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.entries).toHaveLength(2001);
    expect(result.warnings).toEqual([]);
    expect(execGitRaw).toHaveBeenCalledTimes(3);
  });

  it("2,000/2,001 条非相邻 rename 链均按最终文件口径完整返回", async () => {
    for (const count of [2000, 2001] as const) {
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
        scope,
      });

      expect(result).toMatchObject({ entries: { length: count }, kind: "ok" });
      if (result.kind === "ok") {
        expect(result.warnings).toEqual([]);
      }
    }
  }, 15_000);

  it("binary/submodule/untracked 保持 canonical 条目且不制造额外警告", async () => {
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
      scope,
    });

    expect(result).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ path: "missing.ts" }),
        expect.objectContaining({ path: "submodule" }),
        expect.objectContaining({ path: "untracked.ts" }),
      ]),
      kind: "ok",
      warnings: [],
    });
  });

  it("rename oldPath 错配的 numstat 不改变 canonical 条目", async () => {
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
        scope,
      })
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ path: "target.ts" })],
      kind: "ok",
      warnings: [],
    });
  });

  it("一对一 staged→unstaged rename 链合并为最终路径", async () => {
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
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          oldPaths: ["b.ts", "a.ts"],
          path: "c.ts",
        }),
      ],
      kind: "ok",
      warnings: [],
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
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ path: "b.ts" }),
        expect.objectContaining({ path: "c.ts" }),
      ],
      kind: "ok",
    });
  });

  it("deleted 与 conflict 在固定双组索引中保留正确聚合状态", async () => {
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
      scope,
    });

    expect(result).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: "conflict.ts",
          status: "conflicted",
        }),
        expect.objectContaining({
          path: "staged-deleted.ts",
          status: "deleted",
        }),
        expect.objectContaining({
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
        scope,
      })
    ).resolves.toMatchObject({
      entries: [
        expect.objectContaining({
          path: "conflict.ts",
        }),
      ],
      kind: "ok",
      warnings: [],
    });
  });

  it("不把 rename-limit advisory 暴露成产品数量提示", async () => {
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
        scope,
      })
    ).resolves.toMatchObject({
      kind: "ok",
      warnings: [],
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
      scope: {
        contextId: "worktree:real",
        gitRootPath: root,
        target: { kind: "uncommitted" },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "-untracked.ts",
          status: "added",
        }),
        expect.objectContaining({
          oldPaths: ["rename-old.ts"],
          path: renamedPath,
          status: "renamed",
        }),
        expect.objectContaining({
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
      scope: {
        contextId: "worktree:rename-chain",
        gitRootPath: root,
        target: { kind: "uncommitted" },
      },
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
      scope: {
        contextId: "worktree:submodule",
        gitRootPath: root,
        target: { kind: "uncommitted" },
      },
    });

    expect(result).toMatchObject({
      entries: [
        expect.objectContaining({
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
      scope: {
        contextId: "worktree:sha256",
        gitRootPath: root,
        target: { kind: "uncommitted" },
      },
    });

    expect(result).toMatchObject({
      entries: [expect.objectContaining({ path: "staged.ts" })],
      kind: "ok",
    });
  });

  it("commit 目标返回该提交相对首父的 committed 分组(根提交相对空树)", async () => {
    const root = await createRepository();
    await writeFile(join(root, "base.ts"), "base\n", "utf8");
    const rootCommit = await commitAll(root, "base");
    await writeFile(join(root, "base.ts"), "changed\n", "utf8");
    await writeFile(join(root, "added.ts"), "new\n", "utf8");
    const secondCommit = await commitAll(root, "second");
    // 工作区脏文件不得进入 commit 目标的 index
    await writeFile(join(root, "dirty.ts"), "dirty\n", "utf8");
    const reader = new GitReviewIndexReader();

    const second = await reader.read({
      scope: {
        contextId: "worktree:commit-target",
        gitRootPath: root,
        target: { kind: "commit", oid: secondCommit },
      },
    });
    expect(second).toMatchObject({
      entries: [
        expect.objectContaining({
          path: "added.ts",
          renderSlots: [expect.objectContaining({ group: "committed" })],
          status: "added",
        }),
        expect.objectContaining({ path: "base.ts", status: "modified" }),
      ],
      kind: "ok",
      warnings: [],
    });

    const first = await reader.read({
      scope: {
        contextId: "worktree:commit-target",
        gitRootPath: root,
        target: { kind: "commit", oid: rootCommit },
      },
    });
    expect(first).toMatchObject({
      entries: [expect.objectContaining({ path: "base.ts", status: "added" })],
      kind: "ok",
    });
  });

  it("branch 目标返回 merge-base..HEAD 的 committed 分组", async () => {
    const root = await createRepository();
    await writeFile(join(root, "shared.ts"), "base\n", "utf8");
    await commitAll(root, "base");
    await execGit(["branch", "main-line"], { cwd: root });
    await execGit(["switch", "-c", "feature"], { cwd: root });
    await writeFile(join(root, "feature.ts"), "feature\n", "utf8");
    await commitAll(root, "feature work");
    // 目标分支自身的推进不应出现在对比结果里(三方点语义)
    await execGit(["switch", "main-line"], { cwd: root });
    await writeFile(join(root, "main-only.ts"), "main\n", "utf8");
    await commitAll(root, "main only");
    await execGit(["switch", "feature"], { cwd: root });

    const result = await new GitReviewIndexReader().read({
      scope: {
        contextId: "worktree:branch-target",
        gitRootPath: root,
        target: { kind: "branch", ref: "main-line" },
      },
    });

    expect(result).toMatchObject({
      entries: [
        expect.objectContaining({
          path: "feature.ts",
          renderSlots: [expect.objectContaining({ group: "committed" })],
          status: "added",
        }),
      ],
      kind: "ok",
      warnings: [],
    });
  });

  it("commit 目标 revision 不存在时返回不可重试 invalidSource", async () => {
    const root = await createRepository();
    await writeFile(join(root, "base.ts"), "base\n", "utf8");
    await commitAll(root, "base");

    await expect(
      new GitReviewIndexReader().read({
        scope: {
          contextId: "worktree:missing-commit",
          gitRootPath: root,
          target: { kind: "commit", oid: "f".repeat(40) },
        },
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
        scope: {
          contextId: "worktree:not-repo",
          gitRootPath: root,
          target: { kind: "uncommitted" },
        },
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
        scope,
      })
    ).resolves.toMatchObject({
      kind: "error",
      reason: "internal",
      retryable: false,
    });
  });
});
