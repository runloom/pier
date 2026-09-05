import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execGitRaw, GitExecRawError } from "@main/services/git/exec.ts";
import { createGitService } from "@main/services/git/service.ts";
import { describe, expect, it } from "vitest";
import {
  commitFile,
  git,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("Git file baseline consistency and failures", () => {
  it("reuses the immutable blob when index staging changes", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    let reads = 0;
    const service = createGitService({
      execGitRaw: (args, options) => {
        if (args.includes("cat-file") && args.includes("blob")) reads += 1;
        return execGitRaw(args, options);
      },
    });
    const first = await service.getFileBaseline({ root, path: "file.txt" });
    await writeFile(join(root, "file.txt"), "index version\n");
    await git(root, "add", "file.txt");
    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual(
      first
    );
    expect(reads).toBe(1);
  });

  it("retries once if HEAD changes during blob read, returning only the new identity", async () => {
    const root = await makeBaselineRepo();
    const oldOid = await commitFile(root);
    let newOid = "";
    let reads = 0;
    const service = createGitService({
      execGitRaw: async (args, options) => {
        const result = await execGitRaw(args, options);
        if (
          args.includes("cat-file") &&
          args.includes("blob") &&
          ++reads === 1
        ) {
          newOid = await commitFile(root, "file.txt", "new HEAD\n");
        }
        return result;
      },
    });
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({
      status: "ready",
      headOid: expect.not.stringMatching(oldOid),
      contents: "new HEAD\n",
    });
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({ headOid: newOid });
    expect(reads).toBe(2);
  });

  it("reports an error when HEAD keeps changing instead of publishing a stale side", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    let reads = 0;
    const service = createGitService({
      execGitRaw: async (args, options) => {
        const result = await execGitRaw(args, options);
        if (args.includes("cat-file") && args.includes("blob")) {
          reads += 1;
          await commitFile(root, "file.txt", `HEAD ${reads}\n`);
        }
        return result;
      },
    });
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({ status: "error" });
    expect(reads).toBe(2);
  });

  it.each([
    "rev-parse",
    "status",
    "ls-tree",
    "cat-file",
  ])("preserves %s process failures as errors", async (command) => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    const service = createGitService({
      execGitRaw: (args, options) => {
        if (args.includes(command)) {
          return Promise.reject(
            new GitExecRawError({
              args,
              cwd: options.cwd,
              causeKind: "exit",
              exitCode: 128,
              message: "permission denied",
              stderrBytes: 17,
              stderrTail: Buffer.from("permission denied"),
              stdoutBytes: 0,
              stdoutTail: Buffer.alloc(0),
            })
          );
        }
        return execGitRaw(args, options);
      },
    });
    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual({
      status: "error",
      message: "permission denied",
    });
  });

  it("does not cache failed reads", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    let failed = false;
    const service = createGitService({
      execGitRaw: (args, options) => {
        if (!failed && args.includes("cat-file") && args.includes("blob")) {
          failed = true;
          return Promise.reject(new Error("read failed"));
        }
        return execGitRaw(args, options);
      },
    });
    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual({
      status: "error",
      message: "read failed",
    });
    expect(
      await service.getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({ status: "ready", contents: "at HEAD\n" });
  });
});
