import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execGitRaw } from "@main/services/git/exec.ts";
import { createGitService } from "@main/services/git/service.ts";
import { describe, expect, it } from "vitest";
import {
  commitFile,
  git,
  makeBaselineRepo,
} from "../../../../support/git-file-baseline.ts";

describe("Git file baseline boundaries", () => {
  it("distinguishes an ordinary directory from repository and revision failures", async () => {
    const root = await makeBaselineRepo();
    await rm(join(root, ".git"), { recursive: true });
    expect(
      await createGitService().getFileBaseline({ root, path: "file.txt" })
    ).toEqual({
      status: "unavailable",
      reason: "not-repository",
    });
    expect(
      await createGitService().getFileBaseline({
        root: join(root, "absent"),
        path: "file.txt",
      })
    ).toMatchObject({ status: "error" });
  });

  it("never treats a dangling HEAD object as an unborn branch", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root);
    await writeFile(join(root, ".git/refs/heads/main"), `${"1".repeat(40)}\n`);
    expect(
      await createGitService().getFileBaseline({ root, path: "file.txt" })
    ).toMatchObject({ status: "error" });
  });

  it.each([
    "../outside.txt",
    "nested/../../outside.txt",
    "",
    ".",
    "file\0.txt",
  ])("rejects invalid or escaping path %j", async (path) => {
    const root = await makeBaselineRepo();
    expect(
      await createGitService().getFileBaseline({ root, path })
    ).toMatchObject({ status: "error" });
  });

  it("rejects a path outside the caller root even if it is inside the repository", async () => {
    const root = await makeBaselineRepo();
    await mkdir(join(root, "nested"));
    await commitFile(root);
    expect(
      await createGitService().getFileBaseline({
        root: join(root, "nested"),
        path: join(root, "file.txt"),
      })
    ).toMatchObject({ status: "error" });
  });

  it("rejects directories, symlink files and symlink ancestors", async () => {
    const root = await makeBaselineRepo();
    await mkdir(join(root, "nested"));
    await commitFile(root, "nested/file.txt");
    await symlink("nested/file.txt", join(root, "link.txt"));
    await symlink("nested", join(root, "alias"), "dir");
    await git(root, "add", "link.txt");
    await git(root, "commit", "-m", "link fixture");
    const service = createGitService();
    for (const path of [
      "nested",
      "link.txt",
      "alias/file.txt",
      ".git/config",
    ]) {
      expect(await service.getFileBaseline({ root, path })).toEqual({
        status: "unavailable",
        reason: "unsupported-file",
      });
    }
    await rm(join(root, "link.txt"));
    expect(await service.getFileBaseline({ root, path: "link.txt" })).toEqual({
      status: "unavailable",
      reason: "unsupported-file",
    });
  });

  it.each([
    ["binary", Buffer.from([0, 1, 2, 3])],
    ["unsupported-encoding", Buffer.from([0x63, 0x61, 0x66, 0xe9])],
    ["unsupported-encoding", Buffer.from([0xff, 0xfe, 0x61, 0])],
  ] as const)("rejects %s data in HEAD", async (reason, contents) => {
    const root = await makeBaselineRepo();
    await commitFile(root, "file.txt", contents);
    expect(
      await createGitService().getFileBaseline({ root, path: "file.txt" })
    ).toEqual({ status: "unavailable", reason });
  });

  it("checks the 10 MiB blob size before requesting content", async () => {
    const root = await makeBaselineRepo();
    await commitFile(root, "file.txt", Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    const calls: string[][] = [];
    const service = createGitService({
      execGitRaw: (args, options) => {
        if (args.includes("cat-file") && args.includes("blob"))
          calls.push([...args]);
        return execGitRaw(args, options);
      },
    });
    expect(await service.getFileBaseline({ root, path: "file.txt" })).toEqual({
      status: "unavailable",
      reason: "too-large",
    });
    expect(calls).toEqual([]);
  });
});
