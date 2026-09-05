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

describe("Git baseline bounded content", () => {
  it("accepts exactly 10 MiB and preserves a tracked empty file as existing", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root, "empty.txt", "");
    await commitFile(root, "limit.txt", Buffer.alloc(10 * 1024 * 1024, 97));
    const service = createGitService();
    expect(
      await service.getFileBaseline({ root, path: "empty.txt" })
    ).toMatchObject({ status: "ready", contents: "", existsAtHead: true });
    const result = await service.getFileBaseline({ root, path: "limit.txt" });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.contents.length).toBe(10 * 1024 * 1024);
      expect(result.contents.startsWith("aaaa")).toBe(true);
    }
  });

  it("stops a binary stream without collecting its whole blob", async () => {
    const root = await makeBaselineRepo();
    const content = Buffer.alloc(9 * 1024 * 1024, 97);
    content[0] = 0;
    await commitFile(root, "file.txt", content);
    let received = content.length;
    const service = createGitService({
      execGitRaw: async (args, options) => {
        try {
          return await execGitRaw(args, options);
        } catch (error) {
          if (error instanceof GitExecRawError && args.includes("cat-file"))
            received = error.stdoutBytes;
          throw error;
        }
      },
    });
    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual({
      status: "unavailable",
      reason: "binary",
    });
    expect(received).toBeLessThan(content.length);
  });

  it("evicts old cached content when retained text would exceed the memory budget", async () => {
    const root = await makeBaselineRepo();
    const content = Buffer.alloc(6 * 1024 * 1024, 97);
    for (const path of ["a.txt", "b.txt", "c.txt"])
      await writeFile(join(root, path), content);
    await git(root, "add", "a.txt", "b.txt", "c.txt");
    await git(root, "commit", "-m", "cache fixtures");
    let reads = 0;
    const service = createGitService({
      execGitRaw: (args, options) => {
        if (args.includes("cat-file") && args.includes("blob")) reads += 1;
        return execGitRaw(args, options);
      },
    });
    for (const path of ["a.txt", "b.txt", "c.txt", "a.txt"]) {
      expect(await service.getFileBaseline({ root, path })).toMatchObject({
        status: "ready",
        existsAtHead: true,
      });
    }
    expect(reads).toBe(4);
  }, 30_000);

  it("reports a damaged HEAD file as a repository error", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    await writeFile(join(root, ".git/HEAD"), "invalid revision\n");
    expect(
      await createGitService().getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({ status: "error" });
  });
});
