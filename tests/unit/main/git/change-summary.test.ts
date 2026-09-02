import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGitChangeSummary,
  closeGitChangeSummaryFileHandle,
  GIT_WORKING_TREE_NUMSTAT_ARGS,
  gitChangeSummaryStatToken,
  numstatPaths,
  numstatWithinStatus,
  readGitUntrackedPathStats,
} from "@main/services/git/change-summary.ts";
import { GitExecError } from "@main/services/git/exec.ts";
import { GitSafePathOpenError } from "@main/services/git/safe-path-open.ts";
import type { GitFileStatus } from "@shared/contracts/git.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const tracked: GitFileStatus = {
  index: "M",
  origPath: null,
  path: "src/tracked.ts",
  worktree: "M",
};
const untracked: GitFileStatus = {
  index: "?",
  origPath: null,
  path: "notes.txt",
  worktree: "?",
};

describe("buildGitChangeSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inherits an already-aborted caller signal instead of waiting for its own deadline", async () => {
    const controller = new AbortController();
    controller.abort("caller");
    const pending = readGitUntrackedPathStats({
      cwd: "/repo",
      paths: ["notes.txt"],
      readUntrackedFile: async () => new Promise<Buffer>(() => undefined),
      signal: controller.signal,
    });

    const result = await Promise.race([
      pending,
      new Promise<"still-pending">((resolve) => {
        setTimeout(() => resolve("still-pending"), 50);
      }),
    ]);

    expect(result).toEqual({
      excludedFiles: 0,
      insertions: 0,
      omittedFiles: 1,
      reasons: ["timeout"],
    });
  });

  it("maps openGitPathNoSymlinks abort to timeout rather than unsafePath", async () => {
    const openModule = await import("@main/services/git/safe-path-open.ts");
    vi.spyOn(openModule, "openGitPathNoSymlinks").mockRejectedValue(
      new GitSafePathOpenError("aborted", "Git 文件读取已取消")
    );
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-abort-"));
    try {
      await writeFile(join(root, "notes.txt"), "line\n", "utf8");
      await expect(
        readGitUntrackedPathStats({
          cwd: root,
          paths: ["notes.txt"],
        })
      ).resolves.toEqual({
        excludedFiles: 0,
        insertions: 0,
        omittedFiles: 1,
        reasons: ["timeout"],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("forwards detached open operations to the request budget tracker", async () => {
    const trackDetachedOperation = vi.fn();
    const detached = Promise.resolve();
    const openModule = await import("@main/services/git/safe-path-open.ts");
    vi.spyOn(openModule, "openGitPathNoSymlinks").mockImplementation(
      async (options) => {
        options.onDetachedOperation?.(detached);
        throw new GitSafePathOpenError("aborted", "Git 文件读取已取消");
      }
    );
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-detach-"));
    try {
      await writeFile(join(root, "notes.txt"), "line\n", "utf8");
      await expect(
        readGitUntrackedPathStats({
          budget: {
            failureReason: () => null,
            remainingTimeMs: () => 5000,
            signal: new AbortController().signal,
            trackDetachedOperation,
          } as never,
          cwd: root,
          paths: ["notes.txt"],
        })
      ).resolves.toMatchObject({
        omittedFiles: 1,
        reasons: ["timeout"],
      });
      expect(trackDetachedOperation).toHaveBeenCalledWith(detached);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("caps its deadline to the request budget's remaining time", async () => {
    const budget = {
      failureReason: () => null,
      remainingTimeMs: () => 0,
      signal: new AbortController().signal,
    } as never;
    const pending = readGitUntrackedPathStats({
      budget,
      cwd: "/repo",
      paths: ["notes.txt"],
      readUntrackedFile: async () => new Promise<Buffer>(() => undefined),
    });

    const result = await Promise.race([
      pending,
      new Promise<"still-pending">((resolve) => {
        setTimeout(() => resolve("still-pending"), 50);
      }),
    ]);

    expect(result).toEqual({
      excludedFiles: 0,
      insertions: 0,
      omittedFiles: 1,
      reasons: ["timeout"],
    });
  });

  it("does not await close after the shared deadline aborts and consumes a late close rejection", async () => {
    const controller = new AbortController();
    let rejectClose: (error: Error) => void = () => undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectClose = reject;
        })
    );
    controller.abort("timeout");

    await expect(
      closeGitChangeSummaryFileHandle({ close }, controller.signal)
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    rejectClose(new Error("late close failure"));
    await Promise.resolve();
  });

  it("stops awaiting an already-started close when the deadline aborts later", async () => {
    const controller = new AbortController();
    let rejectClose: (error: Error) => void = () => undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectClose = reject;
        })
    );
    let settled = false;
    const completion = closeGitChangeSummaryFileHandle(
      { close },
      controller.signal
    ).then(() => {
      settled = true;
    });

    controller.abort("timeout");
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);

    rejectClose(new Error("late close failure"));
    await completion;
  });

  it("includes ctime and mode in a stable file identity token", () => {
    const base = {
      ctimeNs: 10n,
      dev: 1n,
      ino: 2n,
      mode: 0o10_0644n,
      mtimeNs: 20n,
      size: 3n,
    };
    expect(gitChangeSummaryStatToken(base)).not.toBe(
      gitChangeSummaryStatToken({ ...base, ctimeNs: 11n })
    );
    expect(gitChangeSummaryStatToken(base)).not.toBe(
      gitChangeSummaryStatToken({ ...base, mode: 0o10_0755n })
    );
  });

  it("uses one deterministic HEAD-to-working-tree numstat and includes UTF-8 untracked lines", async () => {
    const commands: Array<readonly string[]> = [];
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async (args) => {
        commands.push(args);
        return "3\t2\tsrc/tracked.ts\0";
      },
      files: [tracked, untracked],
      readUntrackedFile: async (path) => {
        expect(path).toBe("notes.txt");
        return Buffer.from("first\nsecond\n", "utf8");
      },
    });

    expect(commands).toEqual([[...GIT_WORKING_TREE_NUMSTAT_ARGS, "HEAD"]]);
    expect(summary).toEqual({
      changedFiles: 2,
      deletions: 2,
      excludedFiles: 0,
      insertions: 5,
      kind: "lineDelta",
    });
  });

  it("classifies a production Git execution deadline by causeKind", async () => {
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async (args) => {
        throw new GitExecError({
          args,
          causeKind: "timeout",
          cwd: "/repo",
          exitCode: null,
          message: "git 执行期限已到",
          stderr: "",
          stdout: "",
        });
      },
      files: [tracked],
    });

    expect(summary).toEqual({
      changedFiles: 1,
      kind: "filesOnly",
      omittedFiles: 1,
      reasons: ["timeout"],
    });
  });

  it("counts an untracked binary file as excluded without inventing line counts", async () => {
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async () => "3\t2\tsrc/tracked.ts\0",
      files: [tracked, untracked],
      readUntrackedFile: async () => Buffer.from([0x61, 0, 0x62]),
    });

    expect(summary).toEqual({
      changedFiles: 2,
      deletions: 2,
      excludedFiles: 1,
      insertions: 3,
      kind: "lineDelta",
    });
  });

  it("keeps tracked +/- when an untracked file is not valid UTF-8", async () => {
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async () => "3\t2\tsrc/tracked.ts\0",
      files: [tracked, untracked],
      readUntrackedFile: async () => Buffer.from([0xc3, 0x28]),
    });

    expect(summary).toEqual({
      changedFiles: 2,
      deletions: 2,
      excludedFiles: 1,
      insertions: 3,
      kind: "lineDelta",
    });
  });

  it("maps a test seam read rejection to excluded without dropping the range", async () => {
    await expect(
      buildGitChangeSummary({
        cwd: "/repo",
        execGit: async () => "",
        files: [untracked],
        readUntrackedFile: async () => {
          throw new Error("read failed");
        },
      })
    ).resolves.toEqual({
      changedFiles: 1,
      deletions: 0,
      excludedFiles: 1,
      insertions: 0,
      kind: "lineDelta",
    });
  });

  it("reserves aggregate bytes before starting an over-budget seam body read", async () => {
    const paths = ["one.txt", "two.txt", "three.txt"];
    const reads: string[] = [];
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async () => "",
      files: paths.map((path) => ({ ...untracked, path })),
      inspectUntrackedFile: async () => 8 * 1024 * 1024,
      readUntrackedFile: async (path) => {
        reads.push(path);
        return Buffer.alloc(8 * 1024 * 1024, 0x61);
      },
    });

    expect(reads).toHaveLength(2);
    expect(reads).not.toContain("three.txt");
    expect(summary).toEqual({
      changedFiles: 3,
      deletions: 0,
      excludedFiles: 1,
      insertions: 2,
      kind: "lineDelta",
    });
  });

  it("counts binary tracked files as excluded without invalidating complete text totals", async () => {
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async () => "3\t2\tsrc/tracked.ts\0-\t-\timage.png\0",
      files: [tracked],
      readUntrackedFile: async () => Buffer.alloc(0),
    });

    expect(summary).toEqual({
      changedFiles: 1,
      deletions: 2,
      excludedFiles: 1,
      insertions: 3,
      kind: "lineDelta",
    });
  });

  it("consumes rename-aware numstat's empty header followed by old and new NUL paths", async () => {
    const summary = await buildGitChangeSummary({
      cwd: "/repo",
      execGit: async () => "0\t0\t\0old-name.ts\0new-name.ts\0",
      files: [
        {
          index: "R",
          origPath: "old-name.ts",
          path: "new-name.ts",
          worktree: ".",
        },
      ],
      readUntrackedFile: async () => Buffer.alloc(0),
    });

    expect(summary).toEqual({
      changedFiles: 1,
      deletions: 0,
      excludedFiles: 0,
      insertions: 0,
      kind: "lineDelta",
    });
  });

  it("rejects target and ancestor-directory symbolic links before reading untracked text", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-"));
    const outside = await mkdtemp(
      join(tmpdir(), "pier-change-summary-outside-")
    );
    try {
      await writeFile(join(outside, "text.txt"), "outside\n", "utf8");
      await symlink(join(outside, "text.txt"), join(root, "target-link.txt"));
      await mkdir(join(root, "linked"));
      await symlink(outside, join(root, "linked", "parent-link"));
      const testPaths = ["target-link.txt", "linked/parent-link/text.txt"];

      for (const path of testPaths) {
        const summary = await buildGitChangeSummary({
          cwd: root,
          execGit: async () => "",
          files: [{ ...untracked, path }],
          hasHead: false,
        });
        // Security property: symlink targets are omitted, never counted as text.
        // Still keep lineDelta so countable peers are not discarded.
        expect(summary).toEqual({
          changedFiles: 1,
          deletions: 0,
          excludedFiles: 1,
          insertions: 0,
          kind: "lineDelta",
        });
      }
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]);
    }
  });

  it("excludes an untracked directory without discarding tracked +/-", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-dir-"));
    try {
      await mkdir(join(root, "nested-repo"));
      await mkdir(join(root, "nested-repo", ".git"));
      const summary = await buildGitChangeSummary({
        cwd: root,
        execGit: async () => "3\t2\tsrc/tracked.ts\0",
        files: [tracked, { ...untracked, path: "nested-repo" }],
      });
      expect(summary).toEqual({
        changedFiles: 2,
        deletions: 2,
        excludedFiles: 1,
        insertions: 3,
        kind: "lineDelta",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts a legal path segment that merely starts with two dots", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-dot-"));
    try {
      await writeFile(join(root, "..notes.txt"), "note\n", "utf8");

      await expect(
        buildGitChangeSummary({
          cwd: root,
          execGit: async () => "",
          files: [{ ...untracked, path: "..notes.txt" }],
          hasHead: false,
        })
      ).resolves.toEqual({
        changedFiles: 1,
        deletions: 0,
        excludedFiles: 0,
        insertions: 1,
        kind: "lineDelta",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats backslashes as legal POSIX filename characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-slash-"));
    const path = "dir\\..\\file.txt";
    try {
      await writeFile(join(root, path), "note\n", "utf8");

      await expect(
        buildGitChangeSummary({
          cwd: root,
          execGit: async () => "",
          files: [{ ...untracked, path }],
          hasHead: false,
        })
      ).resolves.toEqual({
        changedFiles: 1,
        deletions: 0,
        excludedFiles: 0,
        insertions: 1,
        kind: "lineDelta",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("without HEAD counts current regular files against the empty tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-change-summary-empty-"));
    try {
      await writeFile(join(root, "staged-now.txt"), "one\ntwo\n", "utf8");
      await writeFile(join(root, "untracked-now.txt"), "three", "utf8");
      await expect(
        buildGitChangeSummary({
          cwd: root,
          execGit: async () => {
            throw new Error("no HEAD numstat must not run");
          },
          files: [
            { ...tracked, index: "A", path: "staged-now.txt", worktree: "." },
            { ...untracked, path: "untracked-now.txt" },
          ],
          hasHead: false,
        })
      ).resolves.toEqual({
        changedFiles: 2,
        deletions: 0,
        excludedFiles: 0,
        insertions: 3,
        kind: "lineDelta",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("without HEAD excludes a staged addition deleted from the current working tree", async () => {
    await expect(
      buildGitChangeSummary({
        cwd: "/repo",
        execGit: async () => {
          throw new Error("no HEAD numstat must not run");
        },
        files: [
          {
            index: "A",
            origPath: null,
            path: "deleted-after-stage.txt",
            worktree: "D",
          },
        ],
        hasHead: false,
        readUntrackedFile: async () => {
          throw new Error("deleted path must not be read");
        },
      })
    ).resolves.toEqual({
      changedFiles: 0,
      deletions: 0,
      excludedFiles: 0,
      insertions: 0,
      kind: "lineDelta",
    });
  });

  it("without HEAD still counts an existing staged addition as current text", async () => {
    await expect(
      buildGitChangeSummary({
        cwd: "/repo",
        execGit: async () => "",
        files: [
          {
            index: "A",
            origPath: null,
            path: "staged-existing.txt",
            worktree: ".",
          },
        ],
        hasHead: false,
        readUntrackedFile: async () => Buffer.from("one\ntwo\n", "utf8"),
      })
    ).resolves.toEqual({
      changedFiles: 1,
      deletions: 0,
      excludedFiles: 0,
      insertions: 2,
      kind: "lineDelta",
    });
  });
});

describe("numstat / status coherence", () => {
  it("extracts inline paths and both sides of rename records", () => {
    expect(
      numstatPaths(
        `${["4\t1\tsrc/a.ts", "-\t-\tassets/logo.png", "3\t1\t"].join("\0")}\0src/old.ts\0src/new.ts\0`
      )
    ).toEqual(["src/a.ts", "assets/logo.png", "src/old.ts", "src/new.ts"]);
    expect(numstatPaths("")).toEqual([]);
  });

  it("rejects malformed numstat records", () => {
    expect(numstatPaths("garbage\0")).toBeNull();
    expect(numstatPaths("3\t1\t\0src/old.ts\0")).toBeNull();
  });

  it("only accepts numstat paths that status already lists", () => {
    const files: GitFileStatus[] = [
      tracked,
      { index: "R", origPath: "src/old.ts", path: "src/new.ts", worktree: "." },
    ];
    expect(numstatWithinStatus(files, "")).toBe(true);
    expect(numstatWithinStatus(files, "4\t1\tsrc/tracked.ts\0")).toBe(true);
    expect(numstatWithinStatus(files, "3\t1\t\0src/old.ts\0src/new.ts\0")).toBe(
      true
    );
    expect(numstatWithinStatus(files, "2\t0\tsrc/late.ts\0")).toBe(false);
    expect(numstatWithinStatus(files, "garbage\0")).toBe(false);
  });
});
